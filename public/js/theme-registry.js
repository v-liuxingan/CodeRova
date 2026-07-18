const STORAGE_KEY = "callgraph_theme";

export class ThemeRegistry {
  constructor(root = document.documentElement) {
    this.root = root;
    this.themes = new Map();
    this.listeners = new Set();
    this.activeId = null;
  }

  register(theme) {
    if (!theme?.id || !theme?.label) throw new Error("主题必须包含 id 和 label");
    this.themes.set(theme.id, Object.freeze({ colorScheme: "dark", ...theme }));
    return this;
  }

  initialize(defaultId) {
    const storedId = localStorage.getItem(STORAGE_KEY);
    this.apply(this.themes.has(storedId) ? storedId : defaultId, false);
    return this.activeId;
  }

  apply(id, persist = true) {
    const theme = this.themes.get(id);
    if (!theme) throw new Error(`未注册主题：${id}`);
    this.activeId = id;
    this.root.dataset.theme = id;
    this.root.style.colorScheme = theme.colorScheme;
    if (persist) localStorage.setItem(STORAGE_KEY, id);
    for (const listener of this.listeners) listener(theme);
  }

  list() {
    return [...this.themes.values()];
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const themes = new ThemeRegistry()
  .register({
    id: "aether",
    label: "Aether",
    description: "深空蓝 · 科技简约",
  })
  .register({
    id: "signal",
    label: "Signal",
    description: "荧光绿 · 原始主题",
  });
