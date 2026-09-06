"""Sparse full typed CNS simulation using the same equations as the browser.

python python/prepare_graph.py --cache data-cache
python python/simulate_full.py --cache data-cache --output full-cns.npz

The preparation stage creates 25,850 population units from 162,517 named,
Traced neurons. This model still excludes untyped neurons and physiology.
Requires numpy, scipy, pandas, pyarrow. No GPU required.
"""
import argparse
import json
import math
from pathlib import Path
import time
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from simulate import DEFAULTS,PRESETS,sign_for

def simulate_sparse(nodes,edges,**options):
    o={**DEFAULTS,**options};n=len(nodes)
    if o['preset'] not in PRESETS or o['side'] not in ['L','R','both'] or o['mode'] not in ['signed','unsigned'] or o['glutamate'] not in ['inhibitory','excitatory','omit']:raise ValueError('Invalid option')
    for k in ['duration','pulse','dt','tau']:
        if not math.isfinite(o[k]) or o[k]<=0:raise ValueError(k)
    for k in ['gain','amplitude','onset']:
        if not math.isfinite(o[k]) or o[k]<0:raise ValueError(k)
    if o['duration']/o['dt']>10000:raise ValueError('Too many steps')
    if any(not isinstance(i,int) or i<0 or i>=n for i in o['silenced']):raise ValueError('Invalid silenced node')
    edge=np.asarray(edges,dtype=np.int64)
    if edge.ndim!=2 or edge.shape[1]!=3 or np.any(edge[:,:2]<0) or np.any(edge[:,:2]>=n) or np.any(edge[:,2]<=0):raise ValueError('Invalid edges')
    s,t,counts=edge.T
    totals=np.maximum(1,[u['total_input'] for u in nodes])
    signs=np.array([sign_for(u['nt'],o) for u in nodes],dtype=np.float64)
    weights=o['gain']*signs[s]*counts/totals[t]
    matrix=csr_matrix((weights,(t,s)),shape=(n,n));matrix.eliminate_zeros()
    steps=math.floor(o['duration']/o['dt']);alpha=1-math.exp(-o['dt']/o['tau'])
    history=np.zeros((steps+1,n),dtype=np.float64)
    active=np.array([u['type'] in PRESETS[o['preset']] and (o['side']=='both' or u['side']==o['side']) for u in nodes])
    lplc=np.array([u['type']=='LPLC2' for u in nodes]);disabled=np.array(o['silenced'],dtype=int)
    for k in range(steps):
        t0=k*o['dt'];state=history[k];drive=matrix@state
        if o['onset']<=t0<o['onset']+o['pulse']:
            if o['preset']=='loom':
                q=(t0-o['onset'])/o['pulse'];drive[active]+=o['amplitude']*np.where(lplc[active],q*q,0.35+0.65*q)
            else:drive[active]+=o['amplitude']
        new=state+alpha*(np.maximum(0,np.tanh(drive))-state);new[disabled]=0;history[k+1]=new
    return dict(options=o,times=np.arange(steps+1)*o['dt'],activity=history,
                peaks=history.max(axis=0),peakTimes=history.argmax(axis=0)*o['dt'])

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--cache',type=Path,default=Path('data-cache'));p.add_argument('--output',type=Path,default=Path('full-cns.npz'));p.add_argument('--preset',choices=list(PRESETS),default='loom');p.add_argument('--side',choices=['L','R','both'],default='both');p.add_argument('--gain',type=float,default=3);p.add_argument('--amplitude',type=float,default=1);p.add_argument('--silence-type',action='append',default=[]);p.add_argument('--glutamate',choices=['inhibitory','excitatory','omit'],default='inhibitory');p.add_argument('--mode',choices=['signed','unsigned'],default='signed')
    args=p.parse_args()
    if not (args.cache/'units.json').exists():raise SystemExit('Run python python/prepare_graph.py --cache '+str(args.cache)+' first.')
    full=json.loads((args.cache/'units.json').read_text());nodes=full['units'];edges=pd.read_feather(args.cache/'type-edges.feather').to_numpy()
    started=time.monotonic();r=simulate_sparse(nodes,edges,preset=args.preset,side=args.side,gain=args.gain,amplitude=args.amplitude,silenced=[u['id'] for u in nodes if u['type'] in args.silence_type],glutamate=args.glutamate,mode=args.mode)
    elapsed=time.monotonic()-started
    assert np.isfinite(r['activity']).all() and np.min(r['activity'])>=0 and np.max(r['activity'])<=1
    np.savez_compressed(args.output,times=r['times'],activity=r['activity'],peaks=r['peaks'],keys=np.array([u['key'] for u in nodes]))
    motors=sorted([u['id'] for u in nodes if u['superclass'] in ['vnc_motor','cb_motor']],key=lambda i:-r['peaks'][i])
    report=dict(model='leaky-rate-v1',scope='Full typed, Traced CNS population graph',provenance=full['sources'],populations=len(nodes),neurons=full['typed_neurons'],edges=len(edges),elapsed_seconds=elapsed,options=r['options'],active_above_0_001=int(np.sum(r['peaks']>=0.001)),top_motors=[dict(key=nodes[i]['key'],peak=float(r['peaks'][i]),peak_model_time=int(r['peakTimes'][i])) for i in motors[:12]])
    args.output.with_suffix('.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2),flush=True)
