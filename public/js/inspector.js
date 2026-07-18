import { resolveEdgeCallSite } from "./call-site.js";

export class Inspector {
  constructor(emptyElement, contentElement) {
    this.emptyElement = emptyElement;
    this.contentElement = contentElement;
    this.callbacks = {};
    this.targetKey = "";
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
      return;
    }
    const item =
      target.type === "node"
        ? graph.nodes.find((node) => node.id === target.id)
        : graph.edges.find((edge) => edge.id === target.id);
    if (!item) return this.render(null, graph);

    this.targetKey = targetKey(target);
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
    const body = this.contentElement.querySelector("[data-source-preview-body]");
    if (!body) return;

    const meta = document.createElement("div");
    meta.className = "source-preview-meta";
    meta.textContent = `${preview.path}:${preview.focusLine}`;
    const code = document.createElement("div");
    code.className = "source-preview-code";
    for (const line of preview.lines) {
      const row = document.createElement("div");
      row.className = `source-preview-line${line.focus ? " focus" : ""}`;
      const number = document.createElement("span");
      number.textContent = line.number;
      const content = document.createElement("code");
      content.textContent = line.text || " ";
      row.append(number, content);
      code.append(row);
    }
    body.replaceChildren(meta, code);
  }

  renderSourcePreviewError(target, message) {
    if (this.targetKey !== targetKey(target)) return;
    const body = this.contentElement.querySelector("[data-source-preview-body]");
    if (!body) return;
    const notice = document.createElement("div");
    notice.className = "source-preview-error";
    notice.textContent = message;
    body.replaceChildren(notice);
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
    ${sourcePreviewTemplate()}
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
  const sourcePreview = callSite.available ? sourcePreviewTemplate() : "";
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
        <div class="confidence-track"><i style="width:${percent}%"></i></div>
        <span>${percent}%</span>
      </div>
    </section>
    ${sourcePreview}
    ${openAction}`;
}

function sourcePreviewTemplate() {
  return `
    <section class="inspect-section source-preview">
      <h3>INLINE SOURCE · ← / → 保持网页焦点</h3>
      <div class="source-preview-body" data-source-preview-body>
        <span class="source-preview-loading">正在读取源码上下文…</span>
      </div>
    </section>`;
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
