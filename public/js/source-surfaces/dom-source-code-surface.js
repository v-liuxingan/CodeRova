import { syntaxHighlighters } from "../syntax-highlighter.js";

export class DomSourceCodeSurface {
  constructor() {
    this.container = null;
    this.searchIndex = -1;
    this.searchRows = [];
    this.fontLevel = 0;
  }

  get name() {
    return "DOM FALLBACK";
  }

  get capabilities() {
    return { folding: false, wrapping: true, fontSize: true };
  }

  mount(container, preview) {
    this.container = container;
    container.dataset.startLine = String(preview.startLine);
    container.dataset.focusLine = String(preview.focusLine);
    container.dataset.focusEndLine = String(preview.focusEndLine);
    container.dataset.readOnly = "true";
    const code = document.createElement("div");
    code.className = "source-preview-code";
    code.tabIndex = 0;
    code.setAttribute("aria-label", `${preview.path} 源码预览`);

    if (preview.truncatedBefore) {
      code.append(ellipsisRow(`前文已收起，当前从第 ${preview.startLine} 行开始`));
    }
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
    container.replaceChildren(code);
    requestAnimationFrame(() => revealRow(code.querySelector(".source-preview-line.focus")));
  }

  search(query, direction = 0) {
    if (!this.container) return { current: 0, total: 0 };
    for (const row of this.container.querySelectorAll(".source-preview-line")) {
      row.classList.remove("search-match", "search-current");
    }
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      this.searchRows = [];
      this.searchIndex = -1;
      return { current: 0, total: 0 };
    }
    const nextRows = [...this.container.querySelectorAll(".source-preview-line")].filter((row) =>
      row.dataset.sourceText.toLocaleLowerCase().includes(normalized));
    if (!sameRows(this.searchRows, nextRows)) {
      this.searchRows = nextRows;
      this.searchIndex = this.searchRows.length ? 0 : -1;
    } else if (this.searchRows.length && direction) {
      this.searchIndex =
        (this.searchIndex + direction + this.searchRows.length) % this.searchRows.length;
    }
    for (const row of this.searchRows) row.classList.add("search-match");
    const current = this.searchRows[this.searchIndex];
    current?.classList.add("search-current");
    revealRow(current);
    return {
      current: this.searchRows.length ? this.searchIndex + 1 : 0,
      total: this.searchRows.length,
    };
  }

  async run(action) {
    if (action === "toggleWrap") {
      const code = this.container?.querySelector(".source-preview-code");
      const wrapped = code?.classList.toggle("wrapped") || false;
      return { active: wrapped };
    }
    if (action === "fontSmaller" || action === "fontLarger") {
      const code = this.container?.querySelector(".source-preview-code");
      if (!code) return {};
      this.fontLevel = Math.max(
        -1,
        Math.min(1, this.fontLevel + (action === "fontLarger" ? 1 : -1)),
      );
      code.classList.toggle("source-font-small", this.fontLevel < 0);
      code.classList.toggle("source-font-large", this.fontLevel > 0);
      return {};
    }
    return {};
  }

  dispose() {
    this.container = null;
    this.searchRows = [];
  }
}

function ellipsisRow(message) {
  const row = document.createElement("div");
  row.className = "source-preview-ellipsis";
  row.textContent = message;
  return row;
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

function sameRows(left, right) {
  return left.length === right.length && left.every((row, index) => row === right[index]);
}
