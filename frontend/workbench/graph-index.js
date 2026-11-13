// Source data stays authoritative. Indexes accelerate traversal without adding
// synthetic relationships or interpreting layout depth as execution order.
import { isIncoming } from './exploration.js';

export function indexGraph(graph) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const edges = new Map(graph.edges.map(edge => [edge.id, edge]));
  const outgoing = new Map(), incoming = new Map();
  for (const id of nodes.keys()) { outgoing.set(id, []); incoming.set(id, []); }
  for (const edge of graph.edges) {
    outgoing.get(edge.from)?.push(edge);
    incoming.get(edge.to)?.push(edge);
  }
  const reverse = isIncoming(graph);
  const parents = reverse ? outgoing : incoming;
  const parentEnd = reverse ? 'to' : 'from';
  const childEnd = reverse ? 'from' : 'to';
  // A terminal cycle occurrence is a real selectable path endpoint, not a
  // reason to walk back into the original source cycle.
  const onPath = edge => edge.flowKind !== 'loop-back' || nodes.get(edge[childEnd])?.pathCycle === true;
  let reachable;
  function context(id) {
    const selectedNodes = new Set([id]), selectedEdges = new Set();
    // Cache root reachability per immutable index, excluding disconnected callers.
    if (!reachable) {
      reachable = new Set(nodes.has(graph.root) ? [graph.root] : []);
      const children = reverse ? incoming : outgoing;
      for (const node of reachable) for (const edge of children.get(node) || []) {
        if (onPath(edge)) reachable.add(edge[childEnd]);
      }
    }
    if (!reachable.has(id)) return { nodes: selectedNodes, edges: selectedEdges };
    const queue = [id];
    for (let i = 0; i < queue.length; i++) {
      if (queue[i] === graph.root) continue;
      for (const edge of parents.get(queue[i]) || []) {
        const parent = edge[parentEnd];
        if (!onPath(edge) || !reachable.has(parent)) continue;
        selectedEdges.add(edge.id);
        if (!selectedNodes.has(parent)) {
          selectedNodes.add(parent); queue.push(parent);
        }
      }
    }
    return { nodes: selectedNodes, edges: selectedEdges };
  }
  return { nodes, edges, outgoing, incoming, context };
}
