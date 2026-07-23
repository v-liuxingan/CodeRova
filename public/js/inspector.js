import { resolveEdgeCallSite } from "./call-site.js";
import {
  edgeExecutionOrder,
  edgeFlowKind,
  edgeFlowKindLabel,
} from "./edge-semantics.js";
import { SourcePreviewView } from "./source-preview-view.js";

export class Inspector {
  constructor(emptyElement, contentElement, sourceBodyElement) {
    this.emptyElement = emptyElement;
    this.contentElement = contentElement;
    this.sourceBodyElement = sourceBodyElement;
    this.callbacks = {};
    this.targetKey = "";
    this.sourcePreviewView = new SourcePreviewView();
  }

  setCallbacks(callbacks) {
    this.callbacks = callbacks;
  }

  render(target, graph) {
    if (!target) {
      this.targetKey = "";
      this.emptyElement.hidden = false;
      this.contentElement.hidden = true;
      this.contentElement.replaceChildren();
      this.renderSourcePlaceholder("选择可定位的节点或连线", "源码将在这里以受限上下文安全展示。");
      return;
    }
    const item = findTarget(target, graph);
    if (!item) return this.render(null, graph);

    const nextTargetKey = targetKey(target);
    const targetChanged = this.targetKey !== nextTargetKey;
    this.targetKey = nextTargetKey;
    if (targetChanged) this.renderSourcePreviewLoading(target);
    this.emptyElement.hidden = true;
    this.contentElement.hidden = false;
    this.contentElement.className =
      `inspect-content ${target.type === "node" ? "node-detail" : "edge-detail"}`;
    this.contentElement.innerHTML = targetTemplate(target, item, graph);
    this.contentElement.querySelector("[data-open]")?.addEventListener("click", () => {
      this.callbacks.onOpen?.(target);
    });
    this.contentElement.querySelector("[data-hide]")?.addEventListener("click", () => {
      this.callbacks.onHide?.(item.id);
    });
    this.contentElement.querySelector("[data-collapse]")?.addEventListener("click", () => {
      this.callbacks.onCollapse?.(item.id);
    });
  }

  renderSourcePreview(target, preview) {
    if (this.targetKey !== targetKey(target)) return;
    this.sourcePreviewView.render(this.sourceBodyElement, preview, {
      onContextChange: (lines) => this.callbacks.onPreviewContextChange?.(lines),
      onScopeChange: (scope) => this.callbacks.onPreviewScopeChange?.(scope),
      onNotice: (message, error) => this.callbacks.onPreviewNotice?.(message, error),
    });
  }

  renderSourcePreviewLoading(target) {
    if (this.targetKey && this.targetKey !== targetKey(target)) return;
    const loading = document.createElement("span");
    loading.className = "source-preview-loading";
    loading.textContent = "正在读取受限源码范围…";
    this.sourceBodyElement.replaceChildren(loading);
  }

  renderSourcePreviewError(target, message) {
    if (this.targetKey !== targetKey(target)) return;
    const notice = document.createElement("div");
    notice.className = "source-preview-error";
    notice.textContent = message;
    this.sourceBodyElement.replaceChildren(notice);
  }

  renderSourceUnavailable(message = "当前目标没有精确源码位置") {
    this.renderSourcePlaceholder(message, "语义摘要仍会保留调用证据与不可跳转原因。");
  }

  renderSourcePlaceholder(title, description) {
    const placeholder = document.createElement("div");
    placeholder.className = "source-workbench-empty";
    const eyebrow = document.createElement("span");
    eyebrow.textContent = "READ ONLY";
    const heading = document.createElement("strong");
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.textContent = description;
    placeholder.append(eyebrow, heading, copy);
    this.sourceBodyElement.replaceChildren(placeholder);
  }
}

function findTarget(target, graph) {
  if (target.type === "node") {
    return graph.nodes.find((node) => node.id === target.id);
  }
  if (target.type === "edge") {
    return graph.edges.find((edge) => edge.id === target.id);
  }
  return null;
}

function targetTemplate(target, item, graph) {
  if (target.type === "node") return nodeTemplate(item);
  if (target.type === "edge") return edgeTemplate(item, graph);
  return "";
}

function nodeTemplate(node) {
  const role = node.role?.trim();
  const description = node.description?.trim();
  return `
    <div class="inspect-heading">
      <div>
        <span class="inspect-type">NODE / ${escapeHtml(node.kind).toUpperCase()}</span>
        <h2>${escapeHtml(node.label)}</h2>
      </div>
      <div class="inspect-id">${escapeHtml(node.id)}</div>
    </div>
    <section class="node-purpose" aria-label="节点职责">
      <span class="node-purpose-kicker">节点职责 / WHY IT MATTERS</span>
      <strong class="node-purpose-role${role ? "" : " is-fallback"}">${escapeHtml(role || "职责尚未标注")}</strong>
      <p class="node-purpose-description${description ? "" : " is-fallback"}">${escapeHtml(description || "当前节点暂无语义描述，可结合下方源码证据继续确认。")}</p>
    </section>
    <div class="inspect-facts" aria-label="节点事实">
      <span><b>SOURCE</b>${escapeHtml(node.file)}:${node.line}${node.endLine ? `–${node.endLine}` : ""}</span>
      <span><b>OWNER</b>${escapeHtml(node.crate || "—")} / ${escapeHtml(node.module || "—")}</span>
    </div>
    <div class="inspect-actions">
      <button class="primary-action" data-open>↗ 在编辑器打开</button>
      <button class="secondary-action" data-collapse title="折叠或展开下游">折叠</button>
      <button class="secondary-action" data-hide title="临时隐藏节点">隐藏</button>
    </div>`;
}

function edgeTemplate(edge, graph) {
  const percent = Math.round(edge.confidence * 100);
  const callSite = resolveEdgeCallSite(edge);
  const from = graph.nodes.find((node) => node.id === edge.from);
  const to = graph.nodes.find((node) => node.id === edge.to);
  const flowKind = edgeFlowKind(edge);
  const flowKindLabel = edgeFlowKindLabel(edge);
  const executionOrder = edgeExecutionOrder(edge);
  const executionOrderContent = executionOrder
    ? `<span><b>CALL ORDER</b>第 ${executionOrder} 步</span>`
    : "";
  const controlFlowContent = flowKind === "normal"
    ? ""
    : `<span><b>CONTROL FLOW</b>${escapeHtml(flowKindLabel)}</span>`;
  const conditionContent = edge.condition
    ? `<span><b>CONDITION</b>${escapeHtml(edge.condition)}</span>`
    : "";
  const callSiteContent = callSite.available
    ? `<span><b>CALL SITE</b>${escapeHtml(callSite.file)}:${callSite.line}</span>`
    : `<div class="callsite-notice">
        <strong>${escapeHtml(callSite.shortLabel)}</strong>
        <span>${escapeHtml(callSite.note)}</span>
      </div>`;
  const openAction = callSite.available
    ? `<div class="inspect-actions">
        <button class="primary-action" data-open>↗ 打开调用位置</button>
      </div>`
    : "";
  return `
    <div class="inspect-heading">
      <div>
        <span class="inspect-type">EDGE / ${escapeHtml(edge.kind).toUpperCase()}</span>
        <h2>${escapeHtml(edge.label || "调用关系")}</h2>
      </div>
      <div class="inspect-confidence">${percent}% CONFIDENCE</div>
    </div>
    <div class="inspect-route">
      <span>${escapeHtml(from?.label || edge.from)}</span>
      <i aria-hidden="true">→</i>
      <span>${escapeHtml(to?.label || edge.to)}</span>
    </div>
    <div class="inspect-role">${escapeHtml(edge.description || "暂无描述")}</div>
    <div class="inspect-facts" aria-label="调用关系事实">
      ${callSiteContent}
      <span><b>RELATION</b>${escapeHtml(edge.kind)}</span>
      ${executionOrderContent}
      ${controlFlowContent}
      ${conditionContent}
    </div>
    <details class="inspect-evidence">
      <summary>查看调用证据</summary>
      <p>${escapeHtml(edge.evidence || "未记录证据")}</p>
    </details>
    ${openAction}`;
}

function targetKey(target) {
  return `${target?.type || ""}:${target?.id || ""}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
