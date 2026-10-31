// Allocate separate lanes only where cross-axis spans overlap. Disjoint spans
// reuse a lane; this avoids treating every edge as a new global channel.
export function routeChannels(edges, positions, direction = 'TB', reserveSpace = false, anchor) {
  const axis = direction === 'LR' ? 'x' : 'y', cross = direction === 'LR' ? 'y' : 'x';
  const bands = new Map();
  for (const edge of edges) {
    const a = positions.get(edge.source), b = positions.get(edge.target);
    if (!a || !b || edge.source === edge.target) continue;
    const key = JSON.stringify([a[axis], b[axis]]);
    if (!bands.has(key)) bands.set(key, []);
    bands.get(key).push({ edge, left: Math.min(a[cross], b[cross]) - 152, right: Math.max(a[cross], b[cross]) + 152 });
  }
  const constraints = [];
  for (const band of bands.values()) {
    const callers=new Map();
    for(const item of band) {
      const id=item.edge.source;
      if(!callers.has(id)) callers.set(id,{id,left:item.left,right:item.right,items:[]});
      const group=callers.get(id);group.left=Math.min(group.left,item.left);group.right=Math.max(group.right,item.right);group.items.push(item);
    }
    const groups=[...callers.values()].sort((a,b)=>a.left-b.left||a.id.localeCompare(b.id)),ends=[];
    for(const group of groups) {
      let lane=ends.findIndex(end=>end<group.left);
      if(lane<0) lane=ends.length;
      ends[lane]=group.right;
      for(const item of group.items) item.lane=lane;
    }
    const a=positions.get(band[0].edge.source)[axis],b=positions.get(band[0].edge.target)[axis];
    if (b>a && ends.length>1) constraints.push({a,b,gap:(ends.length+1)*10/.7+(direction==='LR'?304:180)});
    for (const item of band) item.edge.style.routeFraction=.15+.7*(item.lane+1)/(ends.length+1);
  }
  if (reserveSpace && constraints.length) {
    const levels=[...new Set([...positions.values()].map(p=>p[axis]))].sort((a,b)=>a-b), shifted=new Map();
    const incoming=new Map();
    for(const constraint of constraints) { if(!incoming.has(constraint.b)) incoming.set(constraint.b,[]);incoming.get(constraint.b).push(constraint); }
    for(let i=0;i<levels.length;i++) {
      const level=levels[i];let next=i?shifted.get(levels[i-1])+level-levels[i-1]:level;
      for(const {a,gap} of incoming.get(level)||[]) next=Math.max(next,shifted.get(a)+gap);
      shifted.set(level,next);
    }
    const anchored=positions.get(anchor)?.[axis], correction=anchored===undefined?0:anchored-shifted.get(anchored);
    for(const point of positions.values()) point[axis]=shifted.get(point[axis])+correction;
  }
}
