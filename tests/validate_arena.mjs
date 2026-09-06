/** Scientific and numerical checks, without browser/visual QA. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createWorld,FLOOR,ADAPTER,WORLD_DEFAULTS} from '../dist/world-sim.mjs';
import {validateGraph} from '../dist/sim.mjs';
const graph=JSON.parse(fs.readFileSync('dist/arena-graph.json'));
const base=JSON.parse(fs.readFileSync('dist/graph.json'));
validateGraph(graph);
const byKey=new Map(graph.nodes.map(n=>[n.key,n]));
assert.equal(byKey.size,graph.nodes.length);
const keys=new Map(graph.edges.map(([s,t,c])=>[`${s},${t}`,c]));
assert.equal(keys.size,graph.edges.length);
for(const n of base.nodes){assert.ok(byKey.has(n.key));assert.equal(byKey.get(n.key).total_input,n.total_input);}
for(const [s,t,c] of base.edges)assert.equal(keys.get(`${byKey.get(base.nodes[s].key).id},${byKey.get(base.nodes[t].key).id}`),c);
assert.equal(graph.metadata.represented_neurons,graph.nodes.reduce((s,n)=>s+n.count,0));
assert.equal(graph.metadata.represented_synapses,graph.edges.reduce((s,e)=>s+e[2],0));
const scenarios={intact:{},giant_silenced:{intervention:'giant'},wing_power_silenced:{intervention:'power'},steering_silenced:{intervention:'steering'},all_readouts_silenced:{intervention:'motors'},vision_closed:{vision:false},motor_disconnected:{motorConnected:false},stationary_target:{scenario:'static'},left_target:{scenario:'left'},right_target:{scenario:'right'},zero_lift:{liftGain:0},double_lift:{liftGain:2}};
const experiments={};
for(const [name,options] of Object.entries(scenarios)){
  const w=createWorld(graph,options);while(w.step()){}
  const peak=key=>Math.max(...w.history.map(f=>f[key]));
  experiments[name]={settings:w.options,max_height_above_floor:peak('z')-FLOOR,
    final_horizontal_displacement:Math.hypot(w.body.x,w.body.y),peak_wing_motor_activity:peak('rawPower'),
    peak_jump_motor_activity:peak('rawJump'),peak_abs_yaw_command:Math.max(...w.history.map(f=>Math.abs(f.steering))),
    first_launch:w.history.find(f=>f.launch)?.t??null,first_airborne:w.history.find(f=>f.z>FLOOR+.08)?.t??null,
    final_pose:{...w.body},events:w.events};
  for(const f of w.history)for(const v of Object.values(f))assert.ok(Number.isFinite(v));
  assert.ok(w.network.state.every(v=>v>=0&&v<=1));
}
for(const name of ['all_readouts_silenced','vision_closed','motor_disconnected','stationary_target']){
  assert.equal(experiments[name].max_height_above_floor,0);assert.equal(experiments[name].final_horizontal_displacement,0);
}
assert.equal(experiments.wing_power_silenced.peak_wing_motor_activity,0);
assert.equal(experiments.steering_silenced.peak_abs_yaw_command,0);
assert.ok(experiments.intact.max_height_above_floor>experiments.wing_power_silenced.max_height_above_floor);
assert.ok(experiments.intact.final_horizontal_displacement>0);
assert.ok(experiments.motor_disconnected.peak_wing_motor_activity>0);
const result={created:'2026-09-06',model:'fly-cns-embodiment-v1',default_settings:WORLD_DEFAULTS,adapter:ADAPTER,
  graph:{nodes:graph.nodes.length,edges:graph.edges.length,represented_neurons:graph.metadata.represented_neurons,represented_synapses:graph.metadata.represented_synapses,base_graph_preserved:true,minimum_nt_agreement:Math.min(...graph.nodes.map(n=>n.nt_agreement))},
  checks:{graph_integrity:'pass',original_nodes_edges_and_denominators_preserved:'pass',stationary_target_negative_control:'pass',visual_input_negative_control:'pass',motor_disconnect_negative_control:'pass',motor_interventions:'pass',all_scenarios_finite_bounded:'pass'},
  interpretation:'Numerical and structural checks only. Arbitrary arena units, unfitted sensory and body rules. No behavioral or physiological validation. Browser and visual QA not performed.',experiments};
fs.writeFileSync('dist/arena-validation.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({graph:result.graph,checks:result.checks,experiments:Object.fromEntries(Object.entries(experiments).map(([k,v])=>[k,{height:v.max_height_above_floor,displacement:v.final_horizontal_displacement,first_launch:v.first_launch,first_airborne:v.first_airborne}]))},null,2));
