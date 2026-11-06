// Exploration is a view policy. Persisted edges always retain caller -> callee.
export const isIncoming = graph => graph?.analysis?.direction === 'incoming';
export const explorationLabel = graph => isIncoming(graph) ? '上游调用者' : '下游调用';
export function explorationGraph(graph) {
  return isIncoming(graph) ? {...graph, edges:graph.edges.map(edge=>({...edge,from:edge.to,to:edge.from}))} : graph;
}
