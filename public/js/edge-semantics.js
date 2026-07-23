export const CONTROL_EDGE_KINDS = new Set([
  "direct",
  "callback",
  "trait-dispatch",
  "spawn",
  "remote",
  "async-boundary",
]);

export function isControlEdge(edge) {
  return CONTROL_EDGE_KINDS.has(edge.kind);
}

const FLOW_KIND_LABELS = {
  branch: "分支",
  fallback: "降级",
  merge: "汇合",
  "loop-back": "循环回边",
  "loop-exit": "循环退出",
};

export function edgeFlowKind(edge) {
  return edge.flowKind || "normal";
}

export function edgeFlowKindLabel(edge) {
  return FLOW_KIND_LABELS[edgeFlowKind(edge)] || "";
}

export function edgeFlowSemanticText(edge) {
  const label = edgeFlowKindLabel(edge);
  const parts = [];
  if (label) parts.push(`控制流 ${label}`);
  if (edge.condition) parts.push(`条件 ${edge.condition}`);
  return parts.join("，");
}

export function edgeExecutionOrder(edge) {
  const order = Number(edge?.order);
  return Number.isInteger(order) && order > 0 ? order : null;
}

export function compareExecutionEdges(left, right) {
  if (left.from === right.from) {
    const leftOrder = edgeExecutionOrder(left);
    const rightOrder = edgeExecutionOrder(right);
    if (leftOrder !== null || rightOrder !== null) {
      if (leftOrder === null) return 1;
      if (rightOrder === null) return -1;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    }
  }
  return String(left.id).localeCompare(String(right.id));
}
