// Check whole expanded branches, not only individual rectangles. Two subtrees
// can interleave without any pair of nodes physically touching.
export function branchSpaceConflict(graph, positions, direction = 'TB') {
  if (!graph.nodes.every(n => n.sourceId)) return false;
  const cross = direction === 'LR' ? 'y' : 'x', spacing = direction === 'LR' ? 180 : 350;
  const children = new Map(graph.nodes.map(n=>[n.id,new Set()])), parents = new Map();
  for (const edge of graph.edges) {
    if (parents.has(edge.to) && parents.get(edge.to)!==edge.from) return false;
    parents.set(edge.to,edge.from); children.get(edge.from)?.add(edge.to);
  }
  const order=graph.nodes.filter(n=>!parents.has(n.id)).map(n=>n.id);
  for(let i=0;i<order.length;i++) for(const child of children.get(order[i])) order.push(child);
  if(order.length!==graph.nodes.length) return false;
  const ranges=new Map();
  for(const id of order.reverse()) {
    const point=positions.get(id)[cross];let min=point,max=point;
    const expanded=[];
    for(const child of children.get(id)) {
      const range=ranges.get(child);min=Math.min(min,range.min);max=Math.max(max,range.max);
      if(children.get(child).size) expanded.push({id:child,...range});
    }
    expanded.sort((a,b)=>positions.get(a.id)[cross]-positions.get(b.id)[cross]);
    for(let i=1;i<expanded.length;i++) if(expanded[i-1].max+spacing-1>expanded[i].min) return true;
    ranges.set(id,{min,max});
  }
  return false;
}
