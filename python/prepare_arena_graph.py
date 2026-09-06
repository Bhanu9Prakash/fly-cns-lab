"""Extend the reference subnetwork with actual wing motor units and input paths.

Run prepare_graph.py first to create units.json and type-edges.feather in cache.
The original graph.json and its recorded experiments remain unchanged.
"""
import argparse,json,pathlib
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

p=argparse.ArgumentParser();p.add_argument('--cache',type=pathlib.Path,default=pathlib.Path('data-cache'))
p.add_argument('--base',type=pathlib.Path,default=pathlib.Path('dist/graph.json'))
p.add_argument('--output',type=pathlib.Path,default=pathlib.Path('dist/arena-graph.json'))
args=p.parse_args()
full=json.loads((args.cache/'units.json').read_text());u=full['units'];base=json.loads(args.base.read_text())
e=pd.read_feather(args.cache/'type-edges.feather');n=len(u);key={v['key']:v['id'] for v in u}
chosen={key[v['key']] for v in base['nodes']}
motor_types=['DLMn a, b','DLMn c-f','DVMn 1a-c','DVMn 2a, b','DVMn 3a, b','b2 MN']
motor_ids=[v['id'] for v in u if v['type'] in motor_types]
chosen.update(motor_ids)
# Preserve substantial local context around the newly requested motor outputs.
for target in motor_ids:
    chosen.update(e[e.target==target].nlargest(12,'count').source.tolist())
s=e.source.to_numpy();t=e.target.to_numpy();c=e['count'].to_numpy()
denom=np.maximum(1,[v['total_input'] for v in u]);cost=-np.log(np.maximum(1e-12,c/denom[t]))+.3
adj=csr_matrix((cost,(s,t)),shape=(n,n));seeds=[v['id'] for v in u if v['type'] in base['input_types']]
_,parent,_=dijkstra(adj,indices=seeds,directed=True,min_only=True,return_predecessors=True)
pairs={}
for v in u:pairs.setdefault((v['type'],v['segment']),[]).append(v['id'])
old=-1
while old!=len(chosen):
    old=len(chosen)
    for i in list(chosen):chosen.update(pairs[(u[i]['type'],u[i]['segment'])])
    for i in list(chosen):
        while parent[i]>=0:i=int(parent[i]);chosen.add(i)

def group(c):
    if c in ['ol_intrinsic','ol_sensory','visual_projection','visual_centrifugal']:return 'visual'
    if c=='descending_neuron':return 'descending'
    if c in ['vnc_motor','cb_motor']:return 'motor'
    if c.startswith('vnc') or c=='ascending_neuron':return 'cord'
    return 'central'

mapping={old:new for new,old in enumerate(sorted(chosen))}
nodes=[{**u[i],'id':mapping[i],'group':group(u[i]['superclass'])} for i in sorted(chosen)]
edges=[[mapping[int(s)],mapping[int(t)],int(c)] for s,t,c in e[e.source.isin(chosen)&e.target.isin(chosen)].itertuples(index=False,name=None)]
retained=np.bincount([x[1] for x in edges],weights=[x[2] for x in edges],minlength=len(nodes))
for v in nodes:v['retained_input_fraction']=retained[v['id']]/max(1,v['total_input'])
m={**base['metadata'],'nodes':len(nodes),'edges':len(edges),'represented_neurons':sum(v['count'] for v in nodes),
   'represented_synapses':sum(x[2] for x in edges),'base_nodes':len(base['nodes']),
   'selection':'Superset of reference graph: DLM/DVM wing power and b2 wing steering populations, their 12 strongest presynaptic populations, strong-path ancestors from original visual seeds, and existing bilateral counterparts. All induced edges retained.',
   'arena_motor_types':motor_types,
   'not_included':'Most CNS populations, gap junctions, receptor identities, calibrated physiology, retinal spatial computation, plasticity and muscle mechanics. An illustrative body adapter is separate from this structural graph.'}
args.output.write_text(json.dumps({'metadata':m,'nodes':nodes,'edges':edges,'input_types':base['input_types']},separators=(',',':')))
print(json.dumps({k:m[k] for k in ['nodes','edges','represented_neurons','represented_synapses','base_nodes']}))
