import { syntaxHighlighters } from "./syntax-highlighter.js";

const CONTEXT_OPTIONS = [
  { lines: 4, label: "速览" },
  { lines: 12, label: "标准" },
  { lines: 24, label: "展开" },
];

export class SourcePreviewView {
  constructor() {
    this.searchIndex = -1;
    this.searchRows = [];
  }

  render(container, preview, callbacks = {}) {
    this.searchIndex = -1;
    this.searchRows = [];

    const shell = document.createElement("div");
    shell.className = "source-workbench";
    shell.append(
      this.buildHeader(preview, callbacks),
      this.buildTools(preview, callbacks),
      this.buildCode(preview),
    );
    container.replaceChildren(shell);
    requestAnimationFrame(() => {
      revealRow(shell.querySelector(".source-preview-line.focus"));
    });
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
    const copy = document.createElement("button");
    copy.className = "source-mini-action";
    copy.type = "button";
    copy.textContent = "复制位置";
    copy.addEventListener("click", async () => {
      try {
        await copyText(`${preview.path}:${preview.focusLine}`);
        callbacks.onNotice?.("已复制源码位置");
      } catch (error) {
        callbacks.onNotice?.(error.message, true);
      }
    });
    const expand = document.createElement("button");
    expand.className = "source-mini-action";
    expand.type = "button";
    expand.dataset.previewExpand = "";
    expand.setAttribute("aria-pressed", String(Boolean(callbacks.expanded)));
    expand.textContent = callbacks.expanded ? "收起" : "放大";
    expand.addEventListener("click", () => {
      const expanded = Boolean(callbacks.onToggleExpand?.());
      expand.setAttribute("aria-pressed", String(expanded));
      expand.textContent = expanded ? "收起" : "放大";
    });
    actions.append(copy, expand);

    const stats = document.createElement("div");
    stats.className = "source-preview-stats";
    const range =
      preview.focusEndLine > preview.focusLine
        ? `${preview.focusLine}–${preview.focusEndLine}`
        : String(preview.focusLine);
    stats.textContent =
      `${preview.language.toUpperCase()} · 目标 ${range} · ${preview.totalLines} 行 · ${formatBytes(preview.fileSizeBytes)}`;
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
    input.placeholder = "在预览中查找";
    input.autocomplete = "off";
    const count = document.createElement("span");
    count.textContent = "0/0";
    input.addEventListener("input", () => {
      this.updateSearch(tools.closest(".source-workbench") || tools, input.value, count, 0);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.stepSearch(count, event.shiftKey ? -1 : 1);
    });
    search.append(input, count);
    tools.append(density, search);
    return tools;
  }

  buildCode(preview) {
    const code = document.createElement("div");
    code.className = "source-preview-code";
    code.tabIndex = 0;
    code.setAttribute("aria-label", `${preview.path} 源码预览`);

    if (preview.truncatedBefore) code.append(ellipsisRow(`前文已收起，当前从第 ${preview.startLine} 行开始`));
    for (const line of preview.lines) {
      const row = document.createElement("div");
      row.className = `source-preview-line${line.focus ? " focus" : ""}`;
      row.dataset.sourceText = line.text;

      const number = document.createElement("span");
      number.textContent = line.number;
      const content = document.createElement("code");
      syntaxHighlighters.append(content, line.text || " ", preview.language);
      if (line.truncated) {
        const mark = document.createElement("span");
        mark.className = "line-truncated";
        mark.textContent = " … [该行已截断]";
        content.append(mark);
      }
      row.append(number, content);
      code.append(row);
    }
    if (preview.truncatedAfter) {
      const reason = preview.focusRangeTruncated
        ? "目标范围较大，剩余内容已按安全上限收起"
        : `后文已收起，文件共 ${preview.totalLines} 行`;
      code.append(ellipsisRow(reason));
    }
    return code;
  }

  updateSearch(container, query, count, direction) {
    for (const row of container.querySelectorAll(".source-preview-line")) {
      row.classList.remove("search-match", "search-current");
    }
    const normalized = query.trim().toLocaleLowerCase();
    this.searchRows = normalized
      ? [...container.querySelectorAll(".source-preview-line")].filter((row) =>
          row.dataset.sourceText.toLocaleLowerCase().includes(normalized))
      : [];
    this.searchIndex = this.searchRows.length ? Math.max(0, direction) : -1;
    for (const row of this.searchRows) row.classList.add("search-match");
    this.showSearchResult(count);
  }

  stepSearch(count, direction) {
    if (!this.searchRows.length) return;
    this.searchIndex =
      (this.searchIndex + direction + this.searchRows.length) % this.searchRows.length;
    this.showSearchResult(count);
  }

  showSearchResult(count) {
    for (const row of this.searchRows) row.classList.remove("search-current");
    const current = this.searchRows[this.searchIndex];
    current?.classList.add("search-current");
    revealRow(current);
    count.textContent = this.searchRows.length
      ? `${this.searchIndex + 1}/${this.searchRows.length}`
      : "0/0";
  }
}

function ellipsisRow(message) {
  const row = document.createElement("div");
  row.className = "source-preview-ellipsis";
  row.textContent = message;
  return row;
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

function revealRow(row) {
  if (!row) return;
  const scroller = row.closest(".source-preview-code");
  if (!scroller) return;
  const rowRect = row.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const rowTop = rowRect.top - scrollerRect.top + scroller.scrollTop;
  scroller.scrollTo({
    top: Math.max(0, rowTop - scroller.clientHeight / 2 + rowRect.height / 2),
    left: 0,
  });
}
