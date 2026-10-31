import { SceneReader } from "./scene-reader.js";
import { groupGraphCatalog } from "./catalog-grouping.js";

const idPattern = /^[A-Za-z0-9_-]+$/;
export function selectProject(projects, graphs, params) {
  const requestedGraph = graphs.find((graph) => graph.slug === params.get("graph"));
  return requestedGraph?.projectId
    || [params.get("project")].find((id) => projects.some((project) => project.id === id))
    || groupGraphCatalog(graphs)[0]?.graphs[0]?.projectId || projects[0]?.id || null;
}

export function validateSceneCatalog(data) {
  if (data?.schemaVersion !== "1.0" || !Array.isArray(data.scenes)) throw new Error("场景目录格式无效");
  const slugs = new Set();
  for (const item of data.scenes) {
    if (!item || typeof item.slug !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(item.slug) || slugs.has(item.slug)
      || (item.projectId !== null && (typeof item.projectId !== "string" || !idPattern.test(item.projectId)))
      || (item.callgraph !== null && (typeof item.callgraph !== "string" || !idPattern.test(item.callgraph)))
      || [item.title, item.summary, item.projectLabel].some((text) => typeof text !== "string" || !text.trim())) {
      throw new Error("场景目录包含无效或重复条目");
    }
    slugs.add(item.slug);
  }
  return data.scenes;
}

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const link = (title, href, className) => {
  const element = node("a", className, title);
  element.href = href;
  return element;
};

export class ProjectNavigation {
  constructor(api, beforeNavigate = async () => {}, callbacks = {}) {
    this.api = api;
    this.beforeNavigate = beforeNavigate;
    this.callbacks = callbacks;
    this.reader = new SceneReader(document.querySelector("#scene-content"));
    this.routeVersion = 0;
    this.readingPositions = new Map();
    this.view = "home";
    this.historyIndex = history.state?.workspaceIndex || 0;
    this.currentHref = location.href;
    history.replaceState({ workspaceIndex: this.historyIndex }, "", location.href);
    window.addEventListener("popstate", (event) => {
      if (this.restoringHistory) { this.restoringHistory = false; return; }
      void this.navigate(location.href, "pop", event.state?.workspaceIndex || 0);
    });
    this.scenes = null;
    this.activeGraph = null;
    this.projectExpanded = new Map();
    this.status = document.querySelector("#project-scenes-status");
    document.querySelectorAll("[data-scene-retry]").forEach((button) => {
      button.addEventListener("click", () => this.loadScenes());
    });
    // Ordinary links remain usable in new tabs; same-tab departures save pending layout edits.
    document.addEventListener("click", async (event) => {
      const anchor = event.target.closest("a[data-catalog-link]");
      if (!anchor || event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      void this.navigate(anchor.href);
    });
  }

  initialize(health, graphs) {
    const projects = new Map(health.projects.map((project) => [project.id, { id: project.id, name: project.name || project.id }]));
    for (const graph of graphs) if (!projects.has(graph.projectId)) projects.set(graph.projectId, { id: graph.projectId, name: graph.projectId });
    const order = [...new Set(groupGraphCatalog(graphs).flatMap((group) => group.graphs.map((graph) => graph.projectId)))];
    this.projects = [...projects.values()].sort((a, b) => {
      const rank = (id) => order.includes(id) ? order.indexOf(id) : order.length;
      return rank(a.id) - rank(b.id);
    });
    this.graphs = graphs;
    // Project context locates content; it never filters the directory or restores a hidden filter.
    this.projectId = selectProject(this.projects, graphs, new URL(location.href).searchParams);
    this.renderProjects(graphs);
    this.scenesReady = this.loadScenes();
    return this.projectId;
  }

  notice(message, retry) {
    document.querySelectorAll("[data-scene-status]").forEach((element) => { element.textContent = message; });
    document.querySelectorAll("[data-scene-retry]").forEach((element) => { element.hidden = !retry; });
  }

  renderProjects(graphs) {
    this.graphs = graphs;
    const directory = document.querySelector("#graph-list");
    directory.replaceChildren();
    this.graphHosts = new Map();
    for (const [index, project] of this.projects.entries()) {
      const section = node("details", "catalog-project");
      section.dataset.projectId = project.id;
      section.open = this.projectExpanded.get(project.id) ?? project.id === this.projectId;
      section.classList.toggle("current-project", project.id === this.activeGraph?.projectId);
      const heading = node("summary", "catalog-project-heading");
      const title = node("h3", "catalog-project-title", project.name);
      heading.append(node("span", "catalog-project-label", `项目 ${String(index + 1).padStart(2, "0")}`), title, node("span", "catalog-project-meta"));
      section.append(heading);
      section.addEventListener("toggle", () => {
        this.projectExpanded.set(project.id, section.open);
        if (section.open) {
          for (const other of directory.querySelectorAll(".catalog-project")) if (other !== section) other.open = false;
        }
      });
      const scenes = node("div", "catalog-project-scenes");
      scenes.dataset.projectId = project.id;
      const host = node("div", "catalog-project-graphs");
      this.graphHosts.set(project.id, host);
      const body = node("div", "catalog-project-body");
      body.append(node("h4", "catalog-type", "场景地图"), scenes, node("h4", "catalog-type", "调用图"), host);
      section.append(body);
      directory.append(section);
    }
    this.renderScenes();
  }

  graphHost(id) { return this.graphHosts.get(id); }

  async loadScenes() {
    this.notice("正在读取场景目录…", false);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      this.scenes = validateSceneCatalog(await this.api.listSceneCatalog(controller.signal));
      this.renderScenes();
      this.notice(`${this.scenes.length} 张场景 · 目录已同步`, false);
    } catch {
      this.notice("场景目录暂不可用；所有调用图仍可阅读。", true);
      document.querySelectorAll(".scene-placeholder").forEach((element) => { element.textContent = "场景目录暂不可用"; });
    } finally { clearTimeout(timeout); }
  }

  setGraph(graph) {
    this.activeGraph = graph;
    this.projectId = graph.projectId;
    this.view = "graph";
    this.showView("graph");
    document.querySelectorAll(".catalog-project").forEach((section) => {
      section.classList.toggle("current-project", section.dataset.projectId === graph.projectId);
      section.open = section.dataset.projectId === graph.projectId;
    });
    this.renderScenes();
  }

  sceneLinks(host, scenes) {
    host.replaceChildren();
    if (!this.scenes || !scenes.length) {
      host.append(node("p", "catalog-notice scene-placeholder", this.scenes ? "暂无场景地图" : "正在读取场景…"));
    }
    for (const scene of scenes) {
      const anchor = link(scene.title, `/?scene=${scene.slug}`, "project-scene-link");
      anchor.title = scene.summary;
      anchor.dataset.catalogLink = "";
      anchor.classList.toggle("related", this.view === "graph" && scene.callgraph === this.activeGraph?.slug);
      if (this.view === "scene" && scene.slug === this.currentScene?.slug) anchor.setAttribute("aria-current", "page");
      host.append(anchor);
    }
  }

  renderScenes() {
    const scenes = this.scenes || [];
    document.querySelectorAll(".catalog-project").forEach((section) => {
      const graphCount = this.graphs.filter((graph) => graph.projectId === section.dataset.projectId).length;
      const sceneCount = this.scenes ? scenes.filter((scene) => scene.projectId === section.dataset.projectId).length : "…";
      section.querySelector(".catalog-project-meta").textContent = `${sceneCount} 张场景 · ${graphCount} 张调用图`;
    });
    document.querySelectorAll(".catalog-project-scenes").forEach((host) => {
      this.sceneLinks(host, scenes.filter((scene) => scene.projectId === host.dataset.projectId));
    });
    this.renderRelated();
    this.renderHome();
  }

  showView(view) {
    document.documentElement.classList.toggle("catalog-home", view === "home");
    document.documentElement.classList.toggle("scene-reading", view === "scene");
    document.querySelector("#scene-content").setAttribute("data-theme", document.documentElement.dataset.theme);
    document.querySelectorAll(".graph-option").forEach((button) => {
      button.classList.toggle("active", view === "graph" && button.dataset.slug === this.activeGraph?.slug);
    });
  }

  renderRelated() {
    const host = document.querySelector("#reading-switcher");
    host.replaceChildren();
    if (this.view === "home") return;
    const graphSlug = this.view === "graph" ? this.activeGraph?.slug : this.currentScene?.graphSlug;
    const graph = this.graphs.find((item) => item.slug === graphSlug);
    const scenes = (this.scenes || []).filter((scene) => scene.callgraph && scene.callgraph === graphSlug);
    host.append(node("span", "reading-label", "阅读视图"));
    if (graph) {
      const anchor = link("调用图", `/?graph=${graph.slug}`, "reading-view-link");
      anchor.title = graph.title;
      anchor.dataset.catalogLink = "";
      if (this.view === "graph") anchor.setAttribute("aria-current", "page");
      host.append(anchor);
    }
    if (this.view === "scene" && !scenes.some((scene) => scene.slug === this.currentScene.slug)) {
      scenes.push({ slug: this.currentScene.slug, title: this.currentScene.title });
    }
    for (const scene of scenes) {
      const anchor = link(scene.title, `/?scene=${scene.slug}`, "reading-view-link");
      anchor.dataset.catalogLink = "";
      if (this.view === "scene" && scene.slug === this.currentScene?.slug) anchor.setAttribute("aria-current", "page");
      host.append(anchor);
    }
  }

  async navigate(href, mode = "push", targetIndex = 0) {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    const legacy = /^\/scenes\/([a-z0-9][a-z0-9_-]*)\.html$/.exec(url.pathname);
    if (legacy) { url.pathname = "/"; url.search = legacy[1] === "index" ? "" : `?scene=${legacy[1]}`; url.hash = ""; }
    if (url.pathname !== "/" && url.pathname !== "/index.html") { location.assign(url.href); return; }
    const positionKey = this.view === "scene" ? this.currentScene?.slug : this.view;
    if (this.view === "scene" || this.view === "home") {
      const surface = document.querySelector(this.view === "scene" ? "#scene-reader" : ".workspace");
      this.readingPositions.set(positionKey, { top: surface.scrollTop, left: this.reader.root.querySelector(".diagram-scroll")?.scrollLeft || 0 });
    }
    const version = ++this.routeVersion;
    this.controller?.abort();
    this.callbacks.cancelGraph?.();
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      if (await this.beforeNavigate() === false) throw new Error("布局尚未保存，请重试当前入口");
      if (version !== this.routeVersion) return;
      const sceneSlug = url.searchParams.get("scene");
      const graphSlug = url.searchParams.get("graph");
      if (sceneSlug) {
        const scene = await this.reader.prepare(sceneSlug, controller.signal);
        if (version !== this.routeVersion) return;
        this.currentScene = scene;
        this.view = "scene";
        this.projectId = this.scenes?.find((item) => item.slug === sceneSlug)?.projectId || this.graphs.find((item) => item.slug === scene.graphSlug)?.projectId;
        this.reader.show(scene);
        this.showView("scene");
        document.querySelector("#graph-title").textContent = scene.title;
        document.querySelectorAll(".catalog-project").forEach((section) => {
          section.classList.toggle("current-project", section.dataset.projectId === this.projectId);
          section.open = section.dataset.projectId === this.projectId;
        });
        url.search = `?scene=${encodeURIComponent(sceneSlug)}`;
        this.renderScenes();
      } else if (graphSlug) {
        if (!await this.callbacks.openGraph(graphSlug)) throw new Error("调用图未切换，可重新点击入口重试");
        if (version !== this.routeVersion) return;
        url.search = `?graph=${encodeURIComponent(graphSlug)}`;
      } else {
        this.view = "home";
        this.showView("home");
        document.querySelector("#graph-title").textContent = "全部项目与地图";
        this.renderScenes();
      }
      if (version !== this.routeVersion) return;
      if (mode === "pop") this.historyIndex = targetIndex;
      else if (mode === "push" && url.href !== this.currentHref) {
        this.historyIndex += 1;
        history.pushState({ workspaceIndex: this.historyIndex }, "", url);
      } else history.replaceState({ workspaceIndex: this.historyIndex }, "", url);
      this.currentHref = url.href;
      const saved = this.readingPositions.get(this.view === "scene" ? this.currentScene.slug : this.view);
      if (saved && this.view !== "graph") {
        requestAnimationFrame(() => {
          if (version !== this.routeVersion) return;
          document.querySelector(this.view === "scene" ? "#scene-reader" : ".workspace").scrollTop = saved.top;
          const diagram = this.reader.root.querySelector(".diagram-scroll");
          if (this.view === "scene" && diagram) diagram.scrollLeft = saved.left;
        });
      }
      document.querySelector("#status-text").textContent = this.view === "home" ? "目录已就绪" : "阅读内容已就绪";
    } catch (error) {
      if (version !== this.routeVersion) return;
      this.callbacks.onError?.(error.name === "AbortError" ? "场景加载超时，可重新点击入口重试" : error.message);
      if (mode === "pop") {
        if (this.historyIndex !== targetIndex) { this.restoringHistory = true; history.go(this.historyIndex - targetIndex); }
        else history.replaceState({ workspaceIndex: this.historyIndex }, "", this.currentHref);
      }
    } finally { clearTimeout(timer); }
  }

  renderHome() {
    const root = document.querySelector("#home-projects");
    const focused = document.activeElement;
    // Scene completion updates each scene list in place to preserve keyboard focus and scroll.
    const existing = new Map([...root.children].map((card) => [card.dataset.projectId, card]));
    const projects = new Map(this.projects.map((project) => [project.id, project]));
    for (const scene of this.scenes || []) {
      const id = scene.projectId || "";
      if (!projects.has(id)) projects.set(id, { id, name: id ? scene.projectLabel : "未关联项目" });
    }
    for (const project of projects.values()) {
      let card = existing.get(project.id);
      if (!card) {
        card = node("article", "home-project");
        card.dataset.projectId = project.id;
        card.id = `home-project-${project.id || "unassigned"}`;
        card.append(node("span", "home-project-label", "项目分类"), node("h2", "", project.name), node("p", "home-project-count"));
        const sceneList = node("div", "home-scene-list");
        const graphList = node("div", "home-graph-list");
        card.append(node("h3", "catalog-type", "场景地图"), sceneList, node("h3", "catalog-type", "调用图"), graphList);
        root.append(card);
      }
      card.classList.toggle("located-project", new URL(location.href).searchParams.get("project") === project.id);
      const graphs = this.graphs.filter((graph) => graph.projectId === project.id);
      const scenes = (this.scenes || []).filter((scene) => (scene.projectId || "") === project.id);
      card.querySelector(".home-project-count").textContent = `${graphs.length} 张调用图 · ${this.scenes ? scenes.length : "…"} 张场景`;
      const sceneHost = card.querySelector(".home-scene-list");
      if (!sceneHost.contains(focused)) this.sceneLinks(sceneHost, scenes);
      const host = card.querySelector(".home-graph-list");
      if (!host.contains(focused)) {
        host.replaceChildren();
        for (const group of groupGraphCatalog(graphs)) {
          host.append(node("h4", "home-category", group.category));
          for (const graph of group.graphs) {
            const anchor = link(graph.title, `/?graph=${encodeURIComponent(graph.slug)}`, "home-graph-link");
            anchor.dataset.catalogLink = "";
            host.append(anchor);
          }
        }
        if (!graphs.length) host.append(node("p", "catalog-notice", "暂无调用图"));
      }
    }
    document.querySelector("#home-summary").textContent = `${projects.size} 个项目 / ${this.graphs.length} 张调用图 / ${this.scenes ? this.scenes.length : "…"} 张场景`;
  }
}
