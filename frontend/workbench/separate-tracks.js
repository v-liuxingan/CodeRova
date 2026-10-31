// Final pass uses actual card boundaries, not layer centers. Different card
// heights and different layer bands can otherwise put separate lanes on top
// of the same world-coordinate segment.
export function separateTracks(data, direction = 'TB') {
  const horizontal=direction==='LR',axis=horizontal?'x':'y',cross=horizontal?'y':'x';
  const nodes=new Map(data.nodes.map(n=>[n.id,n])), tracks=new Map(), step=10;
  const callers=new Map();
  for(const edge of data.edges) {
    const a=nodes.get(edge.source),b=nodes.get(edge.target);
    if(!a || !b || edge.source===edge.target) continue;
    const start=a.style[axis]+(horizontal?152:a.data.height/2),end=b.style[axis]-(horizontal?152:b.data.height/2);
    if(end-start<24) continue;
    const extent=horizontal?Math.max(a.data.height,b.data.height)/2:152;
    const key=JSON.stringify([edge.source,b.style[axis]]);
    const item={edge,start,end,left:Math.min(a.style[cross],b.style[cross])-extent,right:Math.max(a.style[cross],b.style[cross])+extent};
    if(!callers.has(key)) callers.set(key,{...item,items:[]});
    const group=callers.get(key);group.start=Math.max(group.start,start);group.end=Math.min(group.end,end);
    group.left=Math.min(group.left,item.left);group.right=Math.max(group.right,item.right);group.items.push(item);
  }
  // Constrained short spans first; wider spans have more room to avoid them.
  const spans=[...callers.values()];
  spans.sort((a,b)=>(a.end-a.start)-(b.end-b.start)||a.edge.id.localeCompare(b.edge.id));
  for(const span of spans) {
    const {edge,start,end,left,right}=span;
    const lo=Math.ceil((start+12)/step),hi=Math.floor((end-12)/step);
    const preferred=Math.max(lo,Math.min(hi,Math.round((start+(end-start)*(edge.style.routeFraction??.5))/step)));
    let slot;
    for(let distance=0;distance<=Math.max(preferred-lo,hi-preferred);distance++) {
      for(const candidate of distance?[preferred-distance,preferred+distance]:[preferred]) {
        if(candidate<lo||candidate>hi) continue;
        if(!(tracks.get(candidate)||[]).some(other=>other.left<=right&&other.right>=left)) {slot=candidate;break;}
      }
      if(slot!==undefined) break;
    }
    if(slot===undefined) continue;
    if(!tracks.has(slot)) tracks.set(slot,[]);
    tracks.get(slot).push({left,right});
    for(const item of span.items) item.edge.style.routeFraction=(slot*step-item.start)/(item.end-item.start);
  }
}
