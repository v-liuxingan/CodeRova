import { Minimap, ExtensionCategory, register } from '@antv/g6';
import { Rect } from '@antv/g';

// Keep G6's overview canvas and viewport mask, but use the complete logical
// window rather than the virtualized main canvas's mounted elements.
class WindowMinimap extends Minimap {
  renderMinimap() {
    if (this.disposed) return;
    const window = this.options.getWindow();
    if (!window) return;
    const theme = document.documentElement.dataset.theme;
    if (this.lastData === window.data && this.lastRevision === window.revision && this.lastTheme === theme) return;
    this.lastData = window.data; this.lastRevision = window.revision; this.lastTheme = theme;
    const nodes = window.data.nodes;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const n of nodes) {
      left = Math.min(left, n.style.x - 152); right = Math.max(right, n.style.x + 152);
      top = Math.min(top, n.style.y - n.data.height / 2); bottom = Math.max(bottom, n.style.y + n.data.height / 2);
    }
    this.bounds = nodes.length ? [left, top, right, bottom] : [0, 0, 304, 100];
    const canvas = this.initCanvas();
    canvas.removeChildren();
    const css = getComputedStyle(document.documentElement);
    const minimum = 1.5 / this.scale;
    for (const n of nodes) canvas.appendChild(new Rect({ style: {
      x: n.style.x - Math.max(304, minimum) / 2, y: n.style.y - Math.max(n.data.height, minimum) / 2,
      width: Math.max(304, minimum), height: Math.max(n.data.height, minimum),
      fill: css.getPropertyValue(`--card-${n.data.tone}-text`).trim(),
    } }));
    this.container.dataset.logicalNodes = String(nodes.length);
    this.container.setAttribute('aria-label', '调用图缩略图：点击或拖动定位，方向键移动视口');
    this.container.title = '全部已展开节点 · 点击或拖动定位';
    if (!this.bound) this.bindNavigation();
  }
  setCamera() {
    if (!this.canvas || !this.bounds) return;
    const [left, top, right, bottom] = this.bounds, [width, height] = this.options.size;
    const scale = Math.min((width - 20) / Math.max(1, right - left), (height - 20) / Math.max(1, bottom - top));
    this.scale = scale;
    const center = [(left + right) / 2, (top + bottom) / 2, 0];
    // The native cache would accumulate landmarks across every manual node move.
    const cameraKey = `${center}:${scale}`;
    if (this.cameraKey === cameraKey) return;
    this.cameraKey = cameraKey;
    this.landmarkMap.clear();
    this.canvas.getCamera().gotoLandmark(this.createLandmark(center, center, scale), 0);
  }
  bindNavigation() {
    this.bound = true;
    const host = this.container;
    host.tabIndex = 0;
    const locate = event => {
      const rect = host.getBoundingClientRect();
      this.pendingPoint = this.canvas.viewport2Canvas({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        if (this.disposed) return;
        const graph = this.context.graph, point = this.pendingPoint;
        const [left, top, right, bottom] = this.bounds;
        point.x = Math.max(left, Math.min(right, point.x));
        point.y = Math.max(top, Math.min(bottom, point.y));
        const position = graph.getViewportByCanvas([point.x, point.y]), [width, height] = graph.getSize();
        void graph.translateBy([width / 2 - position[0], height / 2 - position[1]], false);
      });
    };
    host.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      host.focus({ preventScroll: true }); host.setPointerCapture(event.pointerId);
      this.pointer = event.pointerId; locate(event);
    }, true);
    host.addEventListener('pointermove', event => { if (this.pointer === event.pointerId) { event.stopPropagation(); locate(event); } });
    const end = event => { if (this.pointer === event.pointerId) { this.pointer = null; if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId); } };
    host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end);
    host.addEventListener('keydown', event => {
      const delta = { ArrowLeft: [120, 0], ArrowRight: [-120, 0], ArrowUp: [0, 120], ArrowDown: [0, -120] }[event.key];
      if (delta) { event.preventDefault(); event.stopPropagation(); void this.context.graph.translateBy(delta, false); }
    });
    host.addEventListener('wheel', event => event.stopPropagation());
  }
  renderMask() { if (!this.disposed) super.renderMask(); }
  destroy() {
    this.disposed = true; cancelAnimationFrame(this.frame);
    this.onRender.cancel?.(); this.onTransform.cancel?.();
    super.destroy();
  }
}
register(ExtensionCategory.PLUGIN, 'window-minimap', WindowMinimap);
