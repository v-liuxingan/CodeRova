const STORAGE_KEY = "callgraph_inspector_workbench_v1";

/**
 * Owns only workbench presentation state. Semantic/source rendering and panel
 * width calculation stay in their respective modules.
 */
export class InspectorWorkbenchController {
  constructor({
    root,
    panel,
    resizablePanel,
    focusButton,
    collapseButton,
    onLayoutChange,
  }) {
    this.root = root;
    this.panel = panel;
    this.resizablePanel = resizablePanel;
    this.focusButton = focusButton;
    this.collapseButton = collapseButton;
    this.onLayoutChange = onLayoutChange;
    this.collapsed = false;
    this.bind();
  }

  initialize() {
    const stored = readStoredState();
    this.resizablePanel.initialize();
    this.setCollapsed(Boolean(stored?.collapsed), false);
  }

  toggleFocus() {
    if (this.collapsed) this.setCollapsed(false);
    const expanded = this.resizablePanel.toggleExpanded();
    this.panel.classList.toggle("workbench-focused", expanded);
    this.focusButton.setAttribute("aria-pressed", String(expanded));
    this.focusButton.textContent = expanded ? "还原" : "宽屏";
    this.focusButton.title = expanded ? "恢复源码工作台宽度" : "扩展源码工作台";
    this.onLayoutChange?.();
    return expanded;
  }

  clearFocus() {
    const wasExpanded = this.resizablePanel.expanded;
    if (!wasExpanded && !this.panel.classList.contains("workbench-focused")) {
      return;
    }
    if (wasExpanded) this.resizablePanel.toggleExpanded();
    else this.resizablePanel.expanded = false;
    this.panel.classList.remove("workbench-focused");
    this.focusButton.setAttribute("aria-pressed", "false");
    this.focusButton.textContent = "宽屏";
    this.focusButton.title = "扩展源码工作台";
  }

  toggleCollapsed() {
    this.setCollapsed(!this.collapsed);
  }

  setCollapsed(collapsed, persist = true) {
    this.collapsed = Boolean(collapsed);
    this.root.classList.toggle("inspector-collapsed", this.collapsed);
    this.panel.classList.toggle("collapsed", this.collapsed);
    this.collapseButton.setAttribute("aria-expanded", String(!this.collapsed));
    this.collapseButton.title = this.collapsed ? "展开源码工作台" : "折叠源码工作台";
    this.collapseButton.querySelector(".action-label").textContent =
      this.collapsed ? "展开" : "折叠";
    if (this.collapsed) this.clearFocus();
    if (persist) this.persist();
    requestAnimationFrame(() => this.onLayoutChange?.());
  }

  handleManualResize() {
    this.clearFocus();
  }

  persist() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        collapsed: this.collapsed,
      }),
    );
  }

  bind() {
    this.focusButton.addEventListener("click", () => this.toggleFocus());
    this.collapseButton.addEventListener("click", () => this.toggleCollapsed());
  }
}

function readStoredState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}
