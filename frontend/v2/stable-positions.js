import { branchSpaceConflict } from './branch-space.js';
// Keep existing coordinates while a branch fits. If its continuous layout
// collides, allow the layered layout to widen branches instead of scattering
// new siblings into unrelated gaps. Only visible nodes contribute to width.
export function stablePositions(graph, baseline, previous, direction = 'TB', anchor = graph.root) {
  const along = direction === 'LR' ? 'x' : 'y', cross = direction === 'LR' ? 'y' : 'x';
  const step = direction === 'LR' ? 400 : 200, spacing = direction === 'LR' ? 180 : 350;
  const reflow = () => {
    const oldAnchor = previous.get(anchor), newAnchor = baseline.get(anchor);
    const dx = oldAnchor && newAnchor ? oldAnchor.x - newAnchor.x : 0;
    const dy = oldAnchor && newAnchor ? oldAnchor.y - newAnchor.y : 0;
    return new Map([...baseline].map(([id, value]) => [id, { x: value.x + dx, y: value.y + dy }]));
  };
  // Removed descendants must release their branch spacing. Preserve the operated
  // node as the anchor, not the expanded layout's empty slots.
  const visible = new Set(graph.nodes.map(n => n.id));
  if ([...previous.keys()].some(id => !visible.has(id))) return reflow();
  const positions = new Map(), rows = new Map(), parents = new Map();
  for (const edge of graph.edges) {
    if (edge.flowKind === 'loop-back') continue;
    if (!parents.has(edge.to)) parents.set(edge.to, []);
    parents.get(edge.to).push(edge.from);
  }
  const occupy = point => {
    const key = Math.floor(point[along] / step);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(point);
  };
  for (const n of graph.nodes) {
    const old = previous.get(n.id);
    if (old) { const point = { x: old.x, y: old.y }; positions.set(n.id, point); occupy(point); }
  }
  const added = graph.nodes.filter(n => !positions.has(n.id)).sort((a,b) => baseline.get(a.id)[along] - baseline.get(b.id)[along]);
  for (const n of added) {
    const base = baseline.get(n.id);
    const parent = (parents.get(n.id) || []).find(id => positions.has(id));
    const p = parent && positions.get(parent), bp = parent && baseline.get(parent);
    const point = p ? { x: p.x + base.x - bp.x, y: p.y + base.y - bp.y } : { ...base };
    const key = Math.floor(point[along] / step);
    for (let k = key - 1; k <= key + 1; k++) {
      if ((rows.get(k) || []).some(other => Math.abs(other[along] - point[along]) < step - 1 && Math.abs(other[cross] - point[cross]) < spacing - 1)) {
        // A single coherent reflow prevents overlapping branches and keeps the
        // operated node fixed. Other nodes are allowed to move only on conflict.
        return reflow();
      }
    }
    positions.set(n.id, point); occupy(point);
  }
  if (added.length && branchSpaceConflict(graph, positions, direction)) return reflow();
  return positions;
}
