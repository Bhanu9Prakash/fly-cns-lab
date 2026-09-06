import test from 'node:test';
import assert from 'node:assert/strict';
let readLabLocation;
try {({readLabLocation}=await import('../dist/navigation.mjs'));} catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('article links can select the lab view',()=>{
  assert.equal(typeof readLabLocation,'function');
  assert.equal(readLabLocation('https://example.test/?view=experiment').view,'experiment');
  assert.equal(readLabLocation('https://example.test/#method').view,'method');
});
test('an intervention link opens the documented controls without autoplay',()=>{
  assert.deepEqual(readLabLocation('https://example.test/?view=world&intervention=power&scenario=left&vision=off&motor=off'),{view:'world',world:{intervention:'power',scenario:'left',vision:false,motorConnected:false}});
});
test('unknown link settings cannot enter the simulation',()=>{
  assert.deepEqual(readLabLocation('https://example.test/?view=bad&intervention=bad&scenario=bad&vision=bad&motor=bad'),{view:'world',world:{}});
});
