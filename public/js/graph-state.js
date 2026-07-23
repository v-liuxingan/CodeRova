import {
  computeEdgeSelectionFocus,
  computeSelectionFocus,
} from "./selection-focus.js";
import { isControlEdge } from "./edge-semantics.js";

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
    this.selectionFocusNodeId = null;
    this.selectionFocusAnchorId = null;
    this.selectedNodeIds = new Set();
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

  select(target, { preserveFocusAnchor = false } = {}) {
    const previousNodeId =
      this.selected?.type === "node" ? this.selected.id : null;
    this.selected = target;
    this.selectedNodeIds.clear();
    if (target?.type === "node") {
      this.selectionFocusNodeId = target.id;
      const candidateAnchorId = preserveFocusAnchor
        ? this.selectionFocusAnchorId || previousNodeId
        : previousNodeId;
      if (
        !candidateAnchorId
        || (
          !isUpstreamOf(target.id, candidateAnchorId, this.graph.edges)
          && !isUpstreamOf(candidateAnchorId, target.id, this.graph.edges)
        )
      ) {
        this.selectionFocusAnchorId = target.id;
      } else {
        this.selectionFocusAnchorId = candidateAnchorId;
      }
    } else {
      this.selectionFocusNodeId = null;
      this.selectionFocusAnchorId = null;
    }
    this.notify("selection");
  }

  clearInteractionSelection() {
    if (!this.selected && !this.selectedNodeIds.size) return;
    this.selected = null;
    this.selectionFocusNodeId = null;
    this.selectionFocusAnchorId = null;
    this.selectedNodeIds.clear();
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

  setSelectedNodes(nodeIds) {
    this.selectedNodeIds = new Set(
      [...nodeIds].filter((nodeId) => this.nodeById.has(nodeId)),
    );
    this.notify("layout-selection");
  }

  toggleSelectedNode(nodeId) {
    if (!this.nodeById.has(nodeId)) return;
    if (this.selectedNodeIds.has(nodeId)) this.selectedNodeIds.delete(nodeId);
    else this.selectedNodeIds.add(nodeId);
    this.notify("layout-selection");
  }

  clearSelectedNodes() {
    if (!this.selectedNodeIds.size) return;
    this.selectedNodeIds.clear();
    this.notify("layout-selection");
  }

  toggleCollapse(nodeId) {
    if (this.collapsed.has(nodeId)) this.collapsed.delete(nodeId);
    else this.collapsed.add(nodeId);
    this.notify("structure");
  }

  hideNode(nodeId) {
    this.hidden.add(nodeId);
    if (this.selected?.type === "node" && this.selected.id === nodeId) {
      this.selected = null;
      this.selectionFocusNodeId = null;
      this.selectionFocusAnchorId = null;
    }
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
    this.setNodePositions({ [nodeId]: position });
  }

  setNodePositions(positions) {
    let changed = false;
    for (const [nodeId, position] of Object.entries(positions || {})) {
      if (!this.nodeById.has(nodeId)) continue;
      this.nodePositions[this.orientation][nodeId] = {
        x: roundCoordinate(position.x),
        y: roundCoordinate(position.y),
      };
      changed = true;
    }
    if (changed) this.notify("position");
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
    for (const descendant of exclusiveForwardControlDescendants(
      this.collapsed,
      this.graph.nodes,
      this.graph.edges,
    )) {
      structurallyHidden.add(descendant);
    }
    if (
      this.selected?.type === "node"
      && structurallyHidden.has(this.selected.id)
    ) {
      this.selected = null;
      this.selectionFocusNodeId = null;
      this.selectionFocusAnchorId = null;
    } else if (
      this.selected?.type === "node"
      && structurallyHidden.has(this.selectionFocusAnchorId)
    ) {
      this.selectionFocusAnchorId = this.selected.id;
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
      (node) =>
        !structurallyHidden.has(node.id)
        && (!focused || focused.has(node.id)),
    );
    const visibleIds = new Set(nodes.map((node) => node.id));
    for (const nodeId of this.selectedNodeIds) {
      if (!visibleIds.has(nodeId)) this.selectedNodeIds.delete(nodeId);
    }
    const edges = filteredEdges.filter(
      (edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to),
    );
    const selectionFocus = this.selected?.type === "edge"
      ? computeEdgeSelectionFocus(this.selected.id, nodes, edges)
      : computeSelectionFocus(
        this.selected?.type === "node"
          && this.selected.id === this.selectionFocusNodeId
          ? this.selected.id
          : null,
        nodes,
        edges,
        this.selectionFocusAnchorId,
      );
    return {
      root: this.graph.root,
      nodes,
      edges,
      selectionFocus,
    };
  }

  matchesQuery(node) {
    if (!this.query) return true;
    return [node.label, node.crate, node.module, node.file, node.role, node.description]
      .filter(Boolean)
      .some((value) => value.toLocaleLowerCase().includes(this.query));
  }
}

function isUpstreamOf(candidateId, anchorId, edges) {
  if (candidateId === anchorId) return true;
  const traversableEdges = edges.filter((edge) => edge.flowKind !== "loop-back");
  return walk(anchorId, traversableEdges, "upstream").has(candidateId);
}

export function exclusiveForwardControlDescendants(collapsedRoots, nodes, edges) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const roots = new Set(
    [...collapsedRoots].filter((nodeId) => nodeIds.has(nodeId)),
  );
  const region = new Set(roots);
  const incomingParents = new Map();
  const outgoingChildren = new Map();

  for (const edge of edges) {
    if (
      !isControlEdge(edge)
      || edge.flowKind === "loop-back"
      || !nodeIds.has(edge.from)
      || !nodeIds.has(edge.to)
    ) {
      continue;
    }
    appendToSetMap(incomingParents, edge.to, edge.from);
    appendToSetMap(outgoingChildren, edge.from, edge.to);
  }

  const queue = [...roots];
  while (queue.length) {
    const current = queue.shift();
    for (const candidate of outgoingChildren.get(current) || []) {
      if (region.has(candidate)) continue;
      const parents = incomingParents.get(candidate) || new Set();
      if ([...parents].every((parent) => region.has(parent))) {
        region.add(candidate);
        queue.push(candidate);
      }
    }
  }

  for (const root of roots) region.delete(root);
  return region;
}

function appendToSetMap(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
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
