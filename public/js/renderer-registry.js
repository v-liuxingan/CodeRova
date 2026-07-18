/**
 * Small renderer plugin registry.
 *
 * New implementations (Canvas, WebGL, DOM tree) only need to expose the same
 * render / fit / zoomBy / setCallbacks contract as SvgRenderer.
 */
export class RendererRegistry {
  constructor() {
    this.factories = new Map();
  }

  register(name, factory) {
    this.factories.set(name, factory);
    return this;
  }

  create(name, context) {
    const factory = this.factories.get(name);
    if (!factory) throw new Error(`未知渲染器：${name}`);
    return factory(context);
  }
}
