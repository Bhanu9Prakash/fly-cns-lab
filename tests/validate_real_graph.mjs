import fs from 'node:fs';
import assert from 'node:assert/strict';
import {simulate,validateGraph,DEFAULTS} from '../dist/sim.mjs';
const graph=JSON.parse(fs.readFileSync(new URL('../dist/graph.json',import.meta.url)));
validateGraph(graph);
const pairs=new Set();const retained=Array(graph.nodes.length).fill(0);
for(const [s,t,w] of graph.edges){assert.ok(!pairs.has(`${s}:${t}`));pairs.add(`${s}:${t}`);assert.ok(Number.isSafeInteger(w));retained[t]+=w;}
assert.equal(graph.metadata.represented_neurons,graph.nodes.reduce((s,u)=>s+u.count,0));
assert.equal(graph.metadata.represented_synapses,graph.edges.reduce((s,e)=>s+e[2],0));
for(const u of graph.nodes){assert.equal(u.count,u.body_ids.length);assert.ok(retained[u.id]<=u.total_input);assert.ok(u.retained_input_fraction<=1);if(u.group==='motor')assert.ok(['cb_motor','vnc_motor'].includes(u.superclass));}
const baseline=simulate(graph),zero=simulate(graph,{amplitude:0});
assert.ok(zero.peaks.every(v=>v===0));
const results=[];
for(const preset of ['loom','motion_a','motion_b']){
  const b=simulate(graph,{preset});
  const gf=graph.nodes.filter(u=>u.type==='DNp01').map(u=>u.id);
  const lesion=simulate(graph,{preset,silenced:gf});
  assert.ok(gf.every(i=>lesion.peaks[i]===0));
  const top=b.motorIds[0];assert.ok(b.peaks[top]>0);
  const variants=['inhibitory','excitatory','omit'].map(glutamate=>{
    const r=simulate(graph,{preset,glutamate});assert.ok(r.activity.every(a=>a.every(v=>Number.isFinite(v)&&v>=0&&v<=1)));
    return {glutamate,top_motor:graph.nodes[r.motorIds[0]].key,top_peak:r.peaks[r.motorIds[0]]};
  });
  const onset=i=>b.times[b.activity.findIndex(row=>row[i]>1e-6)];
  const topInput=b.inputIds.find(i=>b.peaks[i]>0);assert.ok(onset(top)>onset(topInput));
  results.push({preset,top_motor:graph.nodes[top].key,peak:b.peaks[top],peak_model_time:b.peakTimes[top],first_above_1e_6:onset(top),
    gf_silenced_peak:lesion.peaks[top],gf_silenced_change_percent:100*(lesion.peaks[top]/b.peaks[top]-1),
    active_populations_above_0_001:Array.from(b.peaks).filter(v=>v>=0.001).length,glutamate_sensitivity:variants});
}
const pythonPath=process.argv[2];let maxAbsDifference=null;
if(pythonPath){const py=JSON.parse(fs.readFileSync(pythonPath));assert.equal(py.activity.length,baseline.activity.length);maxAbsDifference=0;
  for(let k=0;k<baseline.activity.length;k++){assert.equal(py.activity[k].length,baseline.activity[k].length);for(let i=0;i<graph.nodes.length;i++)maxAbsDifference=Math.max(maxAbsDifference,Math.abs(py.activity[k][i]-baseline.activity[k][i]));}
  assert.ok(maxAbsDifference<1e-12);
}
// Every modeled population must have a real directed structural route from a seed.
const adjacency=graph.nodes.map(()=>[]);for(const [s,t]of graph.edges)adjacency[s].push(t);
const seen=new Set(graph.nodes.filter(u=>graph.input_types.includes(u.type)).map(u=>u.id)),queue=[...seen];
for(let k=0;k<queue.length;k++)for(const t of adjacency[queue[k]])if(!seen.has(t)){seen.add(t);queue.push(t);}
assert.equal(seen.size,graph.nodes.length);
const report={date:'2026-09-06',model:'leaky-rate-v1',defaults:DEFAULTS,checks:{data_integrity:'pass',source_directed_reachability:'pass',no_input_silence:'pass',bounded_activity:'pass',motor_causal_order:'pass',silencing:'pass',python_javascript_max_abs_difference:maxAbsDifference},results,
  limitation:'Numerical and structural checks only. No physiological or behavioral validation. Browser visual/end-to-end QA was not performed.'};
fs.writeFileSync(new URL('../dist/validation.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
