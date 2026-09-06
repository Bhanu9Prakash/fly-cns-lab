/** Validated links from reading pages into the lab. Never starts playback. */
export function readLabLocation(href){
  const url=new URL(href,'https://example.invalid'),p=url.searchParams;
  const candidate=url.hash.slice(1)||p.get('view'),view=['world','experiment','method'].includes(candidate)?candidate:'world';
  const world={};
  if(['intact','giant','power','steering','motors'].includes(p.get('intervention')))world.intervention=p.get('intervention');
  if(['front','left','right','static'].includes(p.get('scenario')))world.scenario=p.get('scenario');
  if(['on','off'].includes(p.get('vision')))world.vision=p.get('vision')==='on';
  if(['on','off'].includes(p.get('motor')))world.motorConnected=p.get('motor')==='on';
  return {view,world};
}
