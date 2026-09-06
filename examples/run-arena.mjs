/** Run the site's numerical arena from the downloaded project, without rendering. */
import {readFile} from 'node:fs/promises';
import {createWorld,FLOOR,INTERVENTIONS} from '../dist/world-sim.mjs';
const intervention=process.argv[2]||'intact';
if(!Object.hasOwn(INTERVENTIONS,intervention))throw new Error('Choose: '+Object.keys(INTERVENTIONS).join(', '));
const graph=JSON.parse(await readFile(new URL('../dist/arena-graph.json',import.meta.url),'utf8'));
const world=createWorld(graph,{intervention});
while(world.step()){}
console.log(JSON.stringify({intervention,maxHeightAboveFloor:Math.max(...world.history.map(f=>f.z))-FLOOR,
  finalHorizontalDisplacement:Math.hypot(world.body.x,world.body.y),units:'arbitrary arena units',events:world.events},null,2));
