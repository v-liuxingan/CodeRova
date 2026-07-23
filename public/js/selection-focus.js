export function computeSelectionFocus(
  selectedNodeId,
  nodes,
  edges,
  anchorNodeId = selectedNodeId,
) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (
    !selectedNodeId
    || !anchorNodeId
    || !nodeIds.has(selectedNodeId)
    || !nodeIds.has(anchorNodeId)
  ) {
    return emptyFocus();
  }

  const traversalEdges = edges.filter((edge) => edge.flowKind !== "loop-back");
  const anchorAncestors = walk(anchorNodeId, traversalEdges, "upstream");
  const selectedAncestors = walk(selectedNodeId, traversalEdges, "upstream");
  const anchorIsDownstream = anchorAncestors.nodeIds.has(selectedNodeId);
  const anchorIsUpstream = selectedAncestors.nodeIds.has(anchorNodeId);
  const preserveAnchor = anchorIsDownstream || anchorIsUpstream;
  const effectiveAnchor = preserveAnchor ? anchorNodeId : selectedNodeId;
  const upstream = anchorIsUpstream
    ? walk(anchorNodeId, traversalEdges, "upstream")
    : walk(selectedNodeId, traversalEdges, "upstream");
  const downstream = anchorIsDownstream
    ? walk(anchorNodeId, traversalEdges, "downstream")
    : walk(selectedNodeId, traversalEdges, "downstream");
  const corridor = anchorIsDownstream
    ? walkCorridor(selectedNodeId, anchorNodeId, traversalEdges)
    : anchorIsUpstream
      ? walkCorridor(anchorNodeId, selectedNodeId, traversalEdges)
      : emptyWalk();
  const focusNodeIds = new Set([
    ...upstream.nodeIds,
    ...corridor.nodeIds,
    ...downstream.nodeIds,
  ]);
  const focusEdgeIds = new Set([
    ...upstream.edgeIds,
    ...corridor.edgeIds,
    ...downstream.edgeIds,
  ]);
  for (const edge of edges) {
    if (
      edge.flowKind === "loop-back"
      && focusNodeIds.has(edge.from)
      && focusNodeIds.has(edge.to)
    ) {
      focusEdgeIds.add(edge.id);
    }
  }
  return {
    active: true,
    originNodeId: selectedNodeId,
    originEdgeId: null,
    anchorNodeId: effectiveAnchor,
    focusNodeIds,
    focusEdgeIds,
  };
}

export function computeEdgeSelectionFocus(selectedEdgeId, nodes, edges) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
  if (
    !selectedEdge
    || !nodeIds.has(selectedEdge.from)
    || !nodeIds.has(selectedEdge.to)
  ) {
    return emptyFocus();
  }

  const focusNodeIds = new Set([selectedEdge.from, selectedEdge.to]);
  const focusEdgeIds = new Set([selectedEdge.id]);
  if (selectedEdge.flowKind !== "loop-back") {
    const traversalEdges = edges.filter((edge) => edge.flowKind !== "loop-back");
    const upstream = walk(selectedEdge.from, traversalEdges, "upstream");
    const downstream = walk(selectedEdge.to, traversalEdges, "downstream");
    for (const nodeId of [...upstream.nodeIds, ...downstream.nodeIds]) {
      focusNodeIds.add(nodeId);
    }
    for (const edgeId of [...upstream.edgeIds, ...downstream.edgeIds]) {
      focusEdgeIds.add(edgeId);
    }
    for (const edge of edges) {
      if (
        edge.flowKind === "loop-back"
        && focusNodeIds.has(edge.from)
        && focusNodeIds.has(edge.to)
      ) {
        focusEdgeIds.add(edge.id);
      }
    }
  }
  return {
    active: true,
    originNodeId: null,
    originEdgeId: selectedEdge.id,
    anchorNodeId: null,
    focusNodeIds,
    focusEdgeIds,
  };
}

function walk(startId, edges, direction) {
  const adjacency = new Map();
  for (const edge of edges) {
    const key = direction === "downstream" ? edge.from : edge.to;
    const next = direction === "downstream" ? edge.to : edge.from;
    if (!adjacency.has(key)) adjacency.set(key, []);
    adjacency.get(key).push({ edge, next });
  }
  const nodeIds = new Set([startId]);
  const edgeIds = new Set();
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    for (const { edge, next } of adjacency.get(current) || []) {
      edgeIds.add(edge.id);
      if (nodeIds.has(next)) continue;
      nodeIds.add(next);
      queue.push(next);
    }
  }
  return { nodeIds, edgeIds };
}

function walkCorridor(startId, endId, edges) {
  const canReachEnd = walk(endId, edges, "upstream").nodeIds;
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge);
  }
  const nodeIds = new Set([startId]);
  const edgeIds = new Set();
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of adjacency.get(current) || []) {
      if (!canReachEnd.has(edge.to)) continue;
      edgeIds.add(edge.id);
      if (nodeIds.has(edge.to)) continue;
      nodeIds.add(edge.to);
      queue.push(edge.to);
    }
  }
  return { nodeIds, edgeIds };
}

function emptyWalk() {
  return {
    nodeIds: new Set(),
    edgeIds: new Set(),
  };
}

function emptyFocus() {
  return {
    active: false,
    originNodeId: null,
    originEdgeId: null,
    anchorNodeId: null,
    focusNodeIds: new Set(),
    focusEdgeIds: new Set(),
  };
}
