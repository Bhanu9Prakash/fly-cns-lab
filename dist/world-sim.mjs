/** Connectome-driven illustrative embodiment. No MuJoCo physics or fitted controller.
 * x = initial forward, y = initial left, z = up. Distances are arena units.
 */
import {createRateNetwork} from './sim.mjs';
export const FLOOR=.45;
export const WORLD_DEFAULTS=Object.freeze({dt:.02,duration:12,scenario:'front',vision:true,
  motorConnected:true,intervention:'intact',inputGain:1.5,liftGain:1,gain:3});
export const ADAPTER=Object.freeze({powerScale:.018,yawScale:.008,jumpThreshold:.008,
  jumpVelocity:4.2,gravity:9.8,maxLift:20,thrust:7,drag:1.7,verticalDrag:1.1,yawTorque:6,yawDrag:3});
export const POWER_TYPES=Object.freeze(['DLMn a, b','DLMn c-f','DVMn 1a-c','DVMn 2a, b','DVMn 3a, b']);
export const INTERVENTIONS=Object.freeze({intact:[],giant:['DNp01'],power:POWER_TYPES,steering:['b2 MN'],motors:['TTMn',...POWER_TYPES,'b2 MN']});
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));

export function targetAt(t,scenario='front'){
  return {x:scenario==='static'?6:12-2.4*t,y:scenario==='left'?2:scenario==='right'?-2:0,
    z:1.1,radius:1.25,vx:scenario==='static'?0:-2.4,vy:0,vz:0};
}

/** Geometric looming proxy, not a compound-eye rendering or fitted LC response. */
export function sense(body,object){
  const dx=object.x-body.x,dy=object.y-body.y,dz=object.z-body.z;
  const distance=Math.max(.01,Math.hypot(dx,dy,dz));
  const bearing=Math.atan2(Math.sin(Math.atan2(dy,dx)-body.yaw),Math.cos(Math.atan2(dy,dx)-body.yaw));
  const radial=((object.vx-body.vx)*dx+(object.vy-body.vy)*dy+(object.vz-body.vz)*dz)/distance;
  const size=2*Math.atan2(object.radius,distance);
  const expansion=Math.max(0,-2*object.radius*radial/(distance*distance+object.radius*object.radius));
  const visible=Math.cos(bearing)>0&&Math.abs(dz)/distance<.92;
  const strength=visible?clamp(expansion*8,0,1.5)*Math.max(0,Math.cos(bearing)):0;
  const left=strength*clamp(1+1.7*Math.sin(bearing));
  const right=strength*clamp(1-1.7*Math.sin(bearing));
  return {left,right,size,expansion,bearing,distance,visible};
}

export function createWorld(graph,options={}){
  const o={...WORLD_DEFAULTS,...options};
  if(!['front','left','right','static'].includes(o.scenario))throw new Error('Invalid arena scenario');
  if(!INTERVENTIONS[o.intervention])throw new Error('Invalid intervention');
  if(o.dt!==.02||!Number.isFinite(o.duration)||o.duration<=0||o.duration>60)throw new Error('Invalid arena timing');
  for(const k of ['inputGain','liftGain','gain'])if(!Number.isFinite(o[k])||o[k]<0||o[k]>8)throw new Error('Invalid arena gain');
  const ids=(type,side)=>graph.nodes.filter(n=>n.type===type&&(!side||n.side===side)).map(n=>n.id);
  const inputs={LC4L:ids('LC4','L'),LC4R:ids('LC4','R'),LPLC2L:ids('LPLC2','L'),LPLC2R:ids('LPLC2','R')};
  const readoutIds={jump:ids('TTMn'),power:POWER_TYPES.flatMap(type=>ids(type)),steerL:ids('b2 MN','L'),steerR:ids('b2 MN','R'),descending:ids('DNp01')};
  for(const [key,value] of Object.entries({...inputs,...readoutIds}))if(!value.length)throw new Error('Graph lacks arena population '+key);
  const silenced=graph.nodes.filter(n=>INTERVENTIONS[o.intervention].includes(n.type)).map(n=>n.id);
  const network=createRateNetwork(graph,{gain:o.gain,dt:2,tau:20,silenced});
  const body={x:0,y:0,z:FLOOR,vx:0,vy:0,vz:0,yaw:0,yawRate:0};
  const input=new Float64Array(graph.nodes.length),history=[],events=[];
  const mean=ids=>ids.reduce((s,i)=>s+network.state[i],0)/ids.length;
  let t=0,sensory=sense(body,targetAt(0,o.scenario)),motor={power:0,jump:0,steering:0,rawPower:0,rawJump:0,rawSteerL:0,rawSteerR:0,descending:0},lastLaunch=-10;
  let airborne=false,everInput=false;
  const record=()=>history.push({t,...body,inputL:o.vision?sensory.left*o.inputGain:0,inputR:o.vision?sensory.right*o.inputGain:0,
    angularSize:sensory.size,expansion:sensory.expansion,descending:motor.descending,rawPower:motor.rawPower,
    rawJump:motor.rawJump,rawSteerL:motor.rawSteerL,rawSteerR:motor.rawSteerR,power:motor.power,
    steering:motor.steering,launch:t-lastLaunch<o.dt/2?1:0});
  record();
  return {
    options:o,body,network,history,events,readoutIds,silenced,
    get time(){return t;},get sensory(){return sensory;},get motor(){return motor;},
    get target(){return targetAt(t,o.scenario);},
    step(){
      if(t>=o.duration-1e-8)return false;
      sensory=sense(body,targetAt(t,o.scenario));input.fill(0);
      if(o.vision){
        const sizeFactor=clamp(sensory.size/.6);
        for(const side of ['L','R']){
          const value=o.inputGain*sensory[side==='L'?'left':'right'];
          for(const i of inputs['LC4'+side])input[i]=value;
          for(const i of inputs['LPLC2'+side])input[i]=value*sizeFactor;
        }
      }
      if(!everInput&&input.some(v=>v>.01)){events.push({t,label:'Visual feature input begins'});everInput=true;}
      for(let k=0;k<10;k++)network.step(input);
      const rawPower=mean(readoutIds.power),rawJump=mean(readoutIds.jump);
      const rawSteerL=mean(readoutIds.steerL),rawSteerR=mean(readoutIds.steerR);
      motor={rawPower,rawJump,rawSteerL,rawSteerR,descending:mean(readoutIds.descending),
        power:Math.tanh(rawPower/ADAPTER.powerScale),jump:rawJump,
        steering:Math.tanh((rawSteerR-rawSteerL)/ADAPTER.yawScale)};
      const connected=o.motorConnected?1:0,power=connected*motor.power;
      if(connected&&body.z<=FLOOR+.001&&rawJump>=ADAPTER.jumpThreshold&&t-lastLaunch>1){
        body.vz=ADAPTER.jumpVelocity;lastLaunch=t+o.dt;events.push({t:t+o.dt,label:'TTMn crosses the assumed launch threshold'});
      }
      const dt=o.dt;
      // Only motor activity enters these commands. No target geometry is read here.
      body.yawRate+=(connected*ADAPTER.yawTorque*motor.steering*power-ADAPTER.yawDrag*body.yawRate)*dt;
      body.yaw+=body.yawRate*dt;
      const offFloor=body.z>FLOOR+.001||body.vz>0;
      const thrust=offFloor?ADAPTER.thrust*power:0;
      body.vx+=(Math.cos(body.yaw)*thrust-ADAPTER.drag*body.vx)*dt;
      body.vy+=(Math.sin(body.yaw)*thrust-ADAPTER.drag*body.vy)*dt;
      body.vz+=(o.liftGain*ADAPTER.maxLift*power-ADAPTER.gravity-ADAPTER.verticalDrag*body.vz)*dt;
      body.x+=body.vx*dt;body.y+=body.vy*dt;body.z+=body.vz*dt;
      if(body.z<FLOOR){body.z=FLOOR;body.vz=0;body.vx*=.88;body.vy*=.88;}
      // Reflecting arena walls/ceiling are contact constraints, not steering.
      for(const axis of ['x','y'])if(Math.abs(body[axis])>14){body[axis]=clamp(body[axis],-14,14);body['v'+axis]*=-.25;}
      if(body.z>10){body.z=10;body.vz=Math.min(0,body.vz);}
      const nowAirborne=body.z>FLOOR+.08;
      if(nowAirborne&&!airborne)events.push({t:t+dt,label:'Body leaves the floor'});
      if(!nowAirborne&&airborne)events.push({t:t+dt,label:'Body returns to the floor'});
      airborne=nowAirborne;t=Math.round((t+dt)*1e9)/1e9;record();return true;
    }
  };
}
