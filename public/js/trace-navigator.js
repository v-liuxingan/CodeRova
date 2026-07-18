import { resolveEdgeCallSite } from "./call-site.js";

export class TraceNavigator {
  constructor(graph) {
    this.graph = graph;
    this.nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    this.edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
    this.outgoing = groupEdges(graph.edges, "from");
    this.incoming = groupEdges(graph.edges, "to");
    this.cursorId = graph.root;
    this.preferredOutgoingId = null;
    this.positionType = "node";
    this.activeEdgeId = null;
    this.history = [];
  }

  syncSelection(target) {
    if (!target) return;
    if (target.type === "node" && this.nodeById.has(target.id)) {
      this.cursorId = target.id;
      this.preferredOutgoingId = null;
      this.positionType = "node";
      this.activeEdgeId = null;
      this.history = [];
      return;
    }
    if (target.type === "edge") {
      const edge = this.edgeById.get(target.id);
      if (!edge) return;
      this.cursorId = edge.from;
      this.preferredOutgoingId = edge.id;
      this.positionType = "edge";
      this.activeEdgeId = edge.id;
      this.history = [];
    }
  }

  snapshot() {
    const currentNode = this.nodeById.get(this.cursorId);
    const activeEdge = this.positionType === "edge"
      ? this.edgeById.get(this.activeEdgeId)
      : null;
    const outgoingEdge = activeEdge || this.pickOutgoing(this.cursorId);
    const branches = (this.outgoing.get(this.cursorId) || []).map((edge) => ({
      edge,
      node: this.nodeById.get(edge.to),
      callSite: resolveEdgeCallSite(edge),
      selected: edge.id === outgoingEdge?.id,
    }));
    const previousStep = activeEdge ? { edge: activeEdge } : this.pickPrevious();
    const callSite = outgoingEdge ? resolveEdgeCallSite(outgoingEdge) : null;
    return {
      currentNode,
      previousNode: previousStep
        ? this.nodeById.get(previousStep.edge.from)
        : null,
      callEdge: outgoingEdge,
      callSite,
      nextNode: outgoingEdge
        ? this.nodeById.get(outgoingEdge.to)
        : null,
      branches,
    };
  }

  selectBranch(edgeId) {
    const edge = this.edgeById.get(edgeId);
    if (!edge || edge.from !== this.cursorId) return null;
    this.preferredOutgoingId = edge.id;
    this.positionType = "node";
    this.activeEdgeId = null;
    return { type: "node", id: this.cursorId };
  }

  previous() {
    if (this.positionType === "edge") {
      const edge = this.edgeById.get(this.activeEdgeId);
      if (!edge) return null;
      if (this.history.at(-1)?.edgeId === edge.id) this.history.pop();
      this.cursorId = edge.from;
      this.preferredOutgoingId = edge.id;
      this.positionType = "node";
      this.activeEdgeId = null;
      return { type: "node", id: edge.from };
    }
    const step = this.pickPrevious();
    if (!step) return null;
    if (step.fromHistory) this.history.pop();
    this.cursorId = step.edge.from;
    this.preferredOutgoingId = step.edge.id;
    this.positionType = "node";
    this.activeEdgeId = null;
    return { type: "node", id: step.edge.from };
  }

  callSite() {
    const { callEdge, callSite } = this.snapshot();
    if (!callEdge || !callSite?.available) return null;
    this.cursorId = callEdge.from;
    this.preferredOutgoingId = callEdge.id;
    this.positionType = "edge";
    this.activeEdgeId = callEdge.id;
    return { type: "edge", id: callEdge.id };
  }

  next() {
    const edge = this.positionType === "edge"
      ? this.edgeById.get(this.activeEdgeId)
      : this.pickOutgoing(this.cursorId);
    if (!edge) return null;
    const historical = this.history.at(-1);
    if (historical?.nodeId !== edge.from || historical.edgeId !== edge.id) {
      this.history.push({ nodeId: edge.from, edgeId: edge.id });
    }
    this.cursorId = edge.to;
    this.preferredOutgoingId = null;
    this.positionType = "node";
    this.activeEdgeId = null;
    return { type: "node", id: edge.to };
  }

  stepForward() {
    if (this.positionType === "edge") return this.next();
    const edge = this.pickOutgoing(this.cursorId);
    if (!edge) return null;
    const callSite = resolveEdgeCallSite(edge);
    if (!callSite.available) return this.next();
    this.preferredOutgoingId = edge.id;
    this.positionType = "edge";
    this.activeEdgeId = edge.id;
    return { type: "edge", id: edge.id };
  }

  stepBackward() {
    if (this.positionType === "edge") return this.previous();
    const step = this.pickPrevious();
    if (!step) return null;
    const callSite = resolveEdgeCallSite(step.edge);
    if (!callSite.available) return this.previous();
    this.cursorId = step.edge.from;
    this.preferredOutgoingId = step.edge.id;
    this.positionType = "edge";
    this.activeEdgeId = step.edge.id;
    return { type: "edge", id: step.edge.id };
  }

  pickPrevious() {
    const historical = this.history.at(-1);
    if (historical) {
      const edge = this.edgeById.get(historical.edgeId);
      if (edge && edge.to === this.cursorId) return { edge, fromHistory: true };
    }
    const edge = pickHighestScore(
      this.incoming.get(this.cursorId) || [],
      (candidate) => reachableCount(candidate.from, this.incoming, "from"),
    );
    return edge ? { edge, fromHistory: false } : null;
  }

  pickOutgoing(nodeId) {
    const preferred = this.edgeById.get(this.preferredOutgoingId);
    if (preferred?.from === nodeId) return preferred;
    return pickHighestScore(
      this.outgoing.get(nodeId) || [],
      (edge) => reachableCount(edge.to, this.outgoing, "to"),
    );
  }
}

function groupEdges(edges, key) {
  const grouped = new Map();
  for (const edge of edges) {
    if (!grouped.has(edge[key])) grouped.set(edge[key], []);
    grouped.get(edge[key]).push(edge);
  }
  return grouped;
}

function pickHighestScore(edges, score) {
  let selected = null;
  let selectedScore = -1;
  for (const edge of edges) {
    const edgeScore = score(edge);
    if (edgeScore > selectedScore) {
      selected = edge;
      selectedScore = edgeScore;
    }
  }
  return selected;
}

function reachableCount(startId, adjacency, endpoint) {
  const visited = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of adjacency.get(current) || []) {
      const next = edge[endpoint];
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited.size;
}
