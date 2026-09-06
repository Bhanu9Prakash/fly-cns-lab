"""Rebuild a compact visual-to-motor MaleCNS graph from public v1.0 Feather files.

Requires numpy, pandas, pyarrow. Raw inputs use ~1.1 GB of disk.
No neuPrint login is required. Never downloads image volumes.
"""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import time
import urllib.request

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.ipc as ipc

BASE = "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/"
FILES = {
    "annotations": "body-annotations-male-cns-v1.0-minconf-0.5.feather",
    "nt": "body-neurotransmitters-male-cns-v1.0.feather",
    "weights": "connectome-weights-male-cns-v1.0-minconf-0.5.feather",
}
INPUT_TYPES = ["LC4", "LPLC2", "T4a", "T5a", "T4b", "T5b"]


def download(cache: Path) -> None:
    cache.mkdir(parents=True, exist_ok=True)
    for name in FILES.values():
        dest = cache / name
        if dest.exists():
            continue
        print("Downloading", name, flush=True)
        with urllib.request.urlopen(BASE + name, timeout=90) as r, dest.with_suffix(".part").open("wb") as f:
            while chunk := r.read(4 * 1024 * 1024):
                f.write(chunk)
        dest.with_suffix(".part").replace(dest)


def aggregate(cache: Path):
    node_file, edge_file = cache / "units.json", cache / "type-edges.feather"
    if node_file.exists() and edge_file.exists():
        return json.loads(node_file.read_text()), pd.read_feather(edge_file)
    a = pd.read_feather(cache / FILES["annotations"])
    a = a[(a.status == "Traced") & a.type.notna()].copy()
    assert a.bodyId.is_unique
    nt = pd.read_feather(cache / FILES["nt"], columns=["body", "consensus_nt"])
    assert nt.body.is_unique
    a = a.merge(nt, how="left", left_on="bodyId", right_on="body", validate="1:1")
    a["nt"] = a.consensus_nt.fillna("unclear")
    a["side"] = a.somaSide.fillna(a.rootSide).fillna("U")
    # Retain segment identity for VNC cells: the same type can occur in each leg segment.
    a["segment"] = a.somaNeuromere.where(a.superclass.str.startswith("vnc", na=False), "").fillna("")
    a["key"] = a.type + "|" + a.side + "|" + a.segment
    a["unit"], names = pd.factorize(a.key, sort=True)
    count = len(names)
    units = []
    for unit, g in a.groupby("unit", sort=True):
        nts = g.nt.value_counts(); row = g.iloc[0]
        units.append({"id": int(unit), "key": row.key, "type": row.type, "side": row.side,
                      "segment": row.segment, "superclass": g.superclass.mode().iloc[0],
                      "nt": nts.index[0], "nt_agreement": float(nts.iloc[0] / len(g)),
                      "count": len(g), "body_ids": [str(v) for v in g.bodyId],
                      "total_input": 0})
    index = pd.Index(a.bodyId)
    codes = a.unit.to_numpy(dtype=np.int64)
    totals = np.zeros(count, dtype=np.float64)
    counter = Counter(); pairs = 0; synapses = 0; typed_pairs = 0
    started = time.monotonic()
    with pa.memory_map(str(cache / FILES["weights"]), "r") as f:
        reader = ipc.open_file(f)
        for k in range(reader.num_record_batches):
            b = reader.get_batch(k)
            pre, post, weights = [c.to_numpy() for c in b.columns]
            assert np.all(weights > 0)
            pi, qi = index.get_indexer(pre), index.get_indexer(post)
            valid_post = qi >= 0
            totals += np.bincount(codes[qi[valid_post]], weights=weights[valid_post], minlength=count)
            keep = (pi >= 0) & valid_post
            keys = codes[pi[keep]] * count + codes[qi[keep]]
            if len(keys):
                unique, inverse = np.unique(keys, return_inverse=True)
                sums = np.bincount(inverse, weights=weights[keep]).astype(np.int64)
                counter.update(dict(zip(unique.tolist(), sums.tolist())))
            pairs += len(weights); synapses += int(weights.sum()); typed_pairs += int(keep.sum())
            if k % 300 == 0:
                print(f"Aggregate {k}/{reader.num_record_batches}: {len(counter):,} type edges, {time.monotonic()-started:.1f}s", flush=True)
    for i, u in enumerate(units): u["total_input"] = int(totals[i])
    keys = np.fromiter(counter.keys(), dtype=np.int64)
    edge = pd.DataFrame({"source": keys // count, "target": keys % count,
                         "count": np.fromiter(counter.values(), dtype=np.int64)})
    edge = edge.sort_values(["source", "target"]).reset_index(drop=True)
    edge.to_feather(edge_file)
    hashes = {}
    for label, name in FILES.items():
        h = hashlib.sha256()
        with (cache / name).open("rb") as f:
            while chunk := f.read(8*1024*1024): h.update(chunk)
        hashes[label] = {"url": BASE + name, "sha256": h.hexdigest(), "bytes": (cache/name).stat().st_size}
    full = {"units": units, "raw_pairs": pairs, "raw_synapses": synapses, "typed_pairs": typed_pairs,
            "typed_neurons": len(a), "typed_units": count, "typed_edges": len(edge), "sources": hashes}
    node_file.write_text(json.dumps(full))
    return full, edge


def select_graph(full, edge, output: Path, size=360):
    """Select prominent reachable units, stratified by anatomical class.

    Rank by six rounds of unsigned weighted propagation (gain 1), using
    full incoming synapse totals. Selection is fixed across experiments.
    Include all seeded visual types plus DNp01 and DNg13. Keep all induced
    directed edges, including weak edges, inhibition and feedback.
    """
    units = full["units"]; n = len(units)
    s = edge.source.to_numpy(); t = edge.target.to_numpy(); w = edge["count"].to_numpy()
    denom = np.maximum(1, [u["total_input"] for u in units])
    fractions = w / denom[t]
    seeds = np.array([u["type"] in INPUT_TYPES for u in units])
    a = seeds.astype(float); score = a.copy()
    for _ in range(6):
        a = np.bincount(t, weights=fractions*a[s], minlength=n)
        score = np.maximum(score, a)
    classes = np.array([u["superclass"] for u in units])
    def category(c):
        if c in ["ol_intrinsic", "ol_sensory", "visual_projection", "visual_centrifugal"]: return "visual"
        if c == "descending_neuron": return "descending"
        if c in ["vnc_motor", "cb_motor"]: return "motor"
        if c.startswith("vnc") or c == "ascending_neuron": return "cord"
        return "central"
    groups = np.array([category(c) for c in classes])
    quotas = {"visual": int(size*.22), "central": int(size*.22), "descending": int(size*.20),
              "cord": int(size*.23), "motor": int(size*.13)}
    chosen = set(np.where(seeds)[0])
    chosen.update(i for i,u in enumerate(units) if u["type"] in ["DNp01", "DNg13"])
    for g, k in quotas.items():
        ids = np.where((groups==g) & (score>0))[0]
        chosen.update(ids[np.argsort(-score[ids], kind="stable")[:k]].tolist())
    # Preserve shortest causal witnesses from visual input to every selected node.
    # Dijkstra cost favors strong edges; it never adds a non-existent edge.
    import heapq
    adjacency = [[] for _ in range(n)]
    for i,j,f in zip(s,t,fractions):
        adjacency[i].append((j, -float(np.log(max(f,1e-12))) + 0.3))
    dist = np.full(n, np.inf); parent = np.full(n,-1,dtype=int); heap=[]
    for i in np.where(seeds)[0]: dist[i]=0; heapq.heappush(heap,(0,int(i)))
    while heap:
        d,i=heapq.heappop(heap)
        if d!=dist[i]: continue
        for j,cost in adjacency[i]:
            if d+cost<dist[j]:
                dist[j]=d+cost;parent[j]=i;heapq.heappush(heap,(d+cost,int(j)))
    # Retain existing bilateral counterparts so top-k selection itself does not
    # manufacture a left/right difference. Do not mirror or invent connections.
    pairs={}
    for i,u in enumerate(units):pairs.setdefault((u['type'],u['segment']),[]).append(i)
    previous=-1
    while previous!=len(chosen):
        previous=len(chosen)
        for i in list(chosen):chosen.update(pairs[(units[i]['type'],units[i]['segment'])])
        for target in list(chosen):
            i=target
            while parent[i]>=0:
                i=int(parent[i]);chosen.add(i)
    selected = sorted(chosen); mapping={v:i for i,v in enumerate(selected)}
    nodes=[]
    for old in selected:
        u=dict(units[old]);u["id"]=mapping[old];u["group"]=groups[old];u["selection_score"]=float(score[old]);nodes.append(u)
    keep=edge.source.isin(chosen)&edge.target.isin(chosen)
    sub=edge[keep]
    edges=[[mapping[int(i)],mapping[int(j)],int(c)] for i,j,c in sub.itertuples(index=False,name=None)]
    retained=np.bincount([e[1] for e in edges],weights=[e[2] for e in edges],minlength=len(nodes))
    for u in nodes: u["retained_input_fraction"]=float(retained[u["id"]]/max(1,u["total_input"]))
    graph={"metadata":{"dataset":"male-cns:v1.0","retrieved":"2026-09-06","license":"CC-BY-4.0",
           "attribution":"FlyEM, HHMI Janelia; Cambridge Drosophila Connectomics Group; MRC LMB; Google Research",
           "source_page":"https://male-cns.janelia.org/download/", "sources":full["sources"],
           "aggregation":"Traced, named neurons; type × soma/root side × VNC soma neuromere",
           "selection":"Six unsigned input-normalized propagation rounds; anatomical quotas plus strong-path ancestors and existing bilateral counterparts. DNp01 and DNg13 explicitly retained. All induced edges retained.",
           "normalization":"Every edge divided by target's total incoming synapses from ALL source segments, before any graph cropping or lesion.",
           "full_typed_neurons":full["typed_neurons"],"full_units":n,"full_type_edges":len(edge),
           "raw_segment_pairs":full["raw_pairs"], "nodes":len(nodes),"edges":len(edges),
           "represented_neurons":sum(u["count"] for u in nodes),"represented_synapses":sum(e[2] for e in edges),
           "not_included":"Untyped or non-Traced units, most CNS populations, muscles, gap junctions, receptor identities, calibrated physiology, retinal spatial computation, plasticity and embodiment."},
           "nodes":nodes,"edges":edges,"input_types":INPUT_TYPES}
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(graph,separators=(",",":")))
    print(json.dumps({k:v for k,v in graph["metadata"].items() if k!="sources"},indent=2),flush=True)
    print("Motor examples",[(u["type"],u["side"],u["segment"]) for u in nodes if u["group"]=="motor"][:15])
    return graph


if __name__ == "__main__":
    p=argparse.ArgumentParser();p.add_argument("--cache",type=Path,default=Path("data-cache"));p.add_argument("--output",type=Path,default=Path("dist/graph.json"));p.add_argument("--size",type=int,default=360)
    args=p.parse_args();download(args.cache);full,edges=aggregate(args.cache);select_graph(full,edges,args.output,args.size)
