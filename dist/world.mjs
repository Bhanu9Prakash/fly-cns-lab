import {createWorld,sense,targetAt,FLOOR,ADAPTER} from './world-sim.mjs';
import {readLabLocation} from './navigation.mjs';
const $=id=>document.getElementById(id),clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const textValue=v=>v===0?'0.0000':Math.abs(v)<.0001?v.toExponential(2):v.toFixed(4);
const groupOrder=['visual','central','descending','cord','motor'];
const color=v=>{const q=v<=1e-6?0:clamp((Math.log10(v)+6)/6,0,1);return `rgb(${Math.round(43+145*q)},${Math.round(80+157*q)},${Math.round(86+23*q)})`;};

export async function initWorld(openMethod){
  const linked=readLabLocation(location.href).world;
  for(const [key,id] of [['scenario','world-scenario'],['intervention','world-intervention']])if(linked[key]!==undefined)$(id).value=linked[key];
  for(const [key,id] of [['vision','world-vision'],['motorConnected','world-connected']])if(linked[key]!==undefined)$(id).checked=linked[key];
  let graph,world,renderer,playing=false,frame=0,last=0,accumulator=0,selected=0,positions=[],states=[],lastEventText='';
  const options=()=>({scenario:$('world-scenario').value,intervention:$('world-intervention').value,
    vision:$('world-vision').checked,motorConnected:$('world-connected').checked,liftGain:+$('world-lift').value});
  let graphGroups,edges;
  const mean=(state,ids)=>ids.length?ids.reduce((s,i)=>s+state[i],0)/ids.length:0;
  function canvasSize(id){
    const canvas=$(id),w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return null;
    const dpr=Math.min(window.devicePixelRatio||1,2);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,w,h};
  }
  function updateButtons(){
    const end=world&&frame===world.history.length-1&&world.time>=world.options.duration-1e-8;
    $('world-play').textContent=playing?'Pause':end?'Replay experiment':frame>0?'Resume':'Start experiment';
    $('world-step').disabled=!world||playing||end;$('world-time').disabled=!world||world.history.length<2;
  }
  function reset(){
    playing=false;frame=0;accumulator=0;world=createWorld(graph,options());states=[world.network.state.slice()];lastEventText='';
    $('world-time').max=0;$('world-time').value=0;$('world-lift-out').textContent=(+world.options.liftGain).toFixed(1)+'×';
    $('world-status').textContent=renderer?.mode==='2d'?'2D fallback':'Ready';updateButtons();draw();
  }
  function advance(){
    if(frame<world.history.length-1){frame++;return true;}
    if(!world.step())return false;
    states.push(world.network.state.slice());frame++;$('world-time').max=world.history.length-1;return true;
  }
  function renderGraph(state){
    const size=canvasSize('world-network');if(!size)return;const {ctx,w,h}=size;ctx.clearRect(0,0,w,h);positions=[];
    graphGroups.forEach((ids,g)=>{const rows=Math.ceil(ids.length/3);ids.forEach((id,k)=>positions[id]={x:(g+.5)*w/5+(k%3-1)*w/22,y:8+(h-16)*(Math.floor(k/3)+.5)/rows});});
    ctx.lineWidth=.6;
    for(const [s,t] of edges){const a=positions[s],b=positions[t];ctx.strokeStyle=state[s]>.0001?'rgba(119,176,134,.19)':'rgba(65,101,104,.18)';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    const selectedEdges=graph.edges.filter(([s,t])=>s===selected||t===selected).sort((a,b)=>b[2]-a[2]).slice(0,24);
    for(const [s,t] of selectedEdges){const a=positions[s],b=positions[t],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;ctx.strokeStyle='rgba(210,227,210,.5)';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.fillStyle='#a3bca9';ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-4*dx/d-2*dy/d,b.y-4*dy/d+2*dx/d);ctx.lineTo(b.x-4*dx/d+2*dy/d,b.y-4*dy/d-2*dx/d);ctx.fill();}
    graph.nodes.forEach(n=>{const p=positions[n.id];ctx.fillStyle=world.silenced.includes(n.id)?'#b5755a':color(state[n.id]);ctx.beginPath();ctx.arc(p.x,p.y,n.id===selected?3.4:1.4,0,Math.PI*2);ctx.fill();if(n.id===selected){ctx.strokeStyle='#edf8dd';ctx.lineWidth=1;ctx.stroke();}});
  }
  function renderVision(f){
    const size=canvasSize('world-retina');if(!size)return;const {ctx,w,h}=size;
    ctx.fillStyle='#e5ebe5';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#c0cfc3';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(w/2,0);ctx.lineTo(w/2,h);ctx.stroke();ctx.setLineDash([]);
    const object=targetAt(f.t,world.options.scenario),s=sense(f,object);
    if(world.options.vision&&s.visible){const x=w/2-s.bearing/(Math.PI/2)*w/2;const elevation=Math.atan2(object.z-f.z,Math.hypot(object.x-f.x,object.y-f.y));const y=h/2-elevation/(Math.PI/2)*h/2;ctx.fillStyle='#303e41';ctx.beginPath();ctx.arc(x,y,Math.max(1,s.size/Math.PI*w/2),0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#4f685b';ctx.font='10px monospace';ctx.fillText('LEFT',8,h-8);ctx.textAlign='right';ctx.fillText('RIGHT',w-8,h-8);ctx.textAlign='left';
    if(!world.options.vision||!s.visible){ctx.fillStyle=world.options.vision?'#e5ebe5':'#d7e0d8';ctx.fillRect(0,0,w,h);ctx.fillStyle='#3c5647';ctx.font='12px system-ui';ctx.textAlign='center';ctx.fillText(world.options.vision?'Target outside forward field':'Visual input closed',w/2,h/2+4);ctx.textAlign='left';}
    $('world-input-left').textContent=f.inputL.toFixed(3);$('world-input-right').textContent=f.inputR.toFixed(3);
  }
  function renderTraces(){
    const size=canvasSize('world-traces');if(!size)return;const {ctx,w,h}=size;ctx.clearRect(0,0,w,h);
    const rows=world.history,f=rows[frame],left=53,right=12,top=15,bottom=24,ph=(h-top-bottom)/3;
    const traces=[{name:'Input',get:r=>Math.max(r.inputL,r.inputR),color:'#597782',min:.1},{name:'Wing MN',get:r=>r.rawPower,color:'#b36a2c',min:.001},{name:'Altitude',get:r=>r.z-FLOOR,color:'#176148',min:.1}];
    const x=t=>left+(w-left-right)*t/world.options.duration;
    traces.forEach((tr,i)=>{const max=Math.max(tr.min,...rows.map(tr.get))*1.1,base=top+(i+1)*ph-7,y=v=>base-(ph-14)*v/max;
      ctx.fillStyle='#62766c';ctx.font='9px monospace';ctx.textAlign='right';ctx.fillText(tr.name,left-7,base-18);ctx.fillText(max.toFixed(i===1?3:1),left-7,base-6);ctx.textAlign='left';
      ctx.strokeStyle='#e4ebe4';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,base);ctx.lineTo(w-right,base);ctx.stroke();
      ctx.strokeStyle=tr.color;ctx.lineWidth=1.6;ctx.beginPath();rows.forEach((r,k)=>k?ctx.lineTo(x(r.t),y(tr.get(r))):ctx.moveTo(x(r.t),y(tr.get(r))));ctx.stroke();
    });
    ctx.strokeStyle='#80938b';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x(f.t),top-4);ctx.lineTo(x(f.t),h-bottom);ctx.stroke();ctx.setLineDash([]);
    ctx.font='10px monospace';ctx.fillStyle='#68796d';ctx.textAlign='center';for(let t=0;t<=12;t+=3)ctx.fillText(t+'s',x(t),h-6);ctx.textAlign='left';
  }
  function renderEvents(f){
    const visible=world.events.filter(e=>e.t<=f.t+1e-9),key=visible.map(e=>e.t+e.label).join('|');
    if(key!==lastEventText||!f.t){$('world-events').replaceChildren();for(const e of visible.slice(-6)){const li=document.createElement('li'),time=document.createElement('time'),label=document.createElement('span');time.textContent=e.t.toFixed(2)+' s';label.textContent=e.label;li.append(time,label);$('world-events').append(li);}if(!visible.length){const li=document.createElement('li');li.textContent=f.t>0?'No visual expansion is driving the circuit.':'Start the experiment to watch the sequence.';$('world-events').append(li);}lastEventText=key;}
    let note;
    if(!world.options.vision)note='Visual drive is closed. From rest, the circuit stays silent and the fly stays on the floor.';
    else if(!world.options.motorConnected)note='Neural activity can propagate, but the body receives no motor commands.';
    else if(world.options.intervention==='power')note='Wing power is silenced. TTMn can still launch a brief jump; sustained lift and forward thrust are absent.';
    else if(world.options.intervention==='motors')note='The selected body readout neurons are silenced. Upstream visual and brain activity can still occur.';
    else if(world.options.intervention==='giant')note='DNp01 is silenced. Other routes remain, so loss of the giant fibers need not abolish movement in this model.';
    else if(world.options.intervention==='steering')note='The b2 readout is silenced. The assumed yaw command vanishes while launch and power remain available.';
    else if(world.options.scenario==='static')note='A stationary object has no expansion for a resting fly. This model therefore receives no looming drive.';
    else if(f.z>FLOOR+.08&&f.power>.35)note='Wing motor activity is producing assumed lift and thrust. The changing viewpoint now changes the next visual input.';
    else if(f.z>FLOOR+.08)note='Motor drive has weakened. Inertia and gravity now dominate the body’s trajectory.';
    else if(f.t>1)note='The fly is on the floor. Review the recorded timeline or change a circuit intervention and rerun.';
    else note='Watch visual input reach descending and motor populations. The launch threshold and flight forces are explicit assumptions.';
    if($('world-explanation').textContent!==note)$('world-explanation').textContent=note;
  }
  function draw(){
    if(!world||$('world-view').hidden)return;
    const f=world.history[frame],state=states[frame],air=f.z>FLOOR+.08;
    renderer?.draw(f,world.history,world.options,$('world-camera').value);
    $('world-state').textContent=!f.t?'Ready to run':air?f.power>.35&&world.options.motorConnected?'Powered flight':'Airborne':'On the floor';
    $('world-clock').textContent=f.t.toFixed(2)+' / 12.00 s';$('world-time').value=frame;$('world-time-out').textContent=f.t.toFixed(2)+' s';
    $('world-altitude').innerHTML=(f.z-FLOOR).toFixed(2)+' <small>au</small>';
    $('world-speed-value').innerHTML=Math.hypot(f.vx,f.vy).toFixed(2)+' <small>au/s</small>';
    $('world-power').innerHTML=(100*f.power*(world.options.motorConnected?1:0)).toFixed(1)+' <small>%</small>';
    $('world-turn').textContent=(f.steering*(world.options.motorConnected?1:0)).toFixed(3);
    const visual=graph.nodes.filter(n=>['LC4','LPLC2'].includes(n.type)).map(n=>n.id);
    $('live-visual').textContent=textValue(mean(state,visual));$('live-dn').textContent=textValue(f.descending);
    $('live-jump').textContent=textValue(f.rawJump);$('live-wing').textContent=textValue(f.rawPower);$('live-steer').textContent=f.rawSteerL.toFixed(4)+' / '+f.rawSteerR.toFixed(4);
    const n=graph.nodes[selected];$('world-node-info').replaceChildren();const value=document.createElement('strong');value.textContent=textValue(state[selected]);const desc=document.createElement('div');desc.textContent=`${n.count} neuron${n.count===1?'':'s'} · ${n.nt} · ${(100*n.retained_input_fraction).toFixed(1)}% of input retained${world.silenced.includes(selected)?' · SILENCED':''}`;$('world-node-info').append(value,desc);
    renderGraph(state);renderVision(f);renderTraces();renderEvents(f);updateButtons();
  }
  function animate(now){
    if(playing&&!document.hidden&&!$('world-view').hidden){
      accumulator+=Math.min(.1,(now-last)/1000)*+$('world-speed').value;
      let advanced=false;
      while(accumulator>=world.options.dt){accumulator-=world.options.dt;if(!advance()){playing=false;$('world-status').textContent='Run complete';break;}advanced=true;}
      if(advanced||!playing)draw();
    }
    last=now;requestAnimationFrame(animate);
  }
  try{
    const response=await fetch('./arena-graph.json');if(!response.ok)throw new Error('Could not load the arena connectivity graph. Please reload.');graph=await response.json();
    graphGroups=groupOrder.map(group=>graph.nodes.filter(n=>n.group===group).map(n=>n.id));
    edges=[...graph.edges].sort((a,b)=>b[2]/Math.max(1,graph.nodes[b[1]].total_input)-a[2]/Math.max(1,graph.nodes[a[1]].total_input)).slice(0,450);
    selected=graph.nodes.find(n=>n.type==='DNp01'&&n.side==='R').id;
    for(const n of graph.nodes)$('world-node').add(new Option(n.type+' · '+n.side+(n.segment?' / '+n.segment:''),n.id,false,n.id===selected));
    $('arena-provenance').textContent=`${graph.nodes.length} populations · ${graph.metadata.represented_neurons.toLocaleString()} neurons · ${graph.edges.length.toLocaleString()} measured links`;
    const {createArenaRenderer}=await import('./world-render.mjs');renderer=await createArenaRenderer($('world-canvas'));
    $('world-loading').hidden=true;$('world-play').disabled=false;$('world-reset').disabled=false;
    reset();
    $('world-play').onclick=()=>{if(playing){playing=false;$('world-status').textContent='Paused';}else{if(frame===world.history.length-1&&world.time>=world.options.duration-1e-8)reset();playing=true;accumulator=0;last=performance.now();$('world-status').textContent=frame<world.history.length-1?'Replaying':'Running';}updateButtons();};
    $('world-step').onclick=()=>{playing=false;advance();$('world-status').textContent='Stepped 20 ms';draw();};
    $('world-reset').onclick=reset;
    for(const id of ['world-scenario','world-intervention','world-vision','world-connected','world-lift'])$(id).onchange=reset;
    $('world-lift').oninput=()=>$('world-lift-out').textContent=(+$('world-lift').value).toFixed(1)+'×';
    $('world-time').oninput=()=>{playing=false;frame=+$('world-time').value;$('world-status').textContent='Reviewing';draw();};
    $('world-camera').onchange=draw;
    $('world-node').onchange=()=>{selected=+$('world-node').value;draw();};
    $('world-network').onclick=e=>{const r=$('world-network').getBoundingClientRect();let best=-1,d=81;positions.forEach((p,i)=>{const v=(p.x-(e.clientX-r.left))**2+(p.y-(e.clientY-r.top))**2;if(v<d){d=v;best=i;}});if(best>=0){selected=best;$('world-node').value=best;draw();}};
    for(const button of document.querySelectorAll('[data-inspect]'))button.onclick=()=>{selected=graph.nodes.find(n=>n.type===button.dataset.inspect&&n.side==='R')?.id??0;$('world-node').value=selected;draw();};
    $('world-read-method').onclick=openMethod;
    $('world-export').onclick=()=>{const data={schema:'fly-cns-embodiment-v1',created:new Date().toISOString(),options:world.options,adapter:ADAPTER,units:'arbitrary arena units and model seconds',provenance:graph.metadata,nodes:graph.nodes,frames:world.history,activity:states.map(s=>Array.from(s)),events:world.events};const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='fly-arena-run.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    new ResizeObserver(draw).observe($('arena-scene'));window.addEventListener('resize',draw);
    document.addEventListener('visibilitychange',()=>{if(document.hidden){playing=false;updateButtons();}});
    requestAnimationFrame(animate);
    return {setActive(active){if(!active){if(playing)$('world-status').textContent='Paused';playing=false;updateButtons();}else requestAnimationFrame(draw);}};
  }catch(error){$('world-loading').textContent=error.message;$('world-status').textContent='Load failed';$('arena-provenance').textContent='Arena unavailable';return {setActive(){}};}
}
