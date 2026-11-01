/** Canonical graph JSON -> renderer model. Keep wire names out of interaction code. */
function renameFields(value, fields) {
  const result = { ...value };
  for (const [wire, internal] of fields) {
    if (!Object.hasOwn(result, wire)) continue;
    if (Object.hasOwn(result, internal)) throw new Error(`图字段冲突：${wire} / ${internal}`);
    result[internal] = result[wire];
    delete result[wire];
  }
  return result;
}
export function normalizeGraphNode(node) {
  return renameFields(node, [['sourceFile', 'file']]);
}
export function normalizeGraph(graph) {
  return {
    ...graph,
    nodes: graph.nodes.map(normalizeGraphNode),
    edges: graph.edges.map(edge => renameFields(edge, [
      ['source', 'from'], ['target', 'to'], ['relation', 'kind'],
      ['sourceFile', 'file'], ['confidenceScore', 'confidence'],
    ])),
  };
}
/** Only graph-bearing response envelopes are adapted; source/navigation APIs are unchanged. */
export function normalizeGraphResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  if (Array.isArray(body.nodes) && Array.isArray(body.edges)) return normalizeGraph(body);
  const result = { ...body };
  if (body.graph) result.graph = normalizeGraphResponse(body.graph);
  if (body.node) result.node = normalizeGraphNode(body.node);
  if (body.result) result.result = normalizeGraphResponse(body.result);
  return result;
}
