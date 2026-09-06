import {simulate} from './sim.mjs';
let graph,cacheKey,cachedBaseline;
onmessage=e=>{
  const {id,options}=e.data;
  if(e.data.graph)graph=e.data.graph;
  if(!options)return;
  try{
    const baselineOptions={...options,silenced:[]},key=JSON.stringify(baselineOptions);
    if(cacheKey!==key){cachedBaseline=simulate(graph,baselineOptions);cacheKey=key;}
    const run=options.silenced?.length?simulate(graph,options):cachedBaseline;
    postMessage({id,run,baseline:cachedBaseline});
  }catch(error){postMessage({id,error:error.message});}
};
