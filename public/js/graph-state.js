const downstreamKinds = new Set([
  "direct",
  "callback",
  "trait-dispatch",
  "spawn",
  "remote",
  "async-boundary",
  "data-flow",
]);

export class GraphState {
  constructor(graph, layout = {}) {
    this.graph = graph;
    this.selected = null;
    this.hidden = new Set(
      graph.nodes.filter((node) => node.state === "hidden").map((node) => node.id),
    );
    this.collapsed = new Set(
      graph.nodes.filter((node) => node.state === "collapsed").map((node) => node.id),
    );
    this.enabledKinds = new Set(graph.edges.map((edge) => edge.kind));
    this.focusMode = "all";
    this.query = "";
    this.orientation = "vertical";
    this.nodePositions = {
      vertical: { ...(layout.positions?.vertical || {}) },
      horizontal: { ...(layout.positions?.horizontal || {}) },
    };
    this.listeners = new Set();
    this.nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    this.edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(reason = "change") {
    for (const listener of this.listeners) listener(this, reason);
  }

  select(target) {
    this.selected = target;
    this.notify("selection");
  }

  setQuery(query) {
    this.query = query.trim().toLocaleLowerCase();
    this.notify("query");
  }

  setFocus(mode) {
    this.focusMode = mode;
    this.notify("focus");
  }

  toggleKind(kind) {
    if (this.enabledKinds.has(kind)) this.enabledKinds.delete(kind);
    else this.enabledKinds.add(kind);
    this.notify("filter");
  }

  toggleCollapse(nodeId) {
    if (this.collapsed.has(nodeId)) this.collapsed.delete(nodeId);
    else this.collapsed.add(nodeId);
    this.notify("structure");
  }

  hideNode(nodeId) {
    this.hidden.add(nodeId);
    if (this.selected?.type === "node" && this.selected.id === nodeId) this.selected = null;
    this.notify("structure");
  }

  resetVisibility() {
    this.hidden.clear();
    this.collapsed.clear();
    this.focusMode = "all";
    this.notify("structure");
  }

  toggleOrientation() {
    this.orientation = this.orientation === "vertical" ? "horizontal" : "vertical";
    this.notify("structure");
  }

  getNodePositions() {
    return this.nodePositions[this.orientation];
  }

  setNodePosition(nodeId, position) {
    if (!this.nodeById.has(nodeId)) return;
    this.nodePositions[this.orientation][nodeId] = {
      x: roundCoordinate(position.x),
      y: roundCoordinate(position.y),
    };
    this.notify("position");
  }

  resetNodePositions() {
    this.nodePositions[this.orientation] = {};
    this.notify("structure");
  }

  exportLayout(graphSlug) {
    return {
      schemaVersion: "0.1",
      graph: graphSlug,
      positions: {
        vertical: { ...this.nodePositions.vertical },
        horizontal: { ...this.nodePositions.horizontal },
      },
    };
  }

  getVisibleGraph() {
    const filteredEdges = this.graph.edges.filter((edge) => this.enabledKinds.has(edge.kind));
    const structurallyHidden = new Set(this.hidden);
    for (const nodeId of this.collapsed) {
      for (const descendant of walk(nodeId, filteredEdges, "downstream")) {
        if (descendant !== nodeId) structurallyHidden.add(descendant);
      }
    }

    let focused = null;
    if (this.focusMode !== "all" && this.selected?.type === "node") {
      const selectedId = this.selected.id;
      const upstream = walk(selectedId, filteredEdges, "upstream");
      const downstream = walk(selectedId, filteredEdges, "downstream");
      focused =
        this.focusMode === "upstream"
          ? upstream
          : this.focusMode === "downstream"
            ? downstream
            : new Set([...upstream, ...downstream]);
    }

    const nodes = this.graph.nodes.filter(
      (node) => !structurallyHidden.has(node.id) && (!focused || focused.has(node.id)),
    );
    const visibleIds = new Set(nodes.map((node) => node.id));
    const edges = filteredEdges.filter(
      (edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to),
    );
    return { nodes, edges };
  }

  matchesQuery(node) {
    if (!this.query) return true;
    return [node.label, node.crate, node.module, node.file, node.role, node.description]
      .filter(Boolean)
      .some((value) => value.toLocaleLowerCase().includes(this.query));
  }
}

function roundCoordinate(value) {
  return Math.round(Math.max(-1_000_000, Math.min(1_000_000, value)) * 10) / 10;
}
function walk(startId, edges, direction) {
  const result = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of edges) {
      if (!downstreamKinds.has(edge.kind)) continue;
      const next =
        direction === "downstream"
          ? edge.from === current
            ? edge.to
            : null
          : edge.to === current
            ? edge.from
            : null;
      if (next && !result.has(next)) {
        result.add(next);
        queue.push(next);
      }
    }
  }
  return result;
}
