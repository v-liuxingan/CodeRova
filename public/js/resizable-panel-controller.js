const WIDTHS = [320, 360, 400, 440, 480, 520, 560, 600, 640, 680, 720, 760, 800];
const STORAGE_KEY = "callgraph_inspector_width_v1";

export class ResizablePanelController {
  constructor(root, handle, callbacks = {}) {
    this.root = root;
    this.handle = handle;
    this.callbacks = callbacks;
    this.width = 440;
    this.widthBeforeExpand = this.width;
    this.expanded = false;
    this.drag = null;
    this.bind();
  }

  initialize() {
    const storedValue = localStorage.getItem(STORAGE_KEY);
    const stored = storedValue === null ? Number.NaN : Number(storedValue);
    this.apply(Number.isFinite(stored) ? stored : this.width, false);
    return this.width;
  }

  toggleExpanded() {
    if (this.expanded) {
      this.expanded = false;
      this.apply(this.widthBeforeExpand);
      return false;
    }
    this.widthBeforeExpand = this.width;
    this.expanded = true;
    this.apply(this.maximumWidth());
    return true;
  }

  bind() {
    this.handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.drag = { pointerId: event.pointerId, startX: event.clientX, width: this.width };
      this.handle.setPointerCapture(event.pointerId);
      this.handle.classList.add("active");
      document.body.classList.add("resizing-inspector");
    });
    this.handle.addEventListener("pointermove", (event) => {
      if (!this.drag) return;
      this.expanded = false;
      this.callbacks.onManualResize?.();
      this.apply(this.drag.width + this.drag.startX - event.clientX, false);
    });
    const finish = () => {
      if (!this.drag) return;
      this.drag = null;
      this.handle.classList.remove("active");
      document.body.classList.remove("resizing-inspector");
      localStorage.setItem(STORAGE_KEY, String(this.width));
    };
    this.handle.addEventListener("pointerup", finish);
    this.handle.addEventListener("pointercancel", finish);
    this.handle.addEventListener("dblclick", () => {
      this.expanded = false;
      this.callbacks.onManualResize?.();
      this.apply(440);
    });
    this.handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
      event.preventDefault();
      this.expanded = false;
      this.callbacks.onManualResize?.();
      const next =
        event.key === "Home"
          ? 440
          : this.width + (event.key === "ArrowLeft" ? 40 : -40);
      this.apply(next);
    });
    window.addEventListener("resize", () => this.apply(this.width, false));
  }

  apply(requestedWidth, persist = true) {
    const max = this.maximumWidth();
    const available = WIDTHS.filter((width) => width <= max);
    const candidates = available.length ? available : [Math.max(280, max)];
    this.width = candidates.reduce((closest, width) =>
      Math.abs(width - requestedWidth) < Math.abs(closest - requestedWidth) ? width : closest);
    for (const width of WIDTHS) {
      this.root.classList.toggle(`inspector-width-${width}`, width === this.width);
    }
    this.handle.setAttribute("aria-valuenow", String(this.width));
    this.handle.title = `拖动调整源码侧栏宽度 · 当前 ${this.width}px · 双击复位`;
    if (persist) localStorage.setItem(STORAGE_KEY, String(this.width));
    this.callbacks.onResize?.(this.width);
  }

  maximumWidth() {
    const rail = Number.parseFloat(getComputedStyle(this.root).getPropertyValue("--rail")) || 0;
    return Math.max(320, window.innerWidth - rail - 460);
  }
}
