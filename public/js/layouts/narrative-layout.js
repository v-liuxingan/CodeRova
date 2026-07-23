import {
  compareExecutionEdges,
  edgeExecutionOrder,
  isControlEdge,
} from "../edge-semantics.js";

/**
 * Stable, cycle-safe layout that keeps one control-flow narrative on a central
 * spine and distributes the remaining branches on both sides.
 *
 * The returned metadata is renderer-agnostic. Renderers may use it to
 * distinguish the spine, but graph state and persistence remain layout-owned.
 */
export class NarrativeLayout {
  constructor({
    nodeWidth = 230,
    nodeHeight = 92,
    layerGap = 104,
    branchGap = 62,
  } = {}) {
    this.nodeWidth = nodeWidth;
    this.nodeHeight = nodeHeight;
    this.layerGap = layerGap;
    this.branchGap = branchGap;
  }

  compute(graph, orientation = "vertical", positionOverrides = {}) {
    if (!graph.nodes.length) {
      return {
        nodes: new Map(),
        edges: [],
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        narrative: emptyNarrative(),
      };
    }

    const nodes = [...graph.nodes];
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = graph.edges
      .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
      .sort(compareEdges);
    const controlEdges = edges.filter(isControlEdge);
    const startId = resolveStart(graph.root, nodes, controlEdges, edges);
    const narrative = findMainPath(startId, edges, nodeIds);
    const referenceNodeIds = new Set(graph.nodes.map((node) => node.id));
    const referenceEdges = graph.edges
      .filter((edge) =>
        referenceNodeIds.has(edge.from)
        && referenceNodeIds.has(edge.to))
      .sort(compareEdges);
    const declaredFeedbackEdgeIds = new Set(
      graph.edges
        .filter((edge) => edge.flowKind === "loop-back")
        .map((edge) => edge.id),
    );
    const rankAnalysis = assignForwardRanks(
      resolveStart(
        graph.root,
        graph.nodes,
        referenceEdges.filter(isControlEdge),
        referenceEdges,
      ),
      graph.nodes,
      referenceEdges,
      declaredFeedbackEdgeIds,
    );
    const levels = rankAnalysis.levels;
    const branchSides = assignBranchSides(nodes, edges, narrative);
    const vertical = orientation === "vertical";
    const crossDimension = vertical ? this.nodeWidth : this.nodeHeight;
    const mainDimension = vertical ? this.nodeHeight : this.nodeWidth;
    const crossStep = crossDimension + this.branchGap;
    const mainStep = mainDimension + this.layerGap;
    const layers = groupByLevel(nodes, levels);
    const centeredSpineIds = new Set(
      [...layers.values()]
        .map((layerNodes) =>
          layerNodes.find((node) => narrative.nodeIds.has(node.id))?.id)
        .filter(Boolean),
    );
    const positions = new Map();

    const place = (node, cross, main) => {
      if (!node) return;
      const override = positionOverrides[node.id];
      const automaticX = vertical ? cross : main;
      const automaticY = vertical ? main : cross;
      positions.set(node.id, {
        node,
        x: Number.isFinite(override?.x) ? override.x : automaticX,
        y: Number.isFinite(override?.y) ? override.y : automaticY,
        width: this.nodeWidth,
        height: this.nodeHeight,
        narrativeRole: centeredSpineIds.has(node.id) ? "spine" : "branch",
        branchSide: branchSides.get(node.id)?.side || 0,
        level: levels.get(node.id) ?? 0,
      });
    };

    for (const [level, layerNodes] of [...layers].sort((a, b) => a[0] - b[0])) {
      const spineNode = layerNodes.find((node) => narrative.nodeIds.has(node.id));
      const branches = layerNodes
        .filter((node) => node !== spineNode)
        .sort((a, b) => compareBranchNodes(a, b, branchSides));
      const left = [];
      const right = [];
      let neutralOrdinal = 0;
      for (const node of branches) {
        const side = branchSides.get(node.id)?.side || 0;
        if (side < 0) left.push(node);
        else if (side > 0) right.push(node);
        else {
          neutralOrdinal += 1;
          (neutralOrdinal % 2 ? left : right).push(node);
        }
      }

      place(spineNode, 0, level * mainStep);
      left.forEach((node, index) => place(node, -(index + 1) * crossStep, level * mainStep));
      right.forEach((node, index) => place(node, (index + 1) * crossStep, level * mainStep));
    }
    applyOrderedSiblingBands({
      edges,
      positions,
      vertical,
      crossStep,
      positionOverrides,
    });

    const values = [...positions.values()];
    const minX = Math.min(...values.map((item) => item.x));
    const minY = Math.min(...values.map((item) => item.y));
    const maxX = Math.max(...values.map((item) => item.x + item.width));
    const maxY = Math.max(...values.map((item) => item.y + item.height));
    const nodeBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    const feedbackEdges = edges
      .filter((edge) => rankAnalysis.feedbackEdgeIds.has(edge.id))
      .sort(compareEdges);
    const feedbackLaneById = new Map(
      feedbackEdges.map((edge, index) => [edge.id, index]),
    );
    const routeExtents = feedbackRouteExtents(feedbackEdges.length, vertical);
    const bounds = {
      x: nodeBounds.x - routeExtents.left,
      y: nodeBounds.y - routeExtents.top,
      width: nodeBounds.width + routeExtents.left + routeExtents.right,
      height: nodeBounds.height + routeExtents.top + routeExtents.bottom,
    };
    return {
      nodes: positions,
      edges: edges.map((edge) => ({
        edge,
        from: positions.get(edge.from),
        to: positions.get(edge.to),
        narrativeRole: narrative.edgeIds.has(edge.id)
          ? "spine"
          : edge.kind === "data-flow"
            ? "data"
            : "branch",
        routingRole: feedbackLaneById.has(edge.id) ? "feedback" : "forward",
        backEdge: feedbackLaneById.has(edge.id),
        feedbackLane: feedbackLaneById.get(edge.id) ?? 0,
        bounds: nodeBounds,
      })),
      bounds,
      narrative,
      rankAnalysis,
    };
  }
}

function findMainPath(startId, edges, nodeIds) {
  const nodeIdsOnPath = new Set();
  const edgeIdsOnPath = new Set();
  const orderedNodeIds = [];
  const outgoing = adjacency(edges);
  let current = startId;

  while (current && nodeIds.has(current) && !nodeIdsOnPath.has(current)) {
    nodeIdsOnPath.add(current);
    orderedNodeIds.push(current);
    const candidates = (outgoing.get(current) || [])
      .filter((edge) => !nodeIdsOnPath.has(edge.to));
    const control = candidates.filter(isControlEdge);
    const pool = control.length
      ? control
      : candidates.filter((edge) => edge.kind === "data-flow");
    if (!pool.length) break;
    const ranked = pool
      .map((edge) => ({
        edge,
        score: reachableControlNodes(edge.to, outgoing, nodeIdsOnPath),
      }))
      .sort((a, b) =>
        b.score - a.score
        || compareEdges(a.edge, b.edge)
        || a.edge.to.localeCompare(b.edge.to));
    const chosen = ranked[0].edge;
    edgeIdsOnPath.add(chosen.id);
    current = chosen.to;
  }

  return {
    startId,
    orderedNodeIds,
    nodeIds: nodeIdsOnPath,
    edgeIds: edgeIdsOnPath,
  };
}

function reachableControlNodes(startId, outgoing, blocked) {
  const visited = new Set(blocked);
  const stack = [startId];
  let count = 0;
  while (stack.length) {
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    count += 1;
    const next = (outgoing.get(current) || [])
      .filter(isControlEdge)
      .map((edge) => edge.to)
      .sort((a, b) => b.localeCompare(a));
    stack.push(...next);
  }
  return count;
}

/**
 * Deterministic dagre-style rank pass:
 * 1. a root-first DFS marks cycle-closing control edges as feedback;
 * 2. the remaining DAG receives longest-path ranks with edgeMinLen = 1.
 *
 * Runtime-declared loop backs are removed first. All remaining source-evidence
 * edges constrain rank, including data-flow, so tool results and merge inputs
 * do not jump in front of their producers. A DFS marks any additional
 * cycle-closing edges as feedback. Nodes without relations are appended
 * deterministically so they cannot overlap the ranked graph.
 */
function assignForwardRanks(startId, nodes, rankEdges, declaredFeedbackEdgeIds) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const candidateEdges = rankEdges.filter(
    (edge) => !declaredFeedbackEdgeIds.has(edge.id),
  );
  const outgoing = adjacency(candidateEdges);
  for (const list of outgoing.values()) list.sort(compareEdges);
  const feedbackEdgeIds = new Set(declaredFeedbackEdgeIds);
  const state = new Map();

  const visit = (nodeId) => {
    state.set(nodeId, 1);
    for (const edge of outgoing.get(nodeId) || []) {
      const targetState = state.get(edge.to) || 0;
      if (targetState === 1) {
        feedbackEdgeIds.add(edge.id);
      } else if (targetState === 0) {
        visit(edge.to);
      }
    }
    state.set(nodeId, 2);
  };

  const traversal = [
    ...(startId && nodeIds.has(startId) ? [startId] : []),
    ...[...nodes].sort(compareNodes).map((node) => node.id),
  ];
  for (const nodeId of traversal) {
    if (!state.has(nodeId)) visit(nodeId);
  }

  const forwardEdges = rankEdges.filter((edge) => !feedbackEdgeIds.has(edge.id));
  const forwardOutgoing = adjacency(forwardEdges);
  for (const list of forwardOutgoing.values()) list.sort(compareEdges);
  const indegree = new Map([...nodeIds].map((nodeId) => [nodeId, 0]));
  const rankDegree = new Map([...nodeIds].map((nodeId) => [nodeId, 0]));
  for (const edge of rankEdges) {
    rankDegree.set(edge.from, rankDegree.get(edge.from) + 1);
    rankDegree.set(edge.to, rankDegree.get(edge.to) + 1);
  }
  for (const edge of forwardEdges) {
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }

  const levels = new Map([...nodeIds].map((nodeId) => [nodeId, 0]));
  const ready = [...nodeIds]
    .filter((nodeId) => indegree.get(nodeId) === 0)
    .sort((a, b) => compareRankRoots(a, b, startId));
  let visited = 0;
  while (ready.length) {
    const nodeId = ready.shift();
    visited += 1;
    for (const edge of forwardOutgoing.get(nodeId) || []) {
      levels.set(edge.to, Math.max(levels.get(edge.to), levels.get(nodeId) + 1));
      indegree.set(edge.to, indegree.get(edge.to) - 1);
      if (indegree.get(edge.to) === 0) {
        ready.push(edge.to);
        ready.sort((a, b) => compareRankRoots(a, b, startId));
      }
    }
  }
  if (visited !== nodeIds.size) {
    throw new Error("feedback edge classification did not produce a DAG");
  }

  let fallbackLevel = Math.max(0, ...levels.values()) + 1;
  for (const node of [...nodes].sort(compareNodes)) {
    if (rankDegree.get(node.id) !== 0) continue;
    levels.set(node.id, fallbackLevel);
    fallbackLevel += 1;
  }
  return { levels, feedbackEdgeIds, forwardEdgeIds: new Set(forwardEdges.map((edge) => edge.id)) };
}

function feedbackRouteExtents(count, vertical) {
  let negative = 0;
  let positive = 0;
  for (let index = 0; index < count; index += 1) {
    const extent = 48 + Math.floor(index / 2) * 26;
    if (index % 2 === 0) negative = Math.max(negative, extent);
    else positive = Math.max(positive, extent);
  }
  return vertical
    ? { left: negative, right: positive, top: 0, bottom: 0 }
    : { left: 0, right: 0, top: negative, bottom: positive };
}

function compareRankRoots(a, b, startId) {
  if (a === startId) return -1;
  if (b === startId) return 1;
  return String(a).localeCompare(String(b));
}

function assignBranchSides(nodes, edges, narrative) {
  const result = new Map();
  const outgoing = adjacency(edges);
  const spineIndex = new Map(
    narrative.orderedNodeIds.map((nodeId, index) => [nodeId, index]),
  );
  let branchOrdinal = 0;
  const queue = [];

  for (const spineId of narrative.orderedNodeIds) {
    const departures = (outgoing.get(spineId) || [])
      .filter((edge) =>
        !narrative.edgeIds.has(edge.id) && !narrative.nodeIds.has(edge.to))
      .sort(compareEdges);
    for (const edge of departures) {
      if (result.has(edge.to)) continue;
      branchOrdinal += 1;
      const side = branchOrdinal % 2 ? -1 : 1;
      const branch = {
        side,
        anchorIndex: spineIndex.get(spineId) ?? Number.MAX_SAFE_INTEGER,
        order: branchOrdinal,
      };
      result.set(edge.to, branch);
      queue.push(edge.to);
    }
  }

  while (queue.length) {
    const current = queue.shift();
    const branch = result.get(current);
    for (const edge of outgoing.get(current) || []) {
      if (narrative.nodeIds.has(edge.to) || result.has(edge.to)) continue;
      result.set(edge.to, branch);
      queue.push(edge.to);
    }
  }

  for (const node of [...nodes].sort(compareNodes)) {
    if (narrative.nodeIds.has(node.id) || result.has(node.id)) continue;
    branchOrdinal += 1;
    result.set(node.id, {
      side: branchOrdinal % 2 ? -1 : 1,
      anchorIndex: Number.MAX_SAFE_INTEGER,
      order: branchOrdinal,
    });
  }
  return result;
}

function resolveStart(root, nodes, controlEdges, edges) {
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.has(root)) return root;
  for (const candidates of [controlEdges, edges]) {
    const incoming = new Set(candidates.map((edge) => edge.to));
    const roots = nodes.filter((node) => !incoming.has(node.id)).sort(compareNodes);
    if (roots.length) return roots[0].id;
  }
  return [...nodes].sort(compareNodes)[0]?.id;
}

function adjacency(edges) {
  const map = new Map();
  for (const edge of edges) {
    if (!map.has(edge.from)) map.set(edge.from, []);
    map.get(edge.from).push(edge);
  }
  return map;
}

function groupByLevel(nodes, levels) {
  const layers = new Map();
  for (const node of nodes) {
    const level = levels.get(node.id);
    if (!layers.has(level)) layers.set(level, []);
    layers.get(level).push(node);
  }
  return layers;
}

function applyOrderedSiblingBands({
  edges,
  positions,
  vertical,
  crossStep,
  positionOverrides,
}) {
  const groups = new Map();
  for (const edge of edges) {
    if (edgeExecutionOrder(edge) === null) continue;
    const child = positions.get(edge.to);
    const parent = positions.get(edge.from);
    if (!child || !parent) continue;
    const key = `${edge.from}\u0000${child.level}`;
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key).set(edge.to, { edge, child, parent });
  }

  for (const membersById of groups.values()) {
    const members = [...membersById.values()]
      .sort((left, right) => compareExecutionEdges(left.edge, right.edge));
    if (members.length < 2) continue;
    const crossOverride = vertical ? "x" : "y";

    const parentCross = vertical ? members[0].parent.x : members[0].parent.y;
    const startCross = parentCross - ((members.length - 1) * crossStep) / 2;
    members.forEach(({ edge, child }, index) => {
      child.orderedSiblingBand = true;
      child.executionOrder = edgeExecutionOrder(edge);
      if (Number.isFinite(positionOverrides[edge.to]?.[crossOverride])) return;
      if (vertical) child.x = startCross + index * crossStep;
      else child.y = startCross + index * crossStep;
    });
  }
}

function compareBranchNodes(a, b, sides) {
  const branchA = sides.get(a.id);
  const branchB = sides.get(b.id);
  return (
    (branchA?.side || 0) - (branchB?.side || 0)
    || (branchA?.anchorIndex || 0) - (branchB?.anchorIndex || 0)
    || (branchA?.order || 0) - (branchB?.order || 0)
    || compareNodes(a, b)
  );
}

function compareEdges(a, b) {
  return compareExecutionEdges(a, b);
}

function compareNodes(a, b) {
  return String(a.id).localeCompare(String(b.id));
}

function emptyNarrative() {
  return {
    startId: null,
    orderedNodeIds: [],
    nodeIds: new Set(),
    edgeIds: new Set(),
  };
}
