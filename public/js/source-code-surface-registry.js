import { DomSourceCodeSurface } from "./source-surfaces/dom-source-code-surface.js";
import { MonacoSourceCodeSurface } from "./source-surfaces/monaco-source-code-surface.js";

export class SourceCodeSurfaceRegistry {
  constructor() {
    this.factories = new Map();
  }

  register(name, factory) {
    this.factories.set(name, factory);
    return this;
  }

  create(name) {
    const factory = this.factories.get(name);
    if (!factory) throw new Error(`未知源码预览实现：${name}`);
    return factory();
  }
}

export const sourceCodeSurfaces = new SourceCodeSurfaceRegistry()
  .register("monaco", () => new MonacoSourceCodeSurface())
  .register("dom", () => new DomSourceCodeSurface());
