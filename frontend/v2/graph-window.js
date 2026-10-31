import { indexGraph } from './graph-index.js';

// A display window over the complete graph, not an analysis budget. Every
// visible-to-visible edge is retained, including shared targets and cycles.
export class GraphWindow {
  constructor(graph) {
    this.graph = graph;
    this.index = indexGraph(graph);
    this.visible = new Set();
  }

  reset(amount = 50, unit = 'nodes') {
    this.visible.clear();
    if (!this.index.nodes.has(this.graph.root)) return;
    this.visible.add(this.graph.root);
    this.expand(this.graph.root, unit === 'nodes' ? amount - 1 : amount, unit);
  }

  expand(id, amount = 50, unit = 'nodes') {
    if (!this.index.nodes.has(id)) return 0;
    const before = this.visible.size;
    this.visible.add(id);
    const seen = new Set([id]), queue = [[id, 0]];
    let added = 0;
    for (let i = 0; i < queue.length; i++) {
      const [from, depth] = queue[i];
      if (unit === 'layers' && depth >= amount) continue;
      for (const edge of this.index.outgoing.get(from) || []) {
        if (edge.flowKind === 'loop-back' || seen.has(edge.to)) continue;
        seen.add(edge.to);
        if (!this.visible.has(edge.to)) {
          if (unit === 'nodes' && added >= amount) return this.visible.size - before;
          this.visible.add(edge.to); added++;
        }
        queue.push([edge.to, depth + 1]);
      }
    }
    return this.visible.size - before;
  }

  collapseCandidates(id) {
    const candidates = new Set(), queue = [id];
    for (let i = 0; i < queue.length; i++) {
      for (const edge of this.index.outgoing.get(queue[i]) || []) {
        if (edge.flowKind === 'loop-back' || edge.to === id || edge.to === this.graph.root || !this.visible.has(edge.to) || candidates.has(edge.to)) continue;
        candidates.add(edge.to); queue.push(edge.to);
      }
    }
    // Other callers keep their shared descendants. Collapsing one caller must
    // not erase a separate branch or manufacture a missing call relation.
    const keep = new Set(), pending = [...this.visible].filter(n => n !== id && !candidates.has(n));
    for (let i = 0; i < pending.length; i++) {
      for (const edge of this.index.outgoing.get(pending[i]) || []) {
        if (edge.flowKind === 'loop-back' || !candidates.has(edge.to) || keep.has(edge.to)) continue;
        keep.add(edge.to); pending.push(edge.to);
      }
    }
    return [...candidates].filter(n => !keep.has(n));
  }
  collapsible(id) { return this.collapseCandidates(id).length > 0; }
  collapse(id) {
    const removed = this.collapseCandidates(id);
    for (const child of removed) this.visible.delete(child);
    return removed.length;
  }
  hiddenChildren(id) {
    return new Set((this.index.outgoing.get(id) || [])
      .filter(edge => edge.flowKind !== 'loop-back' && !this.visible.has(edge.to))
      .map(edge => edge.to)).size;
  }

  // Search must also reach nodes outside the current window. Reveal one real
  // shortest path from the root, or explicitly reveal a disconnected symbol.
  reveal(id) {
    if (!this.index.nodes.has(id) || this.visible.has(id)) return;
    const parent = new Map([[this.graph.root, null]]), queue = [this.graph.root];
    for (let i = 0; i < queue.length && !parent.has(id); i++) {
      for (const edge of this.index.outgoing.get(queue[i]) || []) {
        if (edge.flowKind === 'loop-back' || parent.has(edge.to)) continue;
        parent.set(edge.to, queue[i]); queue.push(edge.to);
      }
    }
    for (let next = id; next != null; next = parent.get(next)) this.visible.add(next);
  }

  snapshot() {
    return { ...this.graph,
      nodes: this.graph.nodes.filter(node => this.visible.has(node.id)),
      edges: this.graph.edges.filter(edge => this.visible.has(edge.from) && this.visible.has(edge.to)),
    };
  }
}

// Minimum call distance gives direct siblings a common row/column. A shared
// target keeps one identity at its earliest layer; cross/return edges do not
// force other branches to acquire artificial depth.
export function layerPositions(graph, direction = 'TB') {
  if (graph.nodes.length && graph.nodes.every(n => n.sourceId)) return pathPositions(graph, direction);
  const index = indexGraph(graph), depths = new Map(), layers = [];
  const seeds = [graph.root, ...graph.nodes.map(node => node.id)];
  for (const seed of seeds) {
    if (!index.nodes.has(seed) || depths.has(seed)) continue;
    const base = depths.size ? layers.length : 0;
    depths.set(seed, base);
    const queue = [seed];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i], depth = depths.get(id);
      (layers[depth] ||= []).push(id);
      for (const edge of index.outgoing.get(id)) {
        if (edge.flowKind === 'loop-back' || depths.has(edge.to)) continue;
        depths.set(edge.to, depth + 1); queue.push(edge.to);
      }
    }
  }
  const positions = new Map();
  layers.forEach((ids, depth) => ids.forEach((id, i) => {
    const cross = i - (ids.length - 1) / 2;
    positions.set(id, direction === 'LR'
      ? { x: depth * 400, y: cross * 180 }
      : { x: cross * 350, y: depth * 200 });
  }));
  return positions;
}

function pathPositions(graph, direction) {
  const children = new Map(graph.nodes.map(n => [n.id, new Set()])), incoming = new Set();
  for (const e of graph.edges) { children.get(e.from).add(e.to); incoming.add(e.to); }
  const roots = graph.nodes.filter(n => !incoming.has(n.id)).map(n => n.id);
  const order = [...roots], widths = new Map();
  for (let i = 0; i < order.length; i++) for (const child of children.get(order[i])) order.push(child);
  for (const id of [...order].reverse()) widths.set(id, Math.max(1, [...children.get(id)].reduce((sum, c) => sum + widths.get(c), 0)));
  const positions = new Map(), queue = [];
  let offset = 0;
  for (const id of roots) { queue.push([id, offset, 0]); offset += widths.get(id) + 1; }
  const origin = (widths.get(graph.root) || 1) / 2;
  for (let i = 0; i < queue.length; i++) {
    const [id, start, depth] = queue[i], cross = start + widths.get(id) / 2 - origin;
    positions.set(id, direction === 'LR' ? { x: depth * 400, y: cross * 180 } : { x: cross * 350, y: depth * 200 });
    let next = start;
    for (const child of children.get(id)) { queue.push([child, next, depth + 1]); next += widths.get(child); }
  }
  return positions;
}
