const READY_TIMEOUT_MS = 8_000;

export class MonacoSourceCodeSurface {
  constructor() {
    this.frame = null;
    this.host = null;
    this.pending = new Map();
    this.requestSequence = 0;
    this.ready = null;
    this.onMessage = this.handleMessage.bind(this);
  }

  get name() {
    return "MONACO · READ ONLY";
  }

  get capabilities() {
    return { folding: true, wrapping: true, fontSize: true };
  }

  async mount(container, preview) {
    this.host = container;
    container.dataset.startLine = String(preview.startLine);
    container.dataset.focusLine = String(preview.focusLine);
    container.dataset.focusEndLine = String(preview.focusEndLine);
    container.dataset.readOnly = "true";

    const frame = document.createElement("iframe");
    frame.className = "monaco-source-frame";
    frame.title = `${preview.path} 只读源码预览`;
    frame.src = "/monaco-preview.html";
    frame.referrerPolicy = "no-referrer";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    container.replaceChildren(frame);
    this.frame = frame;
    window.addEventListener("message", this.onMessage);

    this.ready = waitForFrameReady(this);
    await this.ready;
    await this.request("mount", {
      preview,
      theme: document.documentElement.dataset.theme || "halo",
    });
  }

  search(query, direction = 0) {
    if (!this.frame) return { current: 0, total: 0 };
    void this.request("search", { query, direction })
      .then((result) => {
        this.host?.dispatchEvent(
          new CustomEvent("source-search-result", { detail: result }),
        );
      })
      .catch(() => {});
    return { current: 0, total: 0 };
  }

  async run(action) {
    if (!this.frame) return {};
    return this.request("action", { action });
  }

  request(type, payload = {}) {
    if (!this.frame?.contentWindow) {
      return Promise.reject(new Error("Monaco 预览框架不可用"));
    }
    const requestId = `monaco-${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Monaco ${type} 请求超时`));
      }, READY_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timeout });
      this.frame.contentWindow.postMessage(
        { channel: "callgraph-monaco", type, requestId, ...payload },
        window.location.origin,
      );
    });
  }

  handleMessage(event) {
    if (
      event.origin !== window.location.origin
      || event.source !== this.frame?.contentWindow
      || event.data?.channel !== "callgraph-monaco"
    ) {
      return;
    }
    if (event.data.type === "ready") {
      this.host?.dispatchEvent(new CustomEvent("monaco-frame-ready"));
      return;
    }
    const pending = this.pending.get(event.data.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    this.pending.delete(event.data.requestId);
    if (event.data.ok) pending.resolve(event.data.result || {});
    else pending.reject(new Error(event.data.error || "Monaco 预览请求失败"));
  }

  dispose() {
    window.removeEventListener("message", this.onMessage);
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error("Monaco 预览已释放"));
    }
    this.pending.clear();
    this.frame?.remove();
    this.frame = null;
    this.host = null;
  }
}

function waitForFrameReady(surface) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      surface.host?.removeEventListener("monaco-frame-ready", onReady);
      reject(new Error("Monaco 隔离预览页装载超时"));
    }, READY_TIMEOUT_MS);
    const onReady = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    surface.host?.addEventListener("monaco-frame-ready", onReady, { once: true });
  });
}
