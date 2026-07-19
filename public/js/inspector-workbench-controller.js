const STORAGE_KEY = "callgraph_inspector_workbench_v1";

/**
 * Owns only workbench presentation state. Detail/source rendering and panel
 * width calculation stay in their respective modules.
 */
export class InspectorWorkbenchController {
  constructor({
    root,
    panel,
    resizablePanel,
    detailsTab,
    sourceTab,
    detailsPane,
    sourcePane,
    focusButton,
    collapseButton,
    onLayoutChange,
  }) {
    this.root = root;
    this.panel = panel;
    this.resizablePanel = resizablePanel;
    this.tabs = { details: detailsTab, source: sourceTab };
    this.panes = { details: detailsPane, source: sourcePane };
    this.focusButton = focusButton;
    this.collapseButton = collapseButton;
    this.onLayoutChange = onLayoutChange;
    this.preferredPane = "source";
    this.activePane = "source";
    this.sourceAvailable = false;
    this.collapsed = false;
    this.bind();
  }

  initialize() {
    const stored = readStoredState();
    if (stored?.preferredPane === "details" || stored?.preferredPane === "source") {
      this.preferredPane = stored.preferredPane;
    }
    this.resizablePanel.initialize();
    this.setCollapsed(Boolean(stored?.collapsed), false);
    this.applyPane();
  }

  setSourceAvailable(available) {
    this.sourceAvailable = Boolean(available);
    if (!this.sourceAvailable) this.clearFocus();
    this.tabs.source.disabled = !this.sourceAvailable;
    this.tabs.source.title = this.sourceAvailable
      ? "查看安全源码预览"
      : "当前目标没有可预览的精确源码位置";
    this.applyPane();
  }

  showPane(pane, persist = true) {
    if (!this.panes[pane] || (pane === "source" && !this.sourceAvailable)) return;
    if (pane !== "source") this.clearFocus();
    this.preferredPane = pane;
    this.applyPane();
    if (persist) this.persist();
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

  applyPane() {
    this.activePane =
      this.preferredPane === "source" && this.sourceAvailable ? "source" : "details";
    for (const pane of ["details", "source"]) {
      const active = pane === this.activePane;
      this.tabs[pane].classList.toggle("active", active);
      this.tabs[pane].setAttribute("aria-selected", String(active));
      this.panes[pane].hidden = !active;
    }
    this.focusButton.hidden = this.activePane !== "source";
  }

  persist() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        preferredPane: this.preferredPane,
        collapsed: this.collapsed,
      }),
    );
  }

  bind() {
    this.tabs.details.addEventListener("click", () => this.showPane("details"));
    this.tabs.source.addEventListener("click", () => this.showPane("source"));
    for (const tab of Object.values(this.tabs)) {
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const pane =
          event.key === "ArrowLeft" || event.key === "Home" ? "details" : "source";
        if (pane === "source" && !this.sourceAvailable) return;
        this.showPane(pane);
        this.tabs[pane].focus();
      });
    }
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
