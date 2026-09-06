import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../dist/sim.mjs';

// This causal chain detects reversed edges, same-step propagation, ignored
// inhibition, activity surviving a lesion, and changing lesion denominators.
const graph = {nodes:[
  {id:0,type:'LC4',side:'L',nt:'acetylcholine',total_input:100,group:'visual'},
  {id:1,type:'relay',side:'L',nt:'acetylcholine',total_input:100,group:'descending'},
  {id:2,type:'motor',side:'L',nt:'glutamate',total_input:100,group:'motor'}
],edges:[[0,1,100],[1,2,100]]};
const opts={preset:'loom',side:'L',amplitude:1,gain:1,duration:60,onset:10,pulse:20,dt:2,tau:10};
test('no external input leaves the network exactly silent',()=>{
  const r=simulate(graph,{...opts,amplitude:0});assert.ok(r.activity.every(a=>a.every(v=>v===0)));
});
test('directed propagation reaches the motor after its relay',()=>{
  const r=simulate(graph,opts);
  const first=i=>r.activity.findIndex(a=>a[i]>1e-10);
  assert.ok(first(0)>=5); assert.ok(first(1)>first(0));assert.ok(first(2)>first(1));
  assert.ok(r.peaks[2]>0);
});
test('silencing the sole relay eliminates downstream activity',()=>{
  const r=simulate(graph,{...opts,silenced:[1]});assert.equal(r.peaks[1],0);assert.equal(r.peaks[2],0);assert.ok(r.peaks[0]>0);
});
test('an inhibitory relay cannot excite a silent motor',()=>{
  const g=structuredClone(graph);g.nodes[1].nt='gaba';
  const signed=simulate(g,opts);const unsigned=simulate(g,{...opts,mode:'unsigned'});
  assert.equal(signed.peaks[2],0);assert.ok(unsigned.peaks[2]>0);
});
test('reversing edges cannot move activity upstream',()=>{
  const g={...graph,edges:graph.edges.map(([i,j,w])=>[j,i,w])};
  const r=simulate(g,opts);assert.equal(r.peaks[1],0);assert.equal(r.peaks[2],0);
});
test('activity stays finite and bounded even with strong feedback',()=>{
  const g={...graph,edges:[...graph.edges,[2,0,100]]};
  const a=simulate(g,{...opts,gain:8});const b=simulate(g,{...opts,gain:8});
  assert.deepEqual(a.activity,b.activity);
  assert.ok(a.activity.every(row=>row.every(v=>Number.isFinite(v)&&v>=0&&v<=1)));
});
test('invalid time step, indices and negative weights are rejected',()=>{
  assert.throws(()=>simulate(graph,{...opts,dt:0}));
  assert.throws(()=>simulate({...graph,edges:[[0,5,1]]},opts));
  assert.throws(()=>simulate({...graph,edges:[[0,1,-1]]},opts));
});
