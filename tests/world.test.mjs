import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
let world={};
try {world=await import('../dist/world-sim.mjs');} catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const graph=JSON.parse(fs.readFileSync(new URL('../dist/arena-graph.json',import.meta.url)));
const integrate=(options,seconds=8)=>{const w=world.createWorld(graph,options);for(let t=0;t<seconds-.001;t+=w.options.dt)w.step();return w;};

test('embodied model API is implemented',()=>assert.equal(typeof world.createWorld,'function'));
test('closing visual input leaves the circuit and grounded body at rest',()=>{
  const w=integrate({vision:false});assert.equal(Math.max(...w.network.state),0);
  assert.equal(w.body.x,0);assert.equal(w.body.y,0);assert.equal(w.body.z,world.FLOOR);
});
test('disconnecting motor output prevents powered motion despite sensory activity',()=>{
  const w=integrate({motorConnected:false});assert.ok(w.history.some(f=>f.power>0));
  assert.equal(w.body.x,0);assert.equal(w.body.y,0);assert.equal(w.body.z,world.FLOOR);
});
test('looming features depend on pose, approach direction and retinal expansion',()=>{
  const body={x:0,y:0,z:world.FLOOR,vx:0,vy:0,vz:0,yaw:0,yawRate:0};
  const object={x:6,y:2,z:world.FLOOR,radius:1,vx:-2,vy:0,vz:0};
  const a=world.sense(body,object),b=world.sense({...body,yaw:Math.PI},object),c=world.sense(body,{...object,vx:2});
  assert.ok(a.left>a.right);assert.equal(b.left+b.right,0);assert.equal(c.left+c.right,0);
  const near=world.sense({...body,x:3},object);assert.notEqual(a.left,near.left);
});
test('actual graph produces launch and flight with the declared illustrative adapter',()=>{
  const w=integrate({});assert.ok(w.history.some(f=>f.z>world.FLOOR+.4));
  assert.ok(w.history.some(f=>Math.hypot(f.x,f.y)>.5));
  assert.ok(w.history.some(f=>f.launch>0));
});
test('silencing power motor populations removes the adapter power channel',()=>{
  const w=integrate({intervention:'power'});
  assert.equal(Math.max(...w.history.map(f=>f.power)),0);
});
test('repeat runs are deterministic, finite, and activity bounded',()=>{
  const a=integrate({scenario:'left'}),b=integrate({scenario:'left'});
  assert.deepEqual(a.body,b.body);assert.deepEqual(a.history,b.history);
  for(const f of a.history)for(const v of Object.values(f))if(typeof v==='number')assert.ok(Number.isFinite(v));
  for(const v of a.network.state)assert.ok(v>=0&&v<=1);
});
