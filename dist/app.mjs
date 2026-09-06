import {DEFAULTS,PRESETS,signFor,simulate,summaryRows} from './sim.mjs';
import {initWorld} from './world.mjs';
import {readLabLocation} from './navigation.mjs';

const $=id=>document.getElementById(id),fmt=n=>n.toLocaleString('en-US');
const groups=['visual','central','descending','cord','motor'];
const groupNames={visual:'Visual population',central:'Central brain',descending:'Descending neuron',cord:'Nerve cord circuit',motor:'Motor neuron'};
const ntNames={acetylcholine:'Acetylcholine',glutamate:'Glutamate',gaba:'GABA',histamine:'Histamine',unclear:'Unknown',dopamine:'Dopamine',octopamine:'Octopamine',serotonin:'Serotonin'};
const traceColors=['#176148','#b05a30','#3e72b0'];
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let graph,run,baseline,worker,request=0,frame=0,selected=0,playing=false,lastTick=0,accumulator=0,firstRun=true;
let disabled=new Set(),positions=[],renderEdges=[],motorTraceIds=[],pendingOptions,debounce,startNew=true;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const label=u=>`${u.type} · ${u.side}${u.segment?' / '+u.segment:''}`;
const activityText=v=>v===0?'0.0000':v<0.0001?v.toExponential(2):v.toFixed(4);
function config(){return {...DEFAULTS,preset:$('preset').value,side:$('side').value,amplitude:+$('amplitude').value,gain:+$('gain').value,mode:$('mode').value,glutamate:$('glutamate').value,silenced:[...disabled].sort((a,b)=>a-b)};}
let worldUI;
function setTab(name){
  for(const tab of ['world','experiment','method']){
    const active=tab===name;$(tab+'-view').hidden=!active;$(tab+'-tab').classList.toggle('active',active);$(tab+'-tab').setAttribute('aria-pressed',String(active));
  }
  if(name!=='experiment'){playing=false;updatePlay();}else if(run){layout();draw();}
  worldUI?.setActive(name==='world');
  if(location.hash!=='#'+name)history.replaceState(null,'','#'+name);
}
$('world-tab').onclick=()=>setTab('world');$('experiment-tab').onclick=()=>setTab('experiment');$('method-tab').onclick=()=>setTab('method');
const openMethod=()=>{setTab('method');window.scrollTo({top:0,behavior:reducedMotion?'instant':'smooth'});};
$('read-method').onclick=openMethod;
initWorld(openMethod).then(ui=>{worldUI=ui;worldUI.setActive(!$('world-view').hidden);});
setTab(readLabLocation(location.href).view);
window.addEventListener('hashchange',()=>setTab(readLabLocation(location.href).view));
function status(message){$('compute-status').textContent=message;}
function updatePlay(){if(!run)return;const restart=startNew||frame===run.times.length-1;$('play').textContent=playing?'Ⅱ Pause activity':restart?'▶ Run stimulus':'▶ Resume activity';$('play').setAttribute('aria-label',playing?'Pause activity playback':restart?'Run stimulus and play activity':'Resume activity playback');}
function compute(autoplay=false){
  if(!graph)return;
  clearTimeout(debounce);playing=false;updatePlay();$('play').disabled=true;status('Computing…');
  const o=config();pendingOptions={autoplay};
  $('amplitude-out').textContent=o.amplitude.toFixed(1);$('gain-out').textContent=o.gain.toFixed(1);
  $('glutamate').disabled=o.mode==='unsigned';
  $('stimulus-note').textContent=o.preset==='loom'?'Abstract drive into LC4 and LPLC2, after visual feature extraction.':o.preset==='none'?'No external drive. Every population starts at zero activity.':`Abstract drive into ${PRESETS[o.preset].types.join(' and ')} motion channels.`;
  const id=++request;
  if(worker)worker.postMessage({id,options:o});
  else setTimeout(()=>{
    try{const b=simulate(graph,{...o,silenced:[]});receive({id,run:o.silenced.length?simulate(graph,o):b,baseline:b});}
    catch(error){receive({id,error:error.message});}
  },0);
}
function receive(data){
  if(data.id!==request)return;
  if(data.error){status('Unable to run');$('loading-note').textContent=data.error;$('loading-note').hidden=false;return;}
  run=data.run;baseline=data.baseline;
  motorTraceIds=baseline.motorIds.slice(0,3);
  if(!motorTraceIds.some(i=>baseline.peaks[i]>0))motorTraceIds=run.motorIds.slice(0,3);
  frame=firstRun?Math.round(180/run.options.dt):0;
  playing=!firstRun && pendingOptions?.autoplay && !reducedMotion;
  firstRun=false;lastTick=0;accumulator=0;startNew=!playing;
  $('loading-note').hidden=true;$('play').disabled=false;status('Ready');updatePlay();
  populateSelect();renderInspector();renderResults();layout();draw();
}
function populateSelect(){
  const query=$('node-search').value.toLowerCase().trim();
  const matches=graph.nodes.filter(u=>`${u.type} ${u.side} ${u.segment} ${u.group}`.toLowerCase().includes(query));
  $('node-select').replaceChildren();
  if(!matches.length){const o=new Option('No matching population','');o.disabled=true;$('node-select').add(o);return;}
  if(!matches.some(u=>u.id===selected))selected=matches[0].id;
  for(const u of matches)$('node-select').add(new Option(label(u),String(u.id),false,u.id===selected));
}
function selectNode(id){
  selected=id;$('node-search').value='';populateSelect();renderInspector();draw();
}
function renderInspector(){
  if(!graph||!run)return;const u=graph.nodes[selected],sign=signFor(u.nt,run.options);
  $('node-detail').innerHTML=`<h3 class="node-type">${escapeHTML(u.type)}</h3><p class="node-sub">${escapeHTML(groupNames[u.group])} · ${escapeHTML(u.side)}${u.segment?' / '+escapeHTML(u.segment):''}</p>
    <dl class="node-facts"><dt>Neurons in this unit</dt><dd>${fmt(u.count)}</dd><dt>Transmitter</dt><dd>${escapeHTML(ntNames[u.nt]||u.nt)}</dd><dt>Modeled output</dt><dd>${run.options.mode==='unsigned'?'Unsigned':sign>0?'Excitatory':sign<0?'Inhibitory':'Omitted'}</dd><dt>Input retained</dt><dd>${(100*u.retained_input_fraction).toFixed(1)}%</dd><dt>Peak activity</dt><dd>${activityText(run.peaks[selected])}</dd></dl>
    <div class="node-current"><span>Activity now</span><strong id="node-current-value">0.0000</strong></div>
    <a class="source-link" href="https://neuprint.janelia.org/?dataset=male-cns%3Av1.0" target="_blank" rel="noreferrer" title="Open neuPrint; search for this cell type or the body IDs in the graph download">Explore in neuPrint ↗</a>`;
  $('silence').disabled=false;$('silence').textContent=disabled.has(selected)?'Restore this population':'Silence this population';$('silence').classList.toggle('silenced',disabled.has(selected));
  $('lesion-state').hidden=disabled.size===0;$('lesion-count').textContent=`${disabled.size} silenced`;
  const outgoing=graph.edges.filter(e=>e[0]===selected).sort((a,b)=>b[2]-a[2]).slice(0,4);
  $('outgoing').replaceChildren();
  if(!outgoing.length)$('outgoing').textContent='No outgoing edges in this subnetwork.';
  for(const [,t,w] of outgoing){const row=document.createElement('div');row.className='connection-row';const button=document.createElement('button');button.textContent=label(graph.nodes[t]);button.onclick=()=>selectNode(t);const count=document.createElement('span');count.textContent=fmt(w)+' syn';row.append(button,count);$('outgoing').append(row);}
}
function renderResults(){
  const ranked=[...run.motorIds].sort((a,b)=>Math.max(run.peaks[b],baseline.peaks[b])-Math.max(run.peaks[a],baseline.peaks[a]));
  const top=ranked.slice(0,6);$('motor-rows').replaceChildren();
  const max=Math.max(1e-10,...top.map(i=>Math.max(run.peaks[i],baseline.peaks[i])));
  for(const i of top){
    const u=graph.nodes[i],tr=document.createElement('tr'),name=document.createElement('td'),b=document.createElement('button');b.textContent=label(u);b.onclick=()=>selectNode(i);name.append(b);
    const value=document.createElement('td');value.className='num';value.innerHTML=`<span class="peak-bar" aria-hidden="true"><i style="width:${100*run.peaks[i]/max}%"></i></span>${activityText(run.peaks[i])}`;
    const change=document.createElement('td');change.className='num';
    if(!disabled.size)change.textContent='Intact';
    else if(baseline.peaks[i]<1e-10)change.textContent=run.peaks[i]>1e-10?'New activity':'0%';
    else{const delta=100*(run.peaks[i]/baseline.peaks[i]-1);change.textContent=`${delta>0?'+':''}${delta.toFixed(1)}%`;change.classList.add(delta<-0.05?'negative':delta>0.05?'positive':'unchanged');}
    tr.append(name,value,change);$('motor-rows').append(tr);
  }
  const active=graph.nodes.filter((u,i)=>run.peaks[i]>=0.001).length;
  const intactTop=baseline.motorIds[0];
  if(run.options.preset==='none'||run.options.amplitude===0)$('result-insight').textContent='No external input: the model stays silent. This is the negative control.';
  else if(disabled.size && baseline.peaks[intactTop]>0){const delta=100*(run.peaks[intactTop]/baseline.peaks[intactTop]-1);$('result-insight').textContent=`${graph.nodes[intactTop].type} (${graph.nodes[intactTop].side}) peak changes by ${delta>0?'+':''}${delta.toFixed(1)}% versus the intact circuit. This is a model intervention result.`;}
  else $('result-insight').textContent=`${active} of ${graph.nodes.length} populations exceed 0.001 normalized activity during this run. The cutoff is a display convention, not a biological firing threshold.`;
  $('trace-legend').innerHTML=motorTraceIds.map((i,k)=>`<span><i style="--c:${traceColors[k]}"></i>${escapeHTML(label(graph.nodes[i]))}</span>`).join('');
  if(disabled.size)$('trace-legend').insertAdjacentHTML('beforeend','<span>Dashed: intact</span>');
}
function canvasSize(id){
  const canvas=$(id),rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
  if(rect.width<=0||rect.height<=0)return null;
  const width=Math.round(rect.width*dpr),height=Math.round(rect.height*dpr);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,w:rect.width,h:rect.height};
}
function layout(){
  if(!run||$('experiment-view').hidden)return;
  const size=canvasSize('network');if(!size)return;const {w,h}=size;positions=Array(graph.nodes.length);
  const band=(w-26)/5,small=w<540,cols=small?2:3;
  for(let g=0;g<groups.length;g++){
    const ids=graph.nodes.filter(u=>u.group===groups[g]).map(u=>u.id).sort((a,b)=>graph.nodes[a].side.localeCompare(graph.nodes[b].side)||baseline.peaks[b]-baseline.peaks[a]||a-b);
    const rows=Math.ceil(ids.length/cols);
    ids.forEach((i,k)=>{
      const col=k%cols,row=Math.floor(k/cols);
      positions[i]={x:13+band*(g+.5)+(col-(cols-1)/2)*band*(small?.30:.23),y:24+(h-54)*(row+.5)/Math.max(1,rows)};
    });
  }
  renderEdges=[...graph.edges].sort((a,b)=>b[2]/Math.max(1,graph.nodes[b[1]].total_input)-a[2]/Math.max(1,graph.nodes[a[1]].total_input)).slice(0,700);
  $('graph-footnote').textContent=`All ${fmt(graph.nodes.length)} populations and ${fmt(graph.edges.length)} links are simulated. The 700 strongest input shares and selected links are drawn.`;
}
function level(v){return v<=1e-6?0:Math.min(1,Math.max(0,(Math.log10(v)+6)/6));}
function color(l,alpha=1){
  const low=[46,91,99],high=[185,241,106];return `rgba(${low.map((v,i)=>Math.round(v+(high[i]-v)*l)).join(',')},${alpha})`;
}
function drawNetwork(){
  const size=canvasSize('network');if(!size||!run)return;const {ctx,w,h}=size;ctx.clearRect(0,0,w,h);
  const vals=run.activity[frame];
  ctx.strokeStyle='#2a3e42';ctx.lineWidth=.5;ctx.setLineDash([2,5]);
  for(let g=1;g<5;g++){const x=13+(w-26)*g/5;ctx.beginPath();ctx.moveTo(x,10);ctx.lineTo(x,h-10);ctx.stroke();}ctx.setLineDash([]);
  const selectedEdges=graph.edges.filter(e=>e[0]===selected||e[1]===selected).sort((a,b)=>b[2]-a[2]).slice(0,35);
  function edge([s,t,count],highlight=false){
    const a=positions[s],b=positions[t];if(!a||!b||s===t)return;
    const l=level(vals[s]),sign=signFor(graph.nodes[s].nt,run.options);
    const disabledEdge=disabled.has(s)||disabled.has(t);const active=l>.08&&!disabledEdge&&sign!==0;
    const strength=count/Math.max(1,graph.nodes[t].total_input);
    ctx.strokeStyle=highlight?(sign<0?'rgba(236,164,126,.7)':'rgba(205,225,215,.7)'):(active?color(l,.13+l*.3):'rgba(80,109,116,.11)');
    ctx.lineWidth=highlight?1.1:Math.min(1.5,.3+strength*4);
    if(sign<0)ctx.setLineDash([3,3]);else ctx.setLineDash([]);
    const dx=b.x-a.x,offset=Math.max(15,Math.abs(dx)*.42);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.bezierCurveTo(a.x+offset,a.y,b.x-offset,b.y,b.x,b.y);ctx.stroke();ctx.setLineDash([]);
    if(highlight||active&&strength>.035){
      ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.moveTo(b.x-4,b.y);ctx.lineTo(b.x-8,b.y-2.4);ctx.lineTo(b.x-8,b.y+2.4);ctx.closePath();ctx.fill();
    }
  }
  for(const e of renderEdges)edge(e);
  for(const e of selectedEdges)edge(e,true);
  const labelIds=new Set([selected,...run.inputIds,...motorTraceIds]);
  // Label a small, data-driven set; full names remain available via selection.
  const defaultLabels=graph.nodes.filter(u=>['DNp01','DNg13'].includes(u.type));for(const u of defaultLabels)labelIds.add(u.id);
  for(let i=0;i<graph.nodes.length;i++){
    const p=positions[i];if(!p)continue;const l=level(vals[i]),off=disabled.has(i),isSelected=i===selected;
    const r=isSelected?5:run.inputIds.includes(i)?3.9:2.5+l*1.1;
    if(l>.5&&!off){ctx.fillStyle=color(l,.07);ctx.beginPath();ctx.arc(p.x,p.y,r+4,0,2*Math.PI);ctx.fill();}
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,2*Math.PI);ctx.fillStyle=off?'#755149':l>0?color(l):'#345057';ctx.fill();
    if(isSelected||run.inputIds.includes(i)){ctx.strokeStyle=isSelected?'#f2f7ea':'#aed39f';ctx.lineWidth=1;ctx.stroke();}
    if(off){ctx.strokeStyle='#efa787';ctx.beginPath();ctx.moveTo(p.x-4,p.y-4);ctx.lineTo(p.x+4,p.y+4);ctx.stroke();}
  }
  const used=[];ctx.font=`${w<540?9:10}px "IBM Plex Mono",monospace`;
  for(const i of [selected,...labelIds]){
    if(i!==selected&&w<460&&graph.nodes[i].side==='L'&&!run.inputIds.includes(i))continue;
    const p=positions[i],text=graph.nodes[i].type+(graph.nodes[i].side==='U'?'':' '+graph.nodes[i].side);
    const width=ctx.measureText(text).width;let x=p.x+7;if(x+width>w-3)x=p.x-7-width;const y=p.y-7;
    if(i!==selected&&used.some(r=>Math.abs(r.y-y)<12&&x<r.x+r.w+3&&x+width>r.x-3))continue;
    ctx.fillStyle='rgba(16,27,30,.85)';ctx.fillRect(x-2,y-9,width+4,13);
    ctx.fillStyle=i===selected?'#ffffff':'#b9ccca';ctx.fillText(text,x,y);used.push({x,y,w:width});
  }
}
function drawStimulus(){
  const size=canvasSize('stimulus');if(!size)return;const {ctx,w,h}=size,o=run?.options||config(),t=run?run.times[frame]:0;
  ctx.fillStyle='#dee5e2';ctx.fillRect(0,0,w,h);
  const on=t>=o.onset&&t<o.onset+o.pulse&&o.amplitude>0&&o.preset!=='none';const q=Math.max(0,Math.min(1,(t-o.onset)/o.pulse));
  if(on){ctx.save();ctx.globalAlpha=Math.min(1,o.amplitude/1.2);
    if(o.preset==='loom'){ctx.fillStyle='#17252b';ctx.beginPath();ctx.arc(w/2,h/2,4+q*q*h*.78,0,Math.PI*2);ctx.fill();}
    else{const dir=o.preset==='motion_a'?1:-1,step=30,offset=dir*q*120;ctx.fillStyle='#546a70';for(let x=-150;x<w+150;x+=step*2)ctx.fillRect(x+offset,0,step,h);}
    ctx.restore();
  }
  ctx.fillStyle='#172d32';ctx.font='10px "IBM Plex Mono",monospace';ctx.fillText(on?'FEATURE INPUT ON':o.preset==='none'?'NO INPUT':'STIMULUS WINDOW 60–240 ms',9,h-9);
}
function drawTraces(){
  const size=canvasSize('traces');if(!size||!run)return;const {ctx,w,h}=size;
  ctx.clearRect(0,0,w,h);const pad={l:49,r:12,t:14,b:28},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b;
  const values=motorTraceIds.flatMap(i=>[run.peaks[i],baseline.peaks[i]]);const ymax=Math.max(.005,...values)*1.16;
  const x=t=>pad.l+pw*t/run.options.duration,y=v=>h-pad.b-ph*v/ymax;
  ctx.fillStyle='#eaf2e9';ctx.fillRect(x(run.options.onset),pad.t,x(run.options.onset+run.options.pulse)-x(run.options.onset),ph);
  ctx.font='10px "IBM Plex Mono",monospace';ctx.lineWidth=1;
  for(let k=0;k<4;k++){
    const v=ymax*k/3,yy=y(v);ctx.strokeStyle='#e5ebea';ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(w-pad.r,yy);ctx.stroke();ctx.fillStyle='#677e82';ctx.textAlign='right';ctx.fillText(v.toFixed(3),pad.l-7,yy+3);
  }
  ctx.textAlign='center';for(let t=0;t<=600;t+=150)ctx.fillText(String(t),x(t),h-9);
  function line(data,id,color,dashed){ctx.strokeStyle=color;ctx.lineWidth=dashed?1.25:2;ctx.setLineDash(dashed?[4,4]:[]);ctx.beginPath();for(let k=0;k<data.times.length;k++){const xx=x(data.times[k]),yy=y(data.activity[k][id]);if(k===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);}ctx.stroke();ctx.setLineDash([]);}
  motorTraceIds.forEach((id,k)=>{if(disabled.size)line(baseline,id,traceColors[k],true);line(run,id,traceColors[k],false);});
  ctx.strokeStyle='#a8b8b7';ctx.lineWidth=1;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(x(run.times[frame]),pad.t);ctx.lineTo(x(run.times[frame]),h-pad.b);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#617b72';ctx.font='9px "IBM Plex Mono",monospace';ctx.textAlign='left';ctx.fillText('INPUT',x(run.options.onset)+5,pad.t+11);
}
function draw(){
  if(!run||$('experiment-view').hidden)return;
  $('time').value=frame;$('network-time').textContent=`t = ${run.times[frame]} ms`;
  const current=$('node-current-value');if(current)current.textContent=activityText(run.activity[frame][selected]);
  drawNetwork();drawStimulus();drawTraces();
}
function animate(now){
  if(playing&&run){if(lastTick){accumulator+=(now-lastTick)*(+$('speed').value)*.11;const step=Math.floor(accumulator/run.options.dt);if(step>0){accumulator-=step*run.options.dt;frame=Math.min(frame+step,run.times.length-1);draw();}}
    if(frame>=run.times.length-1){playing=false;updatePlay();}}
  lastTick=now;requestAnimationFrame(animate);
}
function nearest(event){const r=$('network').getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top;let best=-1,d=144;positions.forEach((p,i)=>{if(!p)return;const v=(p.x-x)**2+(p.y-y)**2;if(v<d){d=v;best=i;}});return best;}
$('network').addEventListener('pointermove',event=>{
  if(!run)return;const i=nearest(event);$('network').style.cursor=i>=0?'pointer':'default';
  if(i<0){$('graph-tooltip').hidden=true;return;}const p=positions[i],tip=$('graph-tooltip');tip.textContent=`${label(graph.nodes[i])} · ${activityText(run.activity[frame][i])}`;tip.hidden=false;tip.style.left=Math.max(8,Math.min(p.x+12,$('network').clientWidth-235))+'px';tip.style.top=Math.max(8,p.y-38)+'px';
});
$('network').addEventListener('pointerleave',()=>$('graph-tooltip').hidden=true);
$('network').addEventListener('click',event=>{const i=nearest(event);if(i>=0)selectNode(i);});
$('play').onclick=()=>{if(!run)return;if(playing)playing=false;else{if(startNew||frame===run.times.length-1)frame=0;startNew=false;playing=true;lastTick=0;accumulator=0;}updatePlay();draw();};
$('rewind').onclick=()=>{playing=false;frame=0;startNew=true;updatePlay();draw();};
$('time').oninput=()=>{playing=false;frame=+$('time').value;startNew=false;updatePlay();draw();};
$('node-search').oninput=()=>{populateSelect();renderInspector();draw();};
$('node-select').onchange=()=>{if($('node-select').value==='')return;selected=+$('node-select').value;renderInspector();draw();};
for(const id of ['preset','side','mode','glutamate'])$(id).onchange=()=>compute(true);
for(const id of ['amplitude','gain'])$(id).oninput=()=>{$(id+'-out').textContent=(+$(id).value).toFixed(1);clearTimeout(debounce);debounce=setTimeout(()=>compute(false),90);};
$('silence').onclick=()=>{disabled.has(selected)?disabled.delete(selected):disabled.add(selected);compute(true);};
$('silence-gf').onclick=()=>{for(const u of graph.nodes)if(u.type==='DNp01')disabled.add(u.id);compute(true);};
$('clear-lesions').onclick=()=>{disabled.clear();compute(true);};
$('reset').onclick=()=>{if(!graph)return;for(const id of ['preset','side','amplitude','gain','mode','glutamate'])$(id).value=DEFAULTS[id];disabled.clear();$('node-search').value='';selected=graph.nodes.find(u=>u.type==='DNp01'&&u.side==='R')?.id||0;compute(false);};
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export-csv').onclick=()=>{
  if(!run)return;const rows=summaryRows(graph,run).map((row,i)=>({...row,intact_peak:baseline.peaks[i],peak_change:run.peaks[i]-baseline.peaks[i]}));const keys=Object.keys(rows[0]);const quote=v=>'"'+String(v).replaceAll('"','""')+'"';
  download('fly-cns-results.csv',[keys.join(','),...rows.map(r=>keys.map(k=>quote(r[k])).join(','))].join('\n'),'text/csv;charset=utf-8');
};
$('export-json').onclick=()=>{
  if(!run)return;const out={created:new Date().toISOString(),model:'leaky-rate-v1',provenance:graph.metadata,options:run.options,nodes:graph.nodes,times:run.times,activity:run.activity.map(a=>Array.from(a)),summary:summaryRows(graph,run),intact_peaks:Array.from(baseline.peaks)};
  download('fly-cns-experiment.json',JSON.stringify(out),'application/json');
};
function renderMethod(){
  const m=graph.metadata;$('dataset-meta').innerHTML=`${fmt(m.nodes)} populations · ${fmt(m.represented_neurons)} neurons<br>${fmt(m.edges)} links · ${fmt(m.represented_synapses)} observed synapses`;
  $('data-summary').innerHTML=`<div class="data-totals"><div><strong>${fmt(m.nodes)}</strong><span>population units</span></div><div><strong>${fmt(m.represented_neurons)}</strong><span>represented neurons</span></div><div><strong>${fmt(m.edges)}</strong><span>directed links</span></div></div><p>These links represent ${fmt(m.represented_synapses)} synapses. The full typed graph prepared from the source has ${fmt(m.full_typed_neurons)} neurons in ${fmt(m.full_units)} units and ${fmt(m.full_type_edges)} directed population links.</p>`;
  $('source-files').innerHTML=Object.entries(m.sources).map(([key,s])=>`<div class="file-source"><a href="${escapeHTML(s.url)}" target="_blank" rel="noreferrer">${escapeHTML(key)} · ${(s.bytes/1e6).toFixed(1)} MB ↗</a><code>SHA-256 ${escapeHTML(s.sha256)}</code></div>`).join('');
}
async function init(){
  try{
    const response=await fetch('./graph.json');if(!response.ok)throw new Error('Could not load the connectivity graph. Please reload.');graph=await response.json();
    selected=graph.nodes.find(u=>u.type==='DNp01'&&u.side==='R')?.id||0;renderMethod();populateSelect();
    try{worker=new Worker(new URL('./sim.worker.mjs',import.meta.url),{type:'module'});worker.onmessage=e=>receive(e.data);worker.onerror=()=>{worker.terminate();worker=null;compute(false);};worker.postMessage({graph});}catch{worker=null;}
    new ResizeObserver(()=>{if(run){layout();draw();}}).observe($('network-container'));
    window.addEventListener('resize',()=>{if(run){layout();draw();}});compute();requestAnimationFrame(animate);
  }catch(error){$('loading-note').textContent=error.message;$('dataset-meta').textContent='Graph unavailable';status('Load failed');$('play').textContent='Reload to try again';}
}
init();
