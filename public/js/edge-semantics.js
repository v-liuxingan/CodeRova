export const CONTROL_EDGE_KINDS = new Set([
  "static-call",
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

const EDGE_KIND_LABELS = {
  "static-call": "静态调用（机制未分类）",
  direct: "直接调用",
  callback: "回调",
  "trait-dispatch": "Trait 分发",
  spawn: "异步任务",
  remote: "远程调用",
  "async-boundary": "异步边界",
  "data-flow": "数据流",
};

export function edgeFlowKind(edge) {
  return edge.flowKind || "normal";
}

export function edgeFlowKindLabel(edge) {
  return FLOW_KIND_LABELS[edgeFlowKind(edge)] || "";
}

export function edgeRelationLabel(edge) {
  return edgeFlowKindLabel(edge)
    || EDGE_KIND_LABELS[edge?.kind]
    || edge?.kind
    || "调用";
}

export function edgeGroupLabel(edges) {
  if (edges.some((edge) => ["branch", "fallback"].includes(edgeFlowKind(edge)))) {
    return "条件路径";
  }
  if (edges.some((edge) => edgeExecutionOrder(edge) !== null)) {
    return "调用顺序";
  }
  if (
    edges.length
    && edges.every((edge) =>
      ["spawn", "callback", "async-boundary"].includes(edge?.kind),
    )
  ) {
    return "异步路径";
  }
  return "下游路径";
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
