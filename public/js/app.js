import { CallgraphApi } from "./api.js";
import { ClickNavigationPolicy } from "./click-navigation-policy.js";
import { GraphState } from "./graph-state.js";
import { Inspector } from "./inspector.js";
import { LayeredLayout } from "./layouts/layered-layout.js";
import { RendererRegistry } from "./renderer-registry.js";
import { SvgRenderer } from "./renderers/svg-renderer.js";
import { themes } from "./theme-registry.js";
import { TraceNavigator } from "./trace-navigator.js";

const api = new CallgraphApi();
const elements = {
  graphList: document.querySelector("#graph-list"),
  graphTitle: document.querySelector("#graph-title"),
  health: document.querySelector("#health"),
  search: document.querySelector("#search"),
  kindFilters: document.querySelector("#kind-filters"),
  visibleCount: document.querySelector("#visible-count"),
  validation: document.querySelector("#validation-badge"),
  revision: document.querySelector("#revision"),
  status: document.querySelector("#status-text"),
  canvas: document.querySelector("#graph-canvas"),
  empty: document.querySelector("#empty-state"),
  orientation: document.querySelector("#orientation"),
  themeSelect: document.querySelector("#theme-select"),
  sourceStepper: document.querySelector(".source-stepper"),
  tracePrevious: document.querySelector("#trace-previous"),
  traceCallSite: document.querySelector("#trace-callsite"),
  traceBranchWrap: document.querySelector("#trace-branch-wrap"),
  traceBranchLabel: document.querySelector("#trace-branch-label"),
  traceBranch: document.querySelector("#trace-branch"),
  traceNext: document.querySelector("#trace-next"),
  instantOpenToggle: document.querySelector("#instant-open-toggle"),
};

const rendererRegistry = new RendererRegistry().register(
  "svg",
  ({ element, layout }) => new SvgRenderer(element, layout),
);
const renderer = rendererRegistry.create("svg", {
  element: elements.canvas,
  layout: new LayeredLayout(),
});
const inspector = new Inspector(
  document.querySelector("#inspector-empty"),
  document.querySelector("#inspector-content"),
);
const clickNavigation = new ClickNavigationPolicy();

let activeSlug = null;
let activeGraph = null;
let state = null;
let traceNavigator = null;
let unsubscribe = null;
let firstRender = true;

initializeThemes();
renderer.setCallbacks({
  onSelect: selectGraphTarget,
  onToggleCollapse: (nodeId) => state?.toggleCollapse(nodeId),
});
inspector.setCallbacks({
  onOpen: openTarget,
  onHide: (nodeId) => state?.hideNode(nodeId),
  onCollapse: (nodeId) => state?.toggleCollapse(nodeId),
});

bindControls();
bootstrap().catch(showFatal);

function initializeThemes() {
  for (const theme of themes.list()) {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.label;
    option.title = theme.description;
    elements.themeSelect.append(option);
  }
  elements.themeSelect.value = themes.initialize("halo");
  elements.themeSelect.addEventListener("change", () => themes.apply(elements.themeSelect.value));
  themes.subscribe(() => {
    if (state) render(state, "theme");
  });
}

async function bootstrap() {
  elements.status.textContent = "连接本地 Rust 服务";
  const [health, graphs] = await Promise.all([api.health(), api.listGraphs()]);
  updateHealth(health);
  renderGraphList(graphs);
  if (!graphs.length) throw new Error("graphs 目录中没有调用图");
  await activateGraph(graphs[0].slug);
}

function updateHealth(health) {
  const missingRoots = health.projects.filter((project) => !project.rootExists);
  elements.health.classList.toggle("ready", missingRoots.length === 0);
  elements.health.querySelector("span:last-child").textContent = missingRoots.length
    ? `${missingRoots.length} 个项目根路径无效`
    : `${health.projects.length} 个项目已就绪`;
  elements.health.title = health.projects
    .map((project) => `${project.id}: ${project.root}`)
    .join("\n");
}

function renderGraphList(graphs) {
  elements.graphList.replaceChildren();
  for (const graph of graphs) {
    const button = document.createElement("button");
    button.className = "graph-option";
    button.dataset.slug = graph.slug;
    const title = document.createElement("strong");
    title.textContent = graph.title;
    const meta = document.createElement("small");
    meta.textContent =
      `${graph.projectId.toUpperCase()} · ${graph.nodeCount} NODES · ${graph.edgeCount} EDGES`;
    button.append(title, meta);
    button.addEventListener("click", () => activateGraph(graph.slug));
    elements.graphList.append(button);
  }
}

async function activateGraph(slug) {
  setStatus(`装载 ${slug}`);
  const graph = await api.loadGraph(slug);
  activeSlug = slug;
  activeGraph = graph;
  firstRender = true;
  unsubscribe?.();
  state = new GraphState(graph);
  traceNavigator = new TraceNavigator(graph);
  state.selected = { type: "node", id: graph.root };
  unsubscribe = state.subscribe(render);

  document.querySelectorAll(".graph-option").forEach((element) => {
    element.classList.toggle("active", element.dataset.slug === slug);
  });
  elements.graphTitle.textContent = graph.title;
  elements.revision.textContent = `REVISION ${(graph.sourceRevision || "—").slice(0, 10)}`;
  buildKindFilters();
  render(state, "initial");
  await validateActiveGraph();
}

function render(currentState, reason) {
  const visibleGraph = currentState.getVisibleGraph();
  renderer.render(visibleGraph, currentState);
  inspector.render(currentState.selected, currentState.graph);
  elements.visibleCount.textContent =
    `${visibleGraph.nodes.length} / ${currentState.graph.nodes.length} 节点`;
  elements.empty.hidden = visibleGraph.nodes.length !== 0;
  elements.orientation.textContent =
    currentState.orientation === "vertical" ? "纵向布局" : "横向布局";
  document.querySelectorAll("[data-focus]").forEach((button) => {
    button.classList.toggle("active", button.dataset.focus === currentState.focusMode);
  });
  elements.kindFilters.querySelectorAll("[data-kind]").forEach((button) => {
    button.classList.toggle("active", currentState.enabledKinds.has(button.dataset.kind));
  });
  renderTraceControls();
  if (firstRender) {
    requestAnimationFrame(() => renderer.focusStart(currentState.orientation));
    firstRender = false;
  } else if (reason === "structure") {
    requestAnimationFrame(() => renderer.fit());
  }
  setStatus(
    currentState.selected
      ? `已选择 ${currentState.selected.type === "node" ? "节点" : "连线"} ${currentState.selected.id}`
      : "图谱就绪",
  );
}

function buildKindFilters() {
  elements.kindFilters.replaceChildren();
  const kinds = [...new Set(activeGraph.edges.map((edge) => edge.kind))].sort();
  for (const kind of kinds) {
    const button = document.createElement("button");
    button.className = "kind-filter active";
    button.dataset.kind = kind;
    button.textContent = kind;
    button.addEventListener("click", () => state.toggleKind(kind));
    elements.kindFilters.append(button);
  }
}

async function validateActiveGraph() {
  elements.validation.className = "validation-badge";
  elements.validation.textContent = "源码校验中";
  try {
    const report = await api.validateGraph(activeSlug);
    elements.validation.classList.add(report.valid ? "valid" : "invalid");
    elements.validation.textContent = report.valid
      ? `${report.sourceLocations.length} 处源码有效`
      : `${report.errors.length} 个错误`;
    elements.validation.title = [...report.errors, ...report.warnings].join("\n");
    if (!report.valid) toast("调用图存在无效源码位置", true);
  } catch (error) {
    elements.validation.classList.add("invalid");
    elements.validation.textContent = "校验失败";
    elements.validation.title = error.message;
  }
}

async function openTarget(target) {
  if (!target || !activeSlug) return;
  setStatus("生成源码协议链接");
  try {
    const response = await api.buildSourceLink(activeSlug, target.type, target.id);
    window.location.href = response.uri;
    toast(`已交给浏览器打开 ${shortPath(response.path)}:${response.line}`);
    setStatus("已触发外部源码协议");
  } catch (error) {
    toast(error.message, true);
    setStatus("源码跳转失败");
  }
}

function bindControls() {
  elements.search.addEventListener("input", (event) => state?.setQuery(event.target.value));
  document.querySelectorAll("[data-focus]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!state?.selected || state.selected.type !== "node") {
        if (button.dataset.focus !== "all") toast("请先选择一个节点", true);
        else state?.setFocus("all");
        return;
      }
      state.setFocus(button.dataset.focus);
    });
  });
  document.querySelector("#zoom-in").addEventListener("click", () => renderer.zoomBy(1.18));
  document.querySelector("#zoom-out").addEventListener("click", () => renderer.zoomBy(0.84));
  document.querySelector("#fit-view").addEventListener("click", () => renderer.fit());
  document.querySelector("#reset-view").addEventListener("click", () => state?.resetVisibility());
  elements.orientation.addEventListener("click", () => state?.toggleOrientation());
  elements.instantOpenToggle.addEventListener("click", () => {
    const enabled = clickNavigation.toggle();
    elements.instantOpenToggle.classList.toggle("active", enabled);
    elements.instantOpenToggle.setAttribute("aria-pressed", String(enabled));
    elements.instantOpenToggle.textContent =
      `点击跳转：${enabled ? "开" : "关"}`;
  });
  elements.tracePrevious.addEventListener("click", () => navigateTrace("previous"));
  elements.traceCallSite.addEventListener("click", () => navigateTrace("callSite"));
  elements.traceBranch.addEventListener("change", (event) => {
    const target = traceNavigator?.selectBranch(event.target.value);
    if (target) state?.select(target);
  });
  elements.traceNext.addEventListener("click", () => navigateTrace("next"));
  window.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== elements.search) {
      event.preventDefault();
      elements.search.focus();
    }
    if (event.key === "Escape") state?.select(null);
    if (
      !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
      && !isEditableTarget(event.target)
      && (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      const action = event.key === "ArrowLeft" ? "stepBackward" : "stepForward";
      const button = event.key === "ArrowLeft" ? elements.tracePrevious : elements.traceNext;
      if (!button.disabled) {
        event.preventDefault();
        navigateTrace(action);
      }
    }
  });
}

function selectGraphTarget(target) {
  traceNavigator?.syncSelection(target);
  state?.select(target);
  if (clickNavigation.shouldOpen(activeGraph, target)) void openTarget(target);
}

function renderTraceControls() {
  if (!traceNavigator) return;
  const snapshot = traceNavigator.snapshot();
  elements.sourceStepper.dataset.currentNode = snapshot.currentNode?.id || "";
  elements.sourceStepper.dataset.currentPosition =
    state?.selected?.type === "edge" ? "edge" : "node";
  renderTraceBranches(snapshot);
  configureTraceButton(
    elements.tracePrevious,
    snapshot.previousNode,
    snapshot.previousNode
      ? `上一节点：${snapshot.previousNode.label}（←）`
      : "当前节点没有上游节点",
  );
  configureTraceButton(
    elements.traceNext,
    snapshot.nextNode,
    snapshot.nextNode
      ? `下一节点：${snapshot.nextNode.label}（→）`
      : "当前节点没有下游节点",
  );

  const callAvailable = Boolean(snapshot.callEdge && snapshot.callSite?.available);
  elements.traceCallSite.disabled = !callAvailable;
  elements.traceCallSite.title = callAvailable
    ? `调用位置：${snapshot.callSite.compactLabel}`
    : snapshot.callSite?.note || "当前节点没有下游调用";
  elements.traceCallSite.dataset.traceEdgeId = snapshot.callEdge?.id || "";
}

function renderTraceBranches(snapshot) {
  const showBranches = snapshot.branches.length > 1;
  elements.traceBranchWrap.hidden = !showBranches;
  if (!showBranches) {
    elements.traceBranch.replaceChildren();
    return;
  }

  const selectedIndex = snapshot.branches.findIndex((branch) => branch.selected);
  elements.traceBranchLabel.textContent =
    `分支 ${Math.max(0, selectedIndex) + 1}/${snapshot.branches.length}`;

  const options = snapshot.branches.map(({ edge, node, callSite, selected }) => {
    const option = document.createElement("option");
    option.value = edge.id;
    const location = callSite.available
      ? callSite.compactLabel
      : callSite.shortLabel || "无调用位置";
    option.textContent =
      `${node?.label || edge.to} · ${edge.kind} · ${location}`;
    option.title = `${edge.id} → ${node?.label || edge.to}`;
    option.selected = selected;
    return option;
  });
  elements.traceBranch.replaceChildren(...options);
  elements.traceBranch.title = "选择右箭头继续跟随的下游分支";
}

function configureTraceButton(button, node, title) {
  button.disabled = !node;
  button.title = title;
  button.dataset.traceNodeId = node?.id || "";
}

function isEditableTarget(target) {
  return target instanceof HTMLElement
    && (target.matches("input, textarea, select") || target.isContentEditable);
}

function navigateTrace(action) {
  const target = traceNavigator?.[action]?.();
  if (!target) {
    const snapshot = traceNavigator?.snapshot();
    const message =
      action === "callSite" && snapshot?.callSite?.note
        ? snapshot.callSite.note
        : "当前调用链没有可导航的目标";
    toast(message, true);
    return;
  }
  state?.select(target);
  void openTarget(target);
}

function toast(message, error = false) {
  const element = document.createElement("div");
  element.className = `toast${error ? " error" : ""}`;
  element.textContent = message;
  document.querySelector("#toast-region").append(element);
  window.setTimeout(() => element.remove(), 3600);
}

function setStatus(message) {
  elements.status.textContent = message;
}

function showFatal(error) {
  elements.graphTitle.textContent = "无法载入调用图";
  elements.health.querySelector("span:last-child").textContent = "服务异常";
  setStatus(error.message);
  toast(error.message, true);
}

function shortPath(path) {
  return path.split(/[\\/]/).slice(-3).join("/");
}
