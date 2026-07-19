export class LayoutPersistenceController {
  constructor(api, callbacks = {}) {
    this.api = api;
    this.callbacks = callbacks;
    this.pending = null;
    this.timer = null;
    this.saving = null;
  }

  schedule(graphSlug, layout) {
    this.pending = { graphSlug, layout: structuredClone(layout) };
    window.clearTimeout(this.timer);
    this.callbacks.onStatus?.("布局已修改，等待保存");
    this.timer = window.setTimeout(() => void this.flush(), 350);
  }

  async flush() {
    window.clearTimeout(this.timer);
    this.timer = null;
    if (this.saving) await this.saving;
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;

    this.callbacks.onStatus?.("正在保存节点布局");
    this.saving = this.api
      .saveLayout(pending.graphSlug, pending.layout)
      .then(() => this.callbacks.onStatus?.("节点布局已保存"))
      .catch((error) => this.callbacks.onError?.(error.message))
      .finally(() => {
        this.saving = null;
      });
    await this.saving;
    if (this.pending) await this.flush();
  }
}
