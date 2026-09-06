"""Build a small display-only mesh from the pinned, Apache-2.0 Flybody model.

Requires numpy, scipy, trimesh and fast-simplification. Original OBJ positions
are transformed by the MuJoCo XML's zero-joint body/geom poses. This exports
appearance only, not dynamics or a controller. Run from the project root.
"""
import argparse, concurrent.futures, hashlib, json, pathlib, urllib.request
import xml.etree.ElementTree as ET
import numpy as np
import trimesh
from scipy.spatial.transform import Rotation

COMMIT='d015e9bfe441bd90ae431bac24c55cb74bdbce26'
BASE=f'https://raw.githubusercontent.com/TuragaLab/flybody/{COMMIT}/'
ROOT=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--cache',type=pathlib.Path,default=ROOT/'body-cache')
CACHE=parser.parse_args().cache
OUT=ROOT/'dist/assets'
CACHE.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)

def fetch(path):
    p=CACHE/pathlib.Path(path).name
    if not p.exists():
        p.write_bytes(urllib.request.urlopen(BASE+path,timeout=90).read())
    return p

def transform(e):
    T=np.eye(4)
    if e.get('quat'):
        w,x,y,z=map(float,e.get('quat').split())
        T[:3,:3]=Rotation.from_quat([x,y,z,w]).as_matrix()
    elif e.get('euler'):
        T[:3,:3]=Rotation.from_euler('XYZ',list(map(float,e.get('euler').split()))).as_matrix()
    T[:3,3]=list(map(float,e.get('pos','0 0 0').split()))
    return T

xml=fetch('flybody/fruitfly/assets/fruitfly.xml')
root=ET.parse(xml).getroot()
assets={e.get('name'):e for e in root.findall('./asset/mesh')}
materials={e.get('name'):list(map(float,e.get('rgba','0.674 0.35 0.143 1').split())) for e in root.findall('./asset/material')}
# Fine bristles and ocelli are omitted to reduce payload; eyes, body, wings,
# antennae, halteres, mouthparts and every leg segment retain source geometry.
skip={'head_black','head_ocelli','thorax_black','rostrum_bristle-brown'}
names={g.get('mesh') for g in root.findall('.//worldbody//geom') if g.get('mesh') and g.get('mesh') not in skip}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
    list(ex.map(fetch,['flybody/fruitfly/assets/'+assets[n].get('file') for n in sorted(names)]))
parts=[];pivots={};sources={}

def walk(body,parent,wing=None):
    T=parent@transform(body)
    name=body.get('name','')
    if name in ['wing_left','wing_right']:
        wing=name;pivots[wing]=(T[:3,3]/.297).round(6).tolist()
    for g in body.findall('./geom'):
        mesh=g.get('mesh')
        if mesh not in names:continue
        path=CACHE/assets[mesh].get('file')
        m=trimesh.load(path,force='mesh',process=True)
        budget=1800 if mesh in ['head_red','head','thorax'] else 500 if 'wing' in mesh else 250
        if len(m.faces)>budget:m=m.simplify_quadric_decimation(face_count=budget)
        m.vertices*=.1
        m.apply_transform(T@transform(g))
        m.vertices/=.297 # One displayed body length, based on published 0.297 cm.
        parts.append({'name':g.get('name'),'wing':wing,'rgba':materials.get(g.get('material','body'),materials['body']),
                      'positions':np.round(m.vertices,6).ravel().tolist(),'indices':m.faces.ravel().tolist()})
        sources[path.name]=hashlib.sha256(path.read_bytes()).hexdigest()
    for child in body.findall('./body'):walk(child,T,wing)

for body in root.findall('./worldbody/body'):walk(body,np.eye(4))
out={'source':'https://github.com/TuragaLab/flybody','commit':COMMIT,'license':'Apache-2.0',
     'modifications':'Decimated; four fine-detail meshes omitted; XML zero-joint transforms baked; scaled to 1 body length. Display geometry only.',
     'pivots':pivots,'parts':parts,'original_obj_sha256':sources}
(OUT/'flybody.json').write_text(json.dumps(out,separators=(',',':')))
(OUT/'FLYBODY-LICENSE.txt').write_bytes(fetch('LICENSE').read_bytes())
(OUT/'FLYBODY-NOTICE.txt').write_text('Flybody anatomical display geometry\nSource: '+out['source']+'\nCommit: '+COMMIT+'\nGoogle DeepMind and HHMI Janelia Research Campus. Apache License 2.0.\nVaxenburg et al. (2025), Whole-body physics simulation of fruit fly locomotion, Nature 643, 1312–1320. https://doi.org/10.1038/s41586-025-09029-4\nModifications: '+out['modifications']+'\nThe CNS Lab does not run the source MuJoCo dynamics or trained controller.\n')
print(json.dumps({'parts':len(parts),'triangles':sum(len(p['indices'])//3 for p in parts),'bytes':(OUT/'flybody.json').stat().st_size,'pivots':pivots}))
