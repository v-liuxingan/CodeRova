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
