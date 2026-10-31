// Source data stays authoritative. Indexes accelerate traversal without adding
// synthetic relationships or interpreting layout depth as execution order.
export function indexGraph(graph) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const edges = new Map(graph.edges.map(edge => [edge.id, edge]));
  const outgoing = new Map(), incoming = new Map();
  for (const id of nodes.keys()) { outgoing.set(id, []); incoming.set(id, []); }
  for (const edge of graph.edges) {
    outgoing.get(edge.from)?.push(edge);
    incoming.get(edge.to)?.push(edge);
  }
  function context(id) {
    const selectedNodes = new Set([id]), selectedEdges = new Set();
    for (const [adjacency, endpoint] of [[outgoing, 'to'], [incoming, 'from']]) {
      const seen = new Set([id]), queue = [id];
      for (let i = 0; i < queue.length; i++) {
        for (const edge of adjacency.get(queue[i]) || []) {
          selectedEdges.add(edge.id);
          selectedNodes.add(edge[endpoint]);
          if (edge.flowKind !== 'loop-back' && !seen.has(edge[endpoint])) {
            seen.add(edge[endpoint]); queue.push(edge[endpoint]);
          }
        }
      }
    }
    return { nodes: selectedNodes, edges: selectedEdges };
  }
  return { nodes, edges, outgoing, incoming, context };
}
