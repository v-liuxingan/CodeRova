import { isSourceTargetAvailable } from "./click-navigation-policy.js";

export class SourcePreviewController {
  constructor(api, inspector) {
    this.api = api;
    this.inspector = inspector;
    this.cache = new Map();
    this.contextLines = 12;
    this.current = null;
    this.abortController = null;
    this.requestVersion = 0;
  }

  async show(graphSlug, graph, target) {
    this.current = { graphSlug, graph, target };
    const version = ++this.requestVersion;
    this.abortController?.abort();
    this.abortController = null;
    if (!graphSlug || !isSourceTargetAvailable(graph, target)) return;

    const key = this.cacheKey(graphSlug, target);
    const cached = this.cache.get(key);
    if (cached) {
      this.inspector.renderSourcePreview(target, cached);
      return;
    }

    const abortController = new AbortController();
    this.abortController = abortController;
    try {
      const preview = await this.api.previewSource(
        graphSlug,
        target.type,
        target.id,
        this.contextLines,
        abortController.signal,
      );
      this.remember(key, preview);
      if (version === this.requestVersion) {
        this.inspector.renderSourcePreview(target, preview);
      }
    } catch (error) {
      if (error.name !== "AbortError" && version === this.requestVersion) {
        this.inspector.renderSourcePreviewError(target, error.message);
      }
    }
  }

  setContextLines(contextLines) {
    if (this.contextLines === contextLines || ![4, 12, 24].includes(contextLines)) return;
    this.contextLines = contextLines;
    const current = this.current;
    if (!current?.target) return;
    this.inspector.renderSourcePreviewLoading(current.target);
    void this.show(current.graphSlug, current.graph, current.target);
  }

  async prefetch(graphSlug, graph, target) {
    if (!graphSlug || !isSourceTargetAvailable(graph, target)) return;
    const key = this.cacheKey(graphSlug, target);
    if (this.cache.has(key)) return;
    try {
      const preview = await this.api.previewSource(
        graphSlug,
        target.type,
        target.id,
        this.contextLines,
      );
      this.remember(key, preview);
    } catch {
      // Prefetch is opportunistic; foreground loading will report useful errors.
    }
  }

  cacheKey(graphSlug, target) {
    return `${graphSlug}:${target.type}:${target.id}:${this.contextLines}`;
  }

  remember(key, preview) {
    this.cache.delete(key);
    this.cache.set(key, preview);
    if (this.cache.size > 120) {
      this.cache.delete(this.cache.keys().next().value);
    }
  }
}
