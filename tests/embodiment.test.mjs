import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as neural from '../dist/sim.mjs';

const graph=JSON.parse(fs.readFileSync(new URL('../dist/graph.json',import.meta.url)));

test('stateful network is available for actual sensory feedback',()=>{
  assert.equal(typeof neural.createRateNetwork,'function');
});

test('stateful integration matches the independently established batch solver',()=>{
  const options={...neural.DEFAULTS,side:'L',silenced:graph.nodes.filter(n=>n.type==='DNp01').map(n=>n.id)};
  const batch=neural.simulate(graph,options),net=neural.createRateNetwork(graph,options);
  for(let k=0;k<batch.times.length-1;k++){
    const inputs=graph.nodes.map(n=>neural.inputAt(k*options.dt,n,options));
    net.step(inputs);
    for(let i=0;i<graph.nodes.length;i++)assert.ok(Math.abs(net.state[i]-batch.activity[k+1][i])<1e-13);
  }
});
