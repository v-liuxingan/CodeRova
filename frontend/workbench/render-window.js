const intersects = (a, b) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
export function viewportBounds(center, width, height, zoom, padding = 300) {
  const x = (width / 2 + padding) / zoom, y = (height / 2 + padding) / zoom;
  return { left: center[0] - x, right: center[0] + x, top: center[1] - y, bottom: center[1] + y };
}
export function containsBounds(outer, inner) {
  return outer && inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
}
// A camera move only changes membership. Retained elements keep their geometry,
// interaction states and source IDs instead of being updated with fresh copies.
export function mountDelta(previous, next) {
  const add={nodes:[],edges:[]}, remove={nodes:[],edges:[]};
  for(const kind of ['nodes','edges']) {
    const before=new Set(previous[kind].map(item=>item.id)), after=new Set(next[kind].map(item=>item.id));
    add[kind]=next[kind].filter(item=>!before.has(item.id));
    remove[kind]=previous[kind].filter(item=>!after.has(item.id)).map(item=>item.id);
  }
  return {add,remove};
}
export class RenderWindow {
  constructor(data) { this.setData(data); }
  setData(data) {
    this.data = data; this.nodes = new Map(data.nodes.map(n => [n.id, n]));
  }
  slice(bounds, retained = []) {
    const included = new Set(retained), edges = [];
    for (const n of this.data.nodes) {
      const { x, y } = n.style, height = n.data.height / 2;
      if (intersects(bounds, { left: x - 152, right: x + 152, top: y - height, bottom: y + height })) included.add(n.id);
    }
    // Retain crossing edges even if neither endpoint is on screen. Include
    // endpoint data so G6 resolves exact endpoints; never fabricate cut edges.
    for (const edge of this.data.edges) {
      const a = this.nodes.get(edge.source).style, b = this.nodes.get(edge.target).style;
      const extra = Math.max(Math.max(...[edge.style?.curveOffset || 0].flat().map(Math.abs)), edge.style?.loopDist || 0) + 160;
      if (intersects(bounds, { left: Math.min(a.x, b.x) - extra, right: Math.max(a.x, b.x) + extra,
        top: Math.min(a.y, b.y) - extra, bottom: Math.max(a.y, b.y) + extra })) {
        edges.push(edge); included.add(edge.source); included.add(edge.target);
      }
    }
    return { nodes: this.data.nodes.filter(n => included.has(n.id)), edges };
  }
  move(id, position) {
    const node = this.nodes.get(id);
    this.revision = (this.revision || 0) + 1;
    if (node) node.style = { ...node.style, x: position[0], y: position[1] };
  }
}
