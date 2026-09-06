"""Same leaky population-rate equations and defaults as dist/sim.mjs.

python python/simulate.py --graph dist/graph.json --output experiment.json
Only the Python standard library is required to run a prepared graph.
"""
import argparse
import csv
import json
import math
from pathlib import Path

DEFAULTS=dict(preset="loom",side="both",amplitude=1,gain=3,duration=600,onset=60,
              pulse=180,dt=2,tau=20,mode="signed",glutamate="inhibitory",silenced=[])
PRESETS={"loom":["LC4","LPLC2"],"motion_a":["T4a","T5a"],"motion_b":["T4b","T5b"],"none":[]}

def sign_for(nt,o):
    if o["mode"]=="unsigned": return 1
    if nt=="acetylcholine": return 1
    if nt in ["gaba","histamine"]: return -1
    if nt=="glutamate": return {"inhibitory":-1,"excitatory":1,"omit":0}[o["glutamate"]]
    return 0

def input_at(t,node,o):
    if t<o["onset"] or t>=o["onset"]+o["pulse"]: return 0
    if o["side"]!="both" and node["side"]!=o["side"]: return 0
    if node["type"] not in PRESETS[o["preset"]]: return 0
    phase=min(1,max(0,(t-o["onset"])/o["pulse"]))
    envelope=(phase**2 if node["type"]=="LPLC2" else 0.35+0.65*phase) if o["preset"]=="loom" else 1
    return o["amplitude"]*envelope

def simulate(graph,**options):
    o={**DEFAULTS,**options};nodes=graph["nodes"];n=len(nodes)
    assert n>0 and o["preset"] in PRESETS
    for k in ["duration","pulse","dt","tau"]:
        if not math.isfinite(o[k]) or o[k]<=0: raise ValueError(k+" must be positive")
    for k in ["amplitude","gain","onset"]:
        if not math.isfinite(o[k]) or o[k]<0: raise ValueError(k+" must be nonnegative")
    if o["duration"]/o["dt"]>10000: raise ValueError("Too many steps")
    if o["side"] not in ["L","R","both"] or o["mode"] not in ["signed","unsigned"] or o["glutamate"] not in ["inhibitory","excitatory","omit"]: raise ValueError("Invalid model option")
    disabled=set(o["silenced"])
    if any(not isinstance(i,int) or i<0 or i>=n for i in disabled): raise ValueError("Invalid silenced node")
    for i,u in enumerate(nodes):
        if u["id"]!=i or not math.isfinite(u["total_input"]) or u["total_input"]<0: raise ValueError("Invalid node")
    edges=[]
    for s,t,w in graph["edges"]:
        if not isinstance(s,int) or not isinstance(t,int) or not 0<=s<n or not 0<=t<n or not math.isfinite(w) or w<=0: raise ValueError("Invalid edge")
        edges.append((s,t,sign_for(nodes[s]["nt"],o)*w/max(1,nodes[t]["total_input"])))
    state=[0.0]*n;activity=[state[:]];times=[0];peaks=[0.0]*n;peak_times=[0.0]*n;areas=[0.0]*n
    alpha=1-math.exp(-o["dt"]/o["tau"])
    for k in range(math.floor(o["duration"]/o["dt"])):
        drive=[0.0]*n
        for s,t,w in edges: drive[t]+=o["gain"]*w*state[s]
        new=[0.0]*n;time=(k+1)*o["dt"]
        for i,node in enumerate(nodes):
            if i in disabled: continue
            target=max(0,math.tanh(drive[i]+input_at(k*o["dt"],node,o)))
            new[i]=state[i]+alpha*(target-state[i])
            if new[i]>peaks[i]:peaks[i]=new[i];peak_times[i]=time
            areas[i]+=(state[i]+new[i])*o["dt"]/2
        state=new;activity.append(state[:]);times.append(time)
    groups={g:[i for i,u in enumerate(nodes) if u["group"]==g] for g in ["visual","central","descending","cord","motor"]}
    traces={g:[sum(row[i] for i in ids)/len(ids) if ids else 0 for row in activity] for g,ids in groups.items()}
    return dict(options=o,times=times,activity=activity,peaks=peaks,peakTimes=peak_times,areas=areas,groupTraces=traces)

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--graph",type=Path,default=Path("dist/graph.json"));p.add_argument("--output",type=Path,default=Path("experiment.json"));p.add_argument("--preset",choices=list(PRESETS),default="loom");p.add_argument("--side",choices=["L","R","both"],default="both");p.add_argument("--gain",type=float,default=3);p.add_argument("--amplitude",type=float,default=1);p.add_argument("--glutamate",choices=["inhibitory","excitatory","omit"],default="inhibitory");p.add_argument("--mode",choices=["signed","unsigned"],default="signed");p.add_argument("--silence-type",action="append",default=[])
    args=p.parse_args();graph=json.loads(args.graph.read_text());disabled=[u["id"] for u in graph["nodes"] if u["type"] in args.silence_type]
    r=simulate(graph,preset=args.preset,side=args.side,gain=args.gain,amplitude=args.amplitude,glutamate=args.glutamate,mode=args.mode,silenced=disabled)
    r["provenance"]=graph.get("metadata",{});args.output.write_text(json.dumps(r,separators=(",",":")))
    csv_file=args.output.with_suffix(".csv")
    with csv_file.open("w",newline="") as f:
        writer=csv.writer(f);writer.writerow(["type","side","segment","group","peak_activity","peak_model_time","integrated_activity","silenced"])
        for i,u in enumerate(graph["nodes"]):writer.writerow([u["type"],u["side"],u.get("segment",""),u["group"],r["peaks"][i],r["peakTimes"][i],r["areas"][i],i in disabled])
    motors=sorted([i for i,u in enumerate(graph["nodes"]) if u["group"]=="motor"],key=lambda i:-r["peaks"][i])[:8]
    print("Model motor activity (normalized, not measured Hz):")
    for i in motors:print(graph["nodes"][i]["key"],round(r["peaks"][i],6))
    print("Saved",args.output,"and",csv_file)
