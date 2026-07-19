import { sourceCodeSurfaces } from "./source-code-surface-registry.js";

const CONTEXT_OPTIONS = [
  { lines: 4, label: "速览" },
  { lines: 12, label: "标准" },
  { lines: 24, label: "展开" },
];

export class SourcePreviewView {
  constructor({ surfaces = sourceCodeSurfaces, preferredSurface = "monaco" } = {}) {
    this.surfaces = surfaces;
    this.preferredSurface = preferredSurface;
    this.surface = null;
    this.renderVersion = 0;
    this.searchQuery = "";
    this.searchCount = null;
    this.actionButtons = new Map();
    this.engineBadge = null;
  }

  render(container, preview, callbacks = {}) {
    const version = ++this.renderVersion;
    this.surface?.dispose();
    this.surface = null;
    this.searchQuery = "";
    this.actionButtons.clear();

    const shell = document.createElement("div");
    shell.className = "source-workbench";
    const editorHost = document.createElement("div");
    editorHost.className = "source-editor-host";
    editorHost.setAttribute("aria-busy", "true");
    editorHost.addEventListener("source-search-result", (event) => {
      const result = event.detail || { current: 0, total: 0 };
      if (this.searchCount) {
        this.searchCount.textContent = `${result.current}/${result.total}`;
      }
    });
    const loading = document.createElement("span");
    loading.className = "source-preview-loading";
    loading.textContent = "正在装载本地只读编辑器…";
    editorHost.append(loading);
    shell.append(
      this.buildHeader(preview, callbacks),
      this.buildTools(preview, callbacks),
      editorHost,
    );
    container.replaceChildren(shell);
    void this.mountSurface(editorHost, preview, callbacks, version);
  }

  buildHeader(preview, callbacks) {
    const header = document.createElement("header");
    header.className = "source-preview-header";

    const path = document.createElement("div");
    path.className = "source-preview-path";
    path.title = preview.path;
    path.textContent = preview.path;

    const actions = document.createElement("div");
    actions.className = "source-preview-header-actions";
    this.engineBadge = document.createElement("span");
    this.engineBadge.className = "source-engine-badge";
    this.engineBadge.textContent = "EDITOR";
    const copy = actionButton("复制位置", "复制源码位置");
    copy.addEventListener("click", async () => {
      try {
        await copyText(`${preview.path}:${preview.focusLine}`);
        callbacks.onNotice?.("已复制源码位置");
      } catch (error) {
        callbacks.onNotice?.(error.message, true);
      }
    });
    actions.append(this.engineBadge, copy);

    const stats = document.createElement("div");
    stats.className = "source-preview-stats";
    const range =
      preview.focusEndLine > preview.focusLine
        ? `${preview.focusLine}–${preview.focusEndLine}`
        : String(preview.focusLine);
    const limited = preview.truncatedBefore || preview.truncatedAfter ? " · 上下文受限" : "";
    stats.textContent =
      `${preview.language.toUpperCase()} · 目标 ${range} · ${preview.totalLines} 行 · `
      + `${formatBytes(preview.fileSizeBytes)}${limited}`;
    header.append(path, actions, stats);
    return header;
  }

  buildTools(preview, callbacks) {
    const tools = document.createElement("div");
    tools.className = "source-preview-tools";

    const density = document.createElement("div");
    density.className = "source-density";
    density.setAttribute("aria-label", "源码上下文范围");
    for (const option of CONTEXT_OPTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option.label;
      button.title = `目标范围前后各 ${option.lines} 行`;
      button.classList.toggle("active", preview.contextLines === option.lines);
      button.addEventListener("click", () => callbacks.onContextChange?.(option.lines));
      density.append(button);
    }

    const search = document.createElement("label");
    search.className = "source-find";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "查找 · Enter 下一个";
    input.autocomplete = "off";
    this.searchCount = document.createElement("span");
    this.searchCount.textContent = "0/0";
    input.addEventListener("input", () => {
      this.searchQuery = input.value;
      this.updateSearch(0);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.updateSearch(event.shiftKey ? -1 : 1);
    });
    search.append(input, this.searchCount);

    const actions = document.createElement("div");
    actions.className = "source-editor-actions";
    for (const [action, label, title] of [
      ["foldAll", "折叠", "折叠全部代码块"],
      ["unfoldAll", "展开", "展开全部代码块"],
      ["toggleWrap", "换行", "切换自动换行"],
      ["fontSmaller", "A−", "缩小代码字体"],
      ["fontLarger", "A+", "放大代码字体"],
    ]) {
      const button = actionButton(label, title);
      button.disabled = true;
      button.dataset.editorAction = action;
      button.addEventListener("click", async () => {
        const result = await this.surface?.run(action);
        if (action === "toggleWrap") {
          button.classList.toggle("active", Boolean(result?.active));
          button.setAttribute("aria-pressed", String(Boolean(result?.active)));
        }
      });
      this.actionButtons.set(action, button);
      actions.append(button);
    }
    tools.append(density, search, actions);
    return tools;
  }

  async mountSurface(host, preview, callbacks, version) {
    let surface = this.surfaces.create(this.preferredSurface);
    try {
      await surface.mount(host, preview);
    } catch (error) {
      surface.dispose();
      if (version !== this.renderVersion) return;
      surface = this.surfaces.create("dom");
      surface.mount(host, preview);
      callbacks.onNotice?.(`Monaco 装载失败，已使用安全 DOM 预览：${error.message}`, true);
    }
    if (version !== this.renderVersion) {
      surface.dispose();
      return;
    }
    this.surface = surface;
    host.dataset.sourceSurface = surface.name.startsWith("MONACO") ? "monaco" : "dom";
    host.setAttribute("aria-busy", "false");
    this.engineBadge.textContent = surface.name;
    const capabilities = surface.capabilities;
    for (const [action, button] of this.actionButtons) {
      button.disabled =
        (action === "foldAll" || action === "unfoldAll") && !capabilities.folding
        || action === "toggleWrap" && !capabilities.wrapping
        || (action === "fontSmaller" || action === "fontLarger") && !capabilities.fontSize;
    }
    if (this.searchQuery) this.updateSearch(0);
  }

  updateSearch(direction) {
    const result = this.surface?.search(this.searchQuery, direction) || { current: 0, total: 0 };
    if (this.searchCount) this.searchCount.textContent = `${result.current}/${result.total}`;
  }
}

function actionButton(label, title) {
  const button = document.createElement("button");
  button.className = "source-mini-action";
  button.type = "button";
  button.textContent = label;
  button.title = title;
  return button;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function copyText(text) {
  if (!navigator.clipboard?.writeText) throw new Error("当前浏览器不支持安全剪贴板");
  await navigator.clipboard.writeText(text);
}
