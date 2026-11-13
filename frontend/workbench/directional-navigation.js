// Screen-space navigation uses displayed path IDs, never symbol/search order.
// A 90-degree cone prevents an almost-vertical node becoming a "right" target.
export function directionalNeighbor(nodes, currentId, key) {
  const axis = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[key];
  const origin = nodes.find(n=>n.id===currentId);
  if (!axis || !origin) return null;
  let best=null, score=Infinity;
  for (const n of nodes) {
    if(n.id===currentId)continue;
    const dx=n.x-origin.x,dy=n.y-origin.y;
    const forward=dx*axis[0]+dy*axis[1],cross=Math.abs(dx*axis[1]-dy*axis[0]);
    if(!Number.isFinite(forward+cross) || forward<=1e-6 || cross>forward+1e-6)continue;
    const next=Math.hypot(dx,dy)+cross*2;
    if(next<score || (next===score && n.id<best.id)) {best=n;score=next;}
  }
  return best?.id || null;
}

// Keep spatial node navigation, inserting the actual call relation between
// connected endpoints. Siblings remain directly reachable; unrelated edges
// never become accidental stepping stones. All IDs are displayed occurrences.
export function directionalTarget(points, index, currentId, key) {
  const current = index.edges.get(currentId);
  if (current) {
    const endpoints = points.filter(n => n.id === current.from || n.id === current.to);
    if (!endpoints.length) return null;
    if (current.from === current.to) return {type:'node', id:current.from};
    if (endpoints.length !== 2) return null;
    const [a,b] = endpoints;
    const origin = {id:currentId,x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const id = directionalNeighbor([origin,...endpoints],currentId,key);
    return id ? {type:'node',id} : null;
  }
  const next = directionalNeighbor(points,currentId,key);
  if (!next) return null;
  const relations = [...(index.outgoing.get(currentId)||[]),...(index.incoming.get(currentId)||[])]
    .filter(e => e.from === next || e.to === next).sort((a,b)=>a.id.localeCompare(b.id));
  return relations.length ? {type:'edge',id:relations[0].id} : {type:'node',id:next};
}
