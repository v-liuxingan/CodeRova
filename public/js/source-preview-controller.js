import { isSourceTargetAvailable } from "./click-navigation-policy.js";

export class SourcePreviewController {
  constructor(api, inspector) {
    this.api = api;
    this.inspector = inspector;
    this.cache = new Map();
    this.requestVersion = 0;
  }

  async show(graphSlug, graph, target) {
    const version = ++this.requestVersion;
    if (!graphSlug || !isSourceTargetAvailable(graph, target)) return;

    const key = `${graphSlug}:${target.type}:${target.id}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.inspector.renderSourcePreview(target, cached);
      return;
    }

    try {
      const preview = await this.api.previewSource(graphSlug, target.type, target.id);
      this.cache.set(key, preview);
      if (version === this.requestVersion) {
        this.inspector.renderSourcePreview(target, preview);
      }
    } catch (error) {
      if (version === this.requestVersion) {
        this.inspector.renderSourcePreviewError(target, error.message);
      }
    }
  }
}
