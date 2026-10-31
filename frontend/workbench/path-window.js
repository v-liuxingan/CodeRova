import { callReading } from './call-reading.js';
import { indexGraph } from './graph-index.js';

// View references carry original IDs. No duplicated symbols are persisted or
// sent to source APIs. Repeated subtrees require explicit expansion, avoiding
// exponential expansion of diamonds even when the depth limit is large.
export class PathWindow {
  constructor(graph) {
    this.graph = graph;
    this.source = indexGraph(graph);
    this.reset(0);
  }
  reset(amount = 50, unit = 'layers') {
    this.nodes = new Map(); this.edges = new Map(); this.parents = new Map();
    this.children = new Map(); this.first = new Map(); this.visible = new Set();
    this.serial = 0;
    if (!this.source.nodes.has(this.graph.root)) return;
    this.add(this.graph.root, null);
    this.expand(this.graph.root, unit === 'nodes' ? Math.max(0, amount - 1) : amount, unit);
  }
  add(sourceId, parent) {
    const repeated = this.first.has(sourceId);
    let id = sourceId;
    if (repeated) do { id = `view-ref-${++this.serial}`; }
    while (repeated && (this.source.nodes.has(id) || this.source.edges.has(id) || this.nodes.has(id)));
    let cycle = false;
    for (let ancestor = parent; ancestor != null; ancestor = this.parents.get(ancestor)) {
      if (this.nodes.get(ancestor).sourceId === sourceId) { cycle = true; break; }
    }
    this.nodes.set(id, { ...this.source.nodes.get(sourceId), id, sourceId, pathReference: repeated, pathCycle: cycle });
    this.parents.set(id, parent); this.children.set(id, new Map()); this.visible.add(id);
    if (!repeated) this.first.set(sourceId, id);
    return id;
  }
  targets(id) {
    const n = this.nodes.get(id), groups = new Map();
    if (!n || n.pathCycle) return groups;
    const { calls } = callReading(this.source.outgoing.get(n.sourceId) || []);
    // A view occurrence represents a call record, not a unique callee. Source
    // order is only a reading order; it does not infer runtime control flow.
    for (const edge of calls) groups.set(edge.id, [edge]);
    return groups;
  }
  connect(parent, callId, edges) {
    let id = this.children.get(parent).get(callId);
    if (!id) {
      id = this.add(edges[0].to, parent);
      this.children.get(parent).set(callId, id);
      if (edges.every(edge => edge.flowKind === 'loop-back')) this.nodes.get(id).pathCycle = true;
      for (const edge of edges) {
        const key = JSON.stringify(['view-edge', parent, edge.id]);
        this.edges.set(key, { ...edge, id: key, sourceId: edge.id, from: parent, to: id });
      }
    }
    return id;
  }
  expand(id, amount = 50, unit = 'layers') {
    if (!this.nodes.has(id)) return 0;
    let added = 0;
    const queue = [[id, 0]];
    for (let i = 0; i < queue.length; i++) {
      const [parent, depth] = queue[i];
      if (unit === 'layers' && depth >= amount) continue;
      for (const [target, edges] of this.targets(parent)) {
        const exists = this.children.get(parent).has(target);
        if (!exists && unit === 'nodes' && added >= amount) return added;
        const child = this.connect(parent, target, edges), n = this.nodes.get(child);
        if (!exists) added++;
        if (!n.pathCycle && (!n.pathReference || this.children.get(child).size)) queue.push([child, depth + 1]);
      }
    }
    return added;
  }
  revealCall(parent, callId) {
    const node = this.nodes.get(parent), edge = this.source.edges.get(callId);
    if (!node || node.pathCycle || !edge || edge.from !== node.sourceId) return null;
    this.connect(parent, callId, [edge]);
    return JSON.stringify(['view-edge', parent, callId]);
  }
  collapsible(id) { return (this.children.get(id)?.size || 0) > 0; }
  collapse(id) {
    const removed = new Set(), queue = [...(this.children.get(id)?.values() || [])];
    for (let i = 0; i < queue.length; i++) {
      const child = queue[i];
      if (removed.has(child)) continue;
      removed.add(child); queue.push(...this.children.get(child).values());
    }
    for (const child of removed) {
      this.nodes.delete(child); this.visible.delete(child); this.parents.delete(child); this.children.delete(child);
    }
    this.children.get(id)?.clear();
    for (const [key, edge] of this.edges) if (removed.has(edge.from) || removed.has(edge.to)) this.edges.delete(key);
    this.first.clear();
    for (const node of this.nodes.values()) if (!this.first.has(node.sourceId)) this.first.set(node.sourceId, node.id);
    return removed.size;
  }
  hiddenChildren(id) {
    return [...this.targets(id).keys()].filter(target => !this.children.get(id).has(target)).length;
  }
  reveal(sourceId) {
    if (this.nodes.has(sourceId)) return sourceId;
    if (this.first.has(sourceId)) return this.first.get(sourceId);
    if (!this.source.nodes.has(sourceId)) return null;
    const parent = new Map([[this.graph.root, null]]), queue = [this.graph.root];
    for (let i = 0; i < queue.length && !parent.has(sourceId); i++) {
      for (const edge of this.source.outgoing.get(queue[i]) || []) {
        if (!parent.has(edge.to)) { parent.set(edge.to, edge); queue.push(edge.to); }
      }
    }
    if (!parent.has(sourceId)) return this.add(sourceId, null);
    const path = [];
    for (let next = sourceId; parent.get(next); next = parent.get(next).from) path.push(parent.get(next));
    let occurrence = this.graph.root;
    for (const edge of path.reverse()) occurrence = this.connect(occurrence, edge.id, this.targets(occurrence).get(edge.id));
    return occurrence;
  }
  snapshot() {
    const outgoing = new Map();
    for (const edge of this.edges.values()) {
      if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
      outgoing.get(edge.from).push(edge);
    }
    const edges = [...outgoing.values()].flatMap(calls => callReading(calls).calls);
    return { ...this.graph, nodes: [...this.nodes.values()], edges };
  }
}
