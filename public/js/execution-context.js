import { resolveEdgeCallSite } from "./call-site.js";
import { compareExecutionEdges, edgeExecutionOrder, edgeFlowKind, edgeRelationLabel } from "./edge-semantics.js";

export function executionOrderNote(edges) {
  if (!edges.length) return "本图未记录后续关系；这不等于运行时一定在此结束。";
  const conditional = edges.some((edge) => ["branch", "fallback", "loop-back", "loop-exit"].includes(edgeFlowKind(edge)));
  const ordered = edges.filter((edge) => edgeExecutionOrder(edge) !== null);
  const notes = [];
  if (conditional) notes.push("条件与回环按各自触发条件阅读，不表示这些路径都会依次执行。");
  if (ordered.length) notes.push("编号仅表示同一调用者内已标注的先后，不代表返回或并发完成顺序。");
  if (ordered.length < edges.length) notes.push("未编号关系的列表位置不表示执行先后。");
  return notes.join(" ");
}

export function edgeReadingNotes(edge) {
  const notes = [];
  if (edge.kind === "data-flow") notes.push("这里表达数据或状态依赖，不据此判断同步调用或等待关系。");
  if (edge.kind === "spawn") notes.push("这里交接给异步任务；是否等待结果、何时完成，请结合调用证据确认。");
  if (edge.kind === "callback") notes.push("这里通过回调衔接；触发时机与执行上下文请结合调用证据确认。");
  if (edge.kind === "async-boundary") notes.push("这里跨越异步边界；异步不等于无需等待，也不保证完成先后。");
  if (edge.kind === "remote") notes.push("这里跨越远程边界；请求与响应的配对、等待方式请结合调用证据确认。");
  if (["branch", "fallback", "loop-exit"].includes(edgeFlowKind(edge)) && !edge.condition?.trim()) {
    notes.push("触发条件尚未标注，请从源码确认何时进入这条路径。");
  }
  if (edgeExecutionOrder(edge) !== null) notes.push("此编号只比较同一调用者内的已知顺序，不是整条链路的全局步骤。");
  return notes;
}

function confidenceLabel(value) {
  return typeof value === "number" && Number.isFinite(value) && value < 1
    ? `置信度 ${Math.round(value * 100)}% · 需核验`
    : "";
}

export function nodeExecutionContext(node, graph) {
  const nodes = new Map(graph.nodes.map((item) => [item.id, item]));
  const incoming = graph.edges.filter((edge) => edge.to === node.id);
  const outgoing = graph.edges.filter((edge) => edge.from === node.id).sort(compareExecutionEdges);
  const relation = (edge, direction) => {
    const peer = nodes.get(direction === "incoming" ? edge.from : edge.to);
    const site = resolveEdgeCallSite(edge);
    return {
      id: edge.id,
      label: peer?.role || peer?.label || (direction === "incoming" ? edge.from : edge.to),
      symbol: peer?.label || "",
      kind: edgeRelationLabel(edge),
      order: direction === "outgoing" ? edgeExecutionOrder(edge) : null,
      condition: edge.condition || "",
      evidence: [site.available ? "有调用位置" : site.shortLabel, confidenceLabel(edge.confidence)].filter(Boolean).join(" · "),
      target: { type: "edge", id: edge.id },
    };
  };
  return {
    identifier: node.id,
    note: executionOrderNote(outgoing),
    incoming: incoming.map((edge) => relation(edge, "incoming")),
    outgoing: outgoing.map((edge) => relation(edge, "outgoing")),
  };
}

export function scenarioExecutionContext(step, scenario, kindLabels) {
  const steps = new Map(scenario.steps.map((item) => [item.id, item]));
  const participants = new Map(scenario.participants.map((item) => [item.id, item.label]));
  const relation = (link, direction) => {
    const peer = steps.get(direction === "incoming" ? link.from : link.to);
    return {
      id: link.id,
      label: peer?.label || (direction === "incoming" ? link.from : link.to),
      symbol: participants.get(peer?.participantId) || "",
      kind: kindLabels[link.kind] || link.kind,
      condition: link.condition || "",
      description: link.summary || link.label || "",
      evidence: confidenceLabel(link.confidence),
      target: { type: "step", id: peer?.id },
    };
  };
  return {
    note: "沿关系阅读协作与交接；列表和画布位置不代表实际耗时或并发完成顺序。",
    incoming: scenario.links.filter((link) => link.to === step.id).map((link) => relation(link, "incoming")),
    outgoing: scenario.links.filter((link) => link.from === step.id).map((link) => relation(link, "outgoing")),
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderExecutionContext(context, onSelect, { open = false } = {}) {
  const details = element("details", "execution-context");
  details.open = open;
  details.append(element("summary", "execution-context-heading", `执行衔接 · ${context.incoming.length} 处来源 / ${context.outgoing.length} 条后续`));
  details.append(element("p", "execution-reading-note", context.note));
  for (const [direction, title, empty] of [
    ["incoming", "从哪里来", "本图未记录上游关系。"],
    ["outgoing", "如何继续", "本图未记录后续关系。"],
  ]) {
    const section = element("section", "execution-direction");
    section.dataset.direction = direction;
    section.setAttribute("aria-label", title);
    section.append(element("h3", "execution-direction-title", title));
    if (!context[direction].length) section.append(element("p", "execution-empty", empty));
    const list = element("ul", "execution-relations");
    for (const relation of context[direction]) {
      const item = element("li", "execution-relation");
      const button = element("button", "execution-relation-button");
      button.type = "button";
      button.dataset.relationId = relation.id;
      const heading = element("span", "execution-relation-heading");
      heading.append(element("span", "execution-relation-kind", `${relation.order ? `${relation.order} · ` : ""}${relation.kind}`));
      heading.append(element("strong", "execution-relation-label", relation.label));
      button.append(heading);
      if (relation.symbol && relation.symbol !== relation.label) button.append(element("span", "execution-relation-symbol", relation.symbol));
      if (relation.condition) button.append(element("span", "execution-relation-condition", `条件：${relation.condition}`));
      if (relation.description) button.append(element("span", "execution-relation-description", relation.description));
      if (relation.evidence) button.append(element("span", "execution-relation-evidence", relation.evidence));
      button.title = relation.target.type === "edge" ? "查看这条关系及源码证据" : "阅读相邻步骤";
      button.addEventListener("click", () => onSelect?.(relation.target));
      item.append(button);
      list.append(item);
    }
    section.append(list);
    details.append(section);
  }
  if (context.identifier) details.append(element("p", "execution-relation-symbol", `节点 ID：${context.identifier}`));
  return details;
}
