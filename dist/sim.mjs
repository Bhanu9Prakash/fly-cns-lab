/** Deterministic leaky population-rate model. No fitted biological units. */
export const DEFAULTS = Object.freeze({preset:'loom',side:'both',amplitude:1,gain:3,
  duration:600,onset:60,pulse:180,dt:2,tau:20,mode:'signed',glutamate:'inhibitory',silenced:[]});
export const PRESETS = Object.freeze({
  loom:{name:'Looming object',types:['LC4','LPLC2'],detail:'An expanding object drives LC4 and LPLC2 visual feature channels.'},
  motion_a:{name:'Motion channel A',types:['T4a','T5a'],detail:'A pulse drives the T4a and T5a motion-sensitive populations.'},
  motion_b:{name:'Motion channel B',types:['T4b','T5b'],detail:'The same pulse drives the opposing T4b and T5b populations.'},
  none:{name:'No stimulus',types:[],detail:'Zero external drive. The model starts at rest.'}
});

export function signFor(nt, options=DEFAULTS) {
  if(options.mode==='unsigned') return 1;
  if(nt==='acetylcholine') return 1;
  if(nt==='gaba'||nt==='histamine') return -1;
  if(nt==='glutamate') return options.glutamate==='excitatory'?1:options.glutamate==='omit'?0:-1;
  return 0;
}

export function inputAt(t, node, options) {
  const o={...DEFAULTS,...options};
  if(t<o.onset || t>=o.onset+o.pulse || o.preset==='none') return 0;
  if(o.side!=='both' && node.side!==o.side) return 0;
  if(!PRESETS[o.preset].types.includes(node.type)) return 0;
  const phase=Math.min(1,Math.max(0,(t-o.onset)/o.pulse));
  // These are explicit feature-drive proxies, not a fitted retinal model.
  const envelope=o.preset==='loom'?(node.type==='LPLC2'?phase*phase:0.35+0.65*phase):1;
  return o.amplitude*envelope;
}

export function validateGraph(graph) {
  if(!graph?.nodes?.length || !Array.isArray(graph.edges)) throw new Error('Graph has no nodes or edges');
  const n=graph.nodes.length;
  graph.nodes.forEach((u,i)=>{
    if(u.id!==i || !Number.isFinite(u.total_input)||u.total_input<0) throw new Error('Invalid node or total input');
  });
  for(const [s,t,w] of graph.edges) {
    if(!Number.isInteger(s)||!Number.isInteger(t)||s<0||s>=n||t<0||t>=n||!Number.isFinite(w)||w<=0) throw new Error('Invalid edge');
  }
}

/** Stateful version of the same equation, accepting external feature drive.
 * State buffers are reused: callers retaining a frame must copy it. */
export function createRateNetwork(graph, options={}) {
  validateGraph(graph);
  const o={...DEFAULTS,...options},n=graph.nodes.length;
  if(!Number.isFinite(o.dt)||o.dt<=0||!Number.isFinite(o.tau)||o.tau<=0||!Number.isFinite(o.gain)||o.gain<0)throw new Error('Invalid network timing or gain');
  if(!['signed','unsigned'].includes(o.mode)||!['inhibitory','excitatory','omit'].includes(o.glutamate))throw new Error('Invalid transmitter assumptions');
  const off=new Uint8Array(n);
  function setSilenced(ids){
    for(const i of ids)if(!Number.isInteger(i)||i<0||i>=n)throw new Error('Invalid silenced node');
    off.fill(0);for(const i of ids){off[i]=1;state[i]=0;}
  }
  const src=new Uint32Array(graph.edges.length),dst=new Uint32Array(src.length),weight=new Float64Array(src.length);
  graph.edges.forEach(([s,t,c],k)=>{src[k]=s;dst[k]=t;weight[k]=o.gain*signFor(graph.nodes[s].nt,o)*c/Math.max(1,graph.nodes[t].total_input);});
  const alpha=1-Math.exp(-o.dt/o.tau),drive=new Float64Array(n);
  let state=new Float64Array(n),next=new Float64Array(n);
  setSilenced(o.silenced);
  return {
    get state(){return state;},options:o,setSilenced,
    reset(){state.fill(0);next.fill(0);},
    step(input){
      if(input.length!==n)throw new Error('Input vector length does not match graph');
      drive.fill(0);
      for(let k=0;k<src.length;k++)drive[dst[k]]+=weight[k]*state[src[k]];
      for(let i=0;i<n;i++){
        if(!Number.isFinite(input[i]))throw new Error('Non-finite sensory input');
        next[i]=off[i]?0:state[i]+alpha*(Math.max(0,Math.tanh(drive[i]+input[i]))-state[i]);
      }
      [state,next]=[next,state];return state;
    }
  };
}

export function simulate(graph, options={}) {
  validateGraph(graph);
  const o={...DEFAULTS,...options};
  if(!PRESETS[o.preset]) throw new Error('Unknown stimulus');
  for(const k of ['amplitude','gain','onset']) if(!Number.isFinite(o[k])||o[k]<0) throw new Error(`Invalid ${k}`);
  for(const k of ['duration','pulse','dt','tau']) if(!Number.isFinite(o[k])||o[k]<=0) throw new Error(`Invalid ${k}`);
  if(o.duration/o.dt>10000) throw new Error('Too many time steps');
  if(!['L','R','both'].includes(o.side)) throw new Error('Invalid side');
  if(!['signed','unsigned'].includes(o.mode)) throw new Error('Invalid mode');
  if(!['inhibitory','excitatory','omit'].includes(o.glutamate)) throw new Error('Invalid glutamate assumption');
  const n=graph.nodes.length,steps=Math.floor(o.duration/o.dt),alpha=1-Math.exp(-o.dt/o.tau);
  const disabled=new Set(o.silenced);
  for(const i of disabled) if(!Number.isInteger(i)||i<0||i>=n) throw new Error('Invalid silenced node');
  const edges=graph.edges.map(([s,t,w])=>[s,t,signFor(graph.nodes[s].nt,o)*w/Math.max(1,graph.nodes[t].total_input)]);
  let state=new Float64Array(n);
  const activity=[state.slice()],times=[0],peaks=new Float64Array(n),peakTimes=new Float64Array(n),areas=new Float64Array(n);
  const inputIds=graph.nodes.filter(u=>PRESETS[o.preset].types.includes(u.type)&&(o.side==='both'||o.side===u.side)).map(u=>u.id);
  const groups=['visual','central','descending','cord','motor'];
  for(let k=0;k<steps;k++) {
    const drive=new Float64Array(n);
    for(const [s,t,w] of edges) drive[t]+=o.gain*w*state[s];
    const next=new Float64Array(n),time=(k+1)*o.dt;
    for(let i=0;i<n;i++) {
      if(disabled.has(i)) continue;
      const target=Math.max(0,Math.tanh(drive[i]+inputAt(k*o.dt,graph.nodes[i],o)));
      next[i]=state[i]+alpha*(target-state[i]);
      if(next[i]>peaks[i]){peaks[i]=next[i];peakTimes[i]=time;}
      areas[i]+=(state[i]+next[i])*o.dt/2;
    }
    state=next;activity.push(state.slice());times.push(time);
  }
  const groupIds=Object.fromEntries(groups.map(g=>[g,graph.nodes.filter(u=>u.group===g).map(u=>u.id)]));
  const groupTraces=Object.fromEntries(groups.map(g=>[g,activity.map(row=>{
    const ids=groupIds[g];return ids.length?ids.reduce((s,i)=>s+row[i],0)/ids.length:0;
  })]));
  const motorIds=graph.nodes.filter(u=>u.group==='motor').map(u=>u.id).sort((a,b)=>peaks[b]-peaks[a]);
  return {options:o,times,activity,peaks,peakTimes,areas,inputIds,motorIds,groupTraces};
}

export function summaryRows(graph, run) {
  return graph.nodes.map((u,i)=>({id:i,type:u.type,side:u.side,segment:u.segment||'',group:u.group,
    neurotransmitter:u.nt,peak_activity:run.peaks[i],peak_model_time:run.peakTimes[i],
    integrated_activity:run.areas[i],silenced:run.options.silenced.includes(i)}));
}
