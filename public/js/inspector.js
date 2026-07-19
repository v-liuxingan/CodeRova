import { resolveEdgeCallSite } from "./call-site.js";
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
    const item =
      target.type === "node"
        ? graph.nodes.find((node) => node.id === target.id)
        : graph.edges.find((edge) => edge.id === target.id);
    if (!item) return this.render(null, graph);

    const nextTargetKey = targetKey(target);
    const targetChanged = this.targetKey !== nextTargetKey;
    this.targetKey = nextTargetKey;
    if (targetChanged) this.renderSourcePreviewLoading(target);
    this.emptyElement.hidden = true;
    this.contentElement.hidden = false;
    this.contentElement.className = "inspect-content";
    this.contentElement.innerHTML =
      target.type === "node" ? nodeTemplate(item) : edgeTemplate(item);
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
    this.renderSourcePlaceholder(message, "仍可在“详情”中查看调用证据与不可跳转原因。");
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
function nodeTemplate(node) {
  return `
    <span class="inspect-type">NODE / ${escapeHtml(node.kind).toUpperCase()}</span>
    <h2>${escapeHtml(node.label)}</h2>
    <div class="inspect-id">${escapeHtml(node.id)}</div>
    <div class="inspect-role">${escapeHtml(node.role)}</div>
    <section class="inspect-section">
      <h3>RESPONSIBILITY</h3>
      <p>${escapeHtml(node.description || "暂无补充说明")}</p>
    </section>
    <section class="inspect-section">
      <h3>SOURCE LOCATION</h3>
      <div class="source-card">${escapeHtml(node.file)}:${node.line}${node.endLine ? `–${node.endLine}` : ""}</div>
    </section>
    <section class="inspect-section">
      <h3>OWNERSHIP</h3>
      <p>${escapeHtml(node.crate || "—")}<br>${escapeHtml(node.module || "—")}</p>
    </section>
    <div class="inspect-actions">
      <button class="primary-action" data-open>↗ 在编辑器打开</button>
      <button class="secondary-action" data-collapse title="折叠或展开下游">折叠</button>
      <button class="secondary-action" data-hide title="临时隐藏节点">隐藏</button>
    </div>`;
}

function edgeTemplate(edge) {
  const percent = Math.round(edge.confidence * 100);
  const callSite = resolveEdgeCallSite(edge);
  const callSiteContent = callSite.available
    ? `<div class="source-card">${escapeHtml(callSite.file)}:${callSite.line}</div>`
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
    <span class="inspect-type">EDGE / ${escapeHtml(edge.kind).toUpperCase()}</span>
    <h2>${escapeHtml(edge.label || "调用关系")}</h2>
    <div class="inspect-id">${escapeHtml(edge.from)} → ${escapeHtml(edge.to)}</div>
    <div class="inspect-role">${escapeHtml(edge.description || "调用边")}</div>
    <section class="inspect-section">
      <h3>CALL SITE</h3>
      ${callSiteContent}
    </section>
    <section class="inspect-section">
      <h3>EVIDENCE</h3>
      <p>${escapeHtml(edge.evidence || "未记录证据")}</p>
    </section>
    <section class="inspect-section">
      <h3>CONFIDENCE</h3>
      <div class="confidence">
        <progress class="confidence-track" max="100" value="${percent}">${percent}%</progress>
        <span>${percent}%</span>
      </div>
    </section>
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
