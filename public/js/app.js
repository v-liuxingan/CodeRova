import { CallgraphApi } from "./api.js";
import { groupGraphCatalog } from "./catalog-grouping.js";
import { ClickNavigationPolicy } from "./click-navigation-policy.js";
import {
  edgeExecutionOrder,
  edgeFlowKind,
  edgeGroupLabel,
  edgeRelationLabel,
} from "./edge-semantics.js";
import { GraphState } from "./graph-state.js";
import { Inspector } from "./inspector.js";
import { InspectorWorkbenchController } from "./inspector-workbench-controller.js";
import { NarrativeLayout } from "./layouts/narrative-layout.js";
import { LayoutPersistenceController } from "./layout-persistence-controller.js";
import { RendererRegistry } from "./renderer-registry.js";
import { SvgRenderer } from "./renderers/svg-renderer.js";
import { ResizablePanelController } from "./resizable-panel-controller.js";
import { SourcePreviewController } from "./source-preview-controller.js";
import { themes } from "./theme-registry.js";
import { TraceNavigator } from "./trace-navigator.js";

const api = new CallgraphApi();
const CATALOG_COLLAPSE_STORAGE_KEY = "callgraph.catalog.collapsed.v1";
const RAIL_COLLAPSE_STORAGE_KEY = "callgraph.rail.collapsed.v1";
const elements = {
  workspace: document.querySelector(".workspace"),
  railCollapse: document.querySelector("#rail-collapse"),
  graphList: document.querySelector("#graph-list"),
  graphTitle: document.querySelector("#graph-title"),
  graphOverviewDescription: document.querySelector("#graph-overview-description"),
  graphOverviewStart: document.querySelector("#graph-overview-start"),
  graphOverviewEndLabel: document.querySelector("#graph-overview-end-label"),
  graphOverviewEnd: document.querySelector("#graph-overview-end"),
  graphOverviewSinksWrap: document.querySelector("#graph-overview-sinks-wrap"),
  graphOverviewSinks: document.querySelector("#graph-overview-sinks"),
  graphOverviewScale: document.querySelector("#graph-overview-scale"),
  health: document.querySelector("#health"),
  search: document.querySelector("#search"),
  kindFilters: document.querySelector("#kind-filters"),
  visibleCount: document.querySelector("#visible-count"),
  validation: document.querySelector("#validation-badge"),
  revision: document.querySelector("#revision"),
  status: document.querySelector("#status-text"),
  canvas: document.querySelector("#graph-canvas"),
  canvasWrap: document.querySelector("#canvas-wrap"),
  empty: document.querySelector("#empty-state"),
  orientation: document.querySelector("#orientation"),
  themeSelect: document.querySelector("#theme-select"),
  sourceStepper: document.querySelector(".source-stepper"),
  tracePrevious: document.querySelector("#trace-previous"),
  traceCallSite: document.querySelector("#trace-callsite"),
  traceBranchWrap: document.querySelector("#trace-branch-wrap"),
  traceBranchTrigger: document.querySelector("#trace-branch-trigger"),
  traceBranchLabel: document.querySelector("#trace-branch-label"),
  traceBranchCurrent: document.querySelector("#trace-branch-current"),
  traceBranchMenu: document.querySelector("#trace-branch-menu"),
  traceBranch: document.querySelector("#trace-branch"),
  traceNext: document.querySelector("#trace-next"),
  instantOpenToggle: document.querySelector("#instant-open-toggle"),
  categoryEditor: document.querySelector("#category-editor"),
  categoryEditorForm: document.querySelector("#category-editor-form"),
  categoryEditorGraph: document.querySelector("#category-editor-graph"),
  categoryEditorSelect: document.querySelector("#category-editor-select"),
  categoryEditorNameWrap: document.querySelector("#category-editor-name-wrap"),
  categoryEditorName: document.querySelector("#category-editor-name"),
  categoryEditorSave: document.querySelector("#category-editor-save"),
};

const rendererRegistry = new RendererRegistry().register(
  "svg",
  ({ element, layout }) => new SvgRenderer(element, layout),
);
const renderer = rendererRegistry.create("svg", {
  element: elements.canvas,
  layout: new NarrativeLayout(),
});
const inspector = new Inspector(
  document.querySelector("#inspector-empty"),
  document.querySelector("#inspector-content"),
  document.querySelector("#source-preview-body"),
);
const clickNavigation = new ClickNavigationPolicy();
const sourcePreview = new SourcePreviewController(api, inspector);
let inspectorWorkbench = null;
const resizableInspector = new ResizablePanelController(
  document.documentElement,
  document.querySelector("#inspector-resizer"),
  {
    onManualResize: () => inspectorWorkbench?.handleManualResize(),
  },
);
inspectorWorkbench = new InspectorWorkbenchController({
  root: document.documentElement,
  panel: document.querySelector(".inspector"),
  resizablePanel: resizableInspector,
  focusButton: document.querySelector("#inspector-focus"),
  collapseButton: document.querySelector("#inspector-collapse"),
});
const layoutPersistence = new LayoutPersistenceController(api, {
  onStatus: (message) => setStatus(message),
  onError: (message) => {
    setStatus("节点布局保存失败");
    toast(message, true);
  },
});
let activeSlug = null;
let activeGraph = null;
let state = null;
let traceNavigator = null;
let unsubscribe = null;
let firstRender = true;
let catalogGraphs = [];
let categoryEditorSlug = null;
let graphLoadVersion = 0;

initializeThemes();
initializeRail();
initializeCategoryEditor();
renderer.setCallbacks({
  onSelect: selectGraphTarget,
  onToggleCollapse: (nodeId) => state?.toggleCollapse(nodeId),
  onSetNodeSelection: (nodeIds) => state?.setSelectedNodes(nodeIds),
  onToggleNodeSelection: (nodeId) => state?.toggleSelectedNode(nodeId),
  onClearInteractionSelection: () => state?.clearInteractionSelection(),
  onNodesMove: (positions) => {
    state?.setNodePositions(positions);
    layoutPersistence.schedule(activeSlug, state.exportLayout(activeSlug));
  },
});
inspector.setCallbacks({
  onSelect: selectGraphTarget,
  onOpen: openTarget,
  onHide: (nodeId) => state?.hideNode(nodeId),
  onCollapse: (nodeId) => state?.toggleCollapse(nodeId),
  onPreviewContextChange: (lines) => sourcePreview.setContextLines(lines),
  onPreviewScopeChange: (scope) => sourcePreview.setScope(scope),
  onPreviewNotice: (message, error) => toast(message, error),
});

inspectorWorkbench.initialize();
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
  const [health, graphs] = await Promise.all([
    api.health(),
    api.listGraphs(),
  ]);
  catalogGraphs = graphs;
  updateHealth(health);
  const catalog = renderGraphList(graphs);
  if (!graphs.length) throw new Error("graphs 目录中没有调用图");
  const requestedSlug = new URL(window.location.href).searchParams.get("graph");
  const initialSlug = graphs.some((graph) => graph.slug === requestedSlug)
    ? requestedSlug
    : catalog[0].graphs[0].slug;
  await activateGraph(initialSlug);
  if (requestedSlug && requestedSlug !== initialSlug) {
    toast("链接中的调用图不存在，已打开目录中的首张图", true);
  }
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
  const groups = groupGraphCatalog(graphs);
  const collapsedCategories = loadCollapsedCatalogCategories();
  groups.forEach(({ categoryId, category, graphs: categoryGraphs }, index) => {
    const itemsId = `graph-category-${index + 1}`;
    const collapsed = collapsedCategories.has(categoryId);
    const section = document.createElement("section");
    section.className = "graph-category";
    section.classList.toggle("collapsed", collapsed);
    section.dataset.category = category;
    section.dataset.categoryId = categoryId;
    section.setAttribute("aria-label", `${category}，${categoryGraphs.length} 张图谱`);
    const header = document.createElement("button");
    header.type = "button";
    header.className = "graph-category-header";
    header.setAttribute("aria-controls", itemsId);
    header.setAttribute("aria-expanded", String(!collapsed));
    header.title = `${collapsed ? "展开" : "折叠"}${category}`;
    const chevron = document.createElement("span");
    chevron.className = "graph-category-chevron";
    chevron.setAttribute("aria-hidden", "true");
    const sequence = document.createElement("span");
    sequence.className = "graph-category-sequence";
    sequence.textContent = String(index + 1).padStart(2, "0");
    const categoryTitle = document.createElement("strong");
    categoryTitle.textContent = category;
    const count = document.createElement("small");
    count.textContent = String(categoryGraphs.length).padStart(2, "0");
    count.title = `${categoryGraphs.length} 张图谱`;
    header.append(chevron, sequence, categoryTitle, count);
    const items = document.createElement("div");
    items.className = "graph-category-items";
    items.id = itemsId;
    items.hidden = collapsed;
    header.addEventListener("click", () => {
      const nextCollapsed = !section.classList.contains("collapsed");
      section.classList.toggle("collapsed", nextCollapsed);
      header.setAttribute("aria-expanded", String(!nextCollapsed));
      header.title = `${nextCollapsed ? "展开" : "折叠"}${category}`;
      items.hidden = nextCollapsed;
      if (nextCollapsed) collapsedCategories.add(categoryId);
      else collapsedCategories.delete(categoryId);
      persistCollapsedCatalogCategories(collapsedCategories);
    });

    for (const graph of categoryGraphs) {
      const row = document.createElement("div");
      row.className = "graph-option-row";
      const button = document.createElement("button");
      button.className = "graph-option";
      button.dataset.slug = graph.slug;
      button.dataset.category = category;
      const title = document.createElement("strong");
      title.textContent = graph.title;
      const meta = document.createElement("small");
      meta.textContent =
        `${graph.projectId.toUpperCase()} · ${graph.nodeCount} NODES · ${graph.edgeCount} EDGES`;
      button.append(title, meta);
      button.addEventListener("click", () => activateGraph(graph.slug));
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "graph-category-edit";
      edit.dataset.slug = graph.slug;
      edit.setAttribute("aria-label", `编辑 ${graph.title} 的分类`);
      edit.title = "移动到其他分类";
      edit.textContent = "···";
      edit.addEventListener("click", () => openCategoryEditor(graph.slug));
      row.append(button, edit);
      items.append(row);
    }
    section.append(header, items);
    elements.graphList.append(section);
  });
  return groups;
}

function initializeRail() {
  const apply = (collapsed, persist = true) => {
    document.documentElement.classList.toggle("rail-collapsed", collapsed);
    elements.railCollapse.setAttribute("aria-expanded", String(!collapsed));
    elements.railCollapse.title = collapsed ? "展开左侧栏" : "收起左侧栏";
    elements.railCollapse.querySelector("span:first-child").textContent =
      collapsed ? "›" : "‹";
    elements.railCollapse.querySelector(".rail-collapse-label").textContent =
      collapsed ? "展开目录" : "收起目录";
    if (persist) {
      try {
        localStorage.setItem(RAIL_COLLAPSE_STORAGE_KEY, String(collapsed));
      } catch {
        // The rail remains interactive without persistence.
      }
    }
  };
  apply(document.documentElement.classList.contains("rail-collapsed"), false);
  elements.railCollapse.addEventListener("click", () => {
    apply(!document.documentElement.classList.contains("rail-collapsed"));
  });
}

function initializeCategoryEditor() {
  elements.categoryEditorSelect.addEventListener("change", () => {
    const creating = elements.categoryEditorSelect.value === "__new__";
    elements.categoryEditorNameWrap.hidden = !creating;
    elements.categoryEditorName.required = creating;
    if (creating) elements.categoryEditorName.focus();
  });
  elements.categoryEditorForm.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const selected = elements.categoryEditorSelect.selectedOptions[0];
    const creating = selected?.value === "__new__";
    const category = creating
      ? elements.categoryEditorName.value.trim()
      : selected?.textContent.trim();
    const categoryId = creating
      ? customCategoryId(category)
      : selected?.value;
    if (!category || !categoryId) {
      elements.categoryEditorName.focus();
      return;
    }
    elements.categoryEditorSave.disabled = true;
    try {
      const updated = await api.updateGraphCategory(
        categoryEditorSlug,
        categoryId,
        category,
      );
      if (activeSlug === categoryEditorSlug) activeGraph = updated;
      catalogGraphs = await api.listGraphs();
      renderGraphList(catalogGraphs);
      document.querySelector(
        `.graph-option[data-slug="${CSS.escape(activeSlug)}"]`,
      )?.classList.add("active");
      elements.categoryEditor.close();
      toast(`已移动到“${category}”`);
      setStatus(`图谱分类已更新：${category}`);
    } catch (error) {
      toast(error.message, true);
    } finally {
      elements.categoryEditorSave.disabled = false;
    }
  });
}

function openCategoryEditor(slug) {
  const graph = catalogGraphs.find((candidate) => candidate.slug === slug);
  if (!graph) return;
  categoryEditorSlug = slug;
  const groups = groupGraphCatalog(catalogGraphs);
  elements.categoryEditorSelect.replaceChildren();
  for (const group of groups) {
    const option = document.createElement("option");
    option.value = group.categoryId;
    option.textContent = group.category;
    option.selected = group.categoryId === graph.categoryId;
    elements.categoryEditorSelect.append(option);
  }
  const createOption = document.createElement("option");
  createOption.value = "__new__";
  createOption.textContent = "＋ 新建分类…";
  elements.categoryEditorSelect.append(createOption);
  elements.categoryEditorGraph.textContent = graph.title;
  elements.categoryEditorName.value = "";
  elements.categoryEditorNameWrap.hidden = true;
  elements.categoryEditorName.required = false;
  elements.categoryEditor.showModal();
  elements.categoryEditorSelect.focus();
}

function customCategoryId(category) {
  let hash = 2166136261;
  for (const character of category) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `custom-${(hash >>> 0).toString(36)}`;
}

function loadCollapsedCatalogCategories() {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(CATALOG_COLLAPSE_STORAGE_KEY) || "[]",
    );
    return new Set(
      Array.isArray(stored)
        ? stored.filter((category) => typeof category === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function persistCollapsedCatalogCategories(categories) {
  try {
    window.localStorage.setItem(
      CATALOG_COLLAPSE_STORAGE_KEY,
      JSON.stringify([...categories]),
    );
  } catch {
    // Catalog folding remains usable when browser storage is unavailable.
  }
}

async function activateGraph(slug) {
  const version = ++graphLoadVersion;
  try {
    await layoutPersistence.flush();
    if (version !== graphLoadVersion) return;
    setStatus(`装载 ${slug}`);
    const [graph, layout] = await Promise.all([api.loadGraph(slug), api.loadLayout(slug)]);
    if (version !== graphLoadVersion) return;
    const nextState = new GraphState(graph, layout);
    const nextTrace = new TraceNavigator(graph);
    activeSlug = slug;
    const url = new URL(window.location.href);
    url.searchParams.set("graph", slug);
    window.history.replaceState(null, "", url);
    activeGraph = graph;
    firstRender = true;
    unsubscribe?.();
    state = nextState;
    traceNavigator = nextTrace;
    state.selected = { type: "node", id: graph.root };
    unsubscribe = state.subscribe(render);
    elements.search.value = "";

    document.querySelectorAll(".graph-option").forEach((element) => {
      element.classList.toggle("active", element.dataset.slug === slug);
    });
    elements.graphTitle.textContent = graph.title;
    renderGraphOverview(graph);
    elements.revision.textContent = `REVISION ${(graph.sourceRevision || "—").slice(0, 10)}`;
    buildKindFilters();
    render(state, "initial");
    await validateActiveGraph();
  } catch (error) {
    if (version !== graphLoadVersion) return;
    if (!activeGraph) {
      showFatal(error);
      return;
    }
    setStatus(`无法装载 ${slug}，保留当前调用图`);
    toast(error.message, true);
  }
}

function render(currentState, reason) {
  const visibleGraph = currentState.getVisibleGraph();
  traceNavigator?.setVisibleNodeIds(
    new Set(visibleGraph.nodes.map((node) => node.id)),
  );
  renderer.render(visibleGraph, currentState);
  inspector.render(currentState.selected, currentState.graph);
  void sourcePreview.show(activeSlug, currentState.graph, currentState.selected);
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
  }
  setStatus(
    currentState.selectedNodeIds.size
      ? `已选中 ${currentState.selectedNodeIds.size} 个布局节点`
      : currentState.selected
      ? `已选择 ${targetTypeLabel(currentState.selected.type)} ${currentState.selected.id}`
      : "图谱就绪",
  );
}

function targetTypeLabel(type) {
  return {
    node: "节点",
    edge: "连线",
  }[type] || "目标";
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

function renderGraphOverview(graph) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const start = nodeById.get(graph.root);
  const nodesWithOutgoing = new Set(graph.edges.map((edge) => edge.from));
  const endpoints = graph.nodes.filter((node) => !nodesWithOutgoing.has(node.id));
  const endpointLabels = endpoints.map(nodeScenarioLabel);
  const endpointText = endpointLabels.length > 1
    ? `${endpointLabels[0]} 等 ${endpointLabels.length} 个`
    : endpointLabels[0] || "未识别";

  elements.graphOverviewDescription.textContent = graph.description || "暂无图谱说明";
  elements.graphOverviewStart.textContent =
    nodeScenarioLabel(start) || graph.root || "未识别";
  elements.graphOverviewStart.title = start
    ? `${start.label} · ${start.id}`
    : graph.root || "";
  elements.graphOverviewEndLabel.textContent = "结构终点";
  elements.graphOverviewEnd.textContent = endpointText;
  elements.graphOverviewEnd.title =
    `仅表示本图未记录出边，不保证运行时结束。${endpointLabels.join("、")}`;
  elements.graphOverviewSinksWrap.hidden = true;
  elements.graphOverviewSinks.textContent = "";
  elements.graphOverviewSinks.title = "";
  elements.graphOverviewScale.textContent =
    `${graph.nodes.length} 节点 · ${graph.edges.length} 关系`;
}

function nodeScenarioLabel(node) {
  return node?.role?.trim() || node?.label?.trim() || "";
}

async function validateActiveGraph() {
  const graphState = state;
  const slug = activeSlug;
  elements.validation.className = "validation-badge";
  elements.validation.textContent = "源码校验中";
  elements.validation.title = "";
  try {
    const report = await api.validateGraph(slug);
    if (state !== graphState) return;
    elements.validation.classList.add(report.valid ? "valid" : "invalid");
    elements.validation.textContent = report.valid
      ? `${report.sourceLocations.length} 处源码有效`
      : `${report.errors.length} 个错误`;
    elements.validation.title = [...report.errors, ...report.warnings].join("\n");
    if (!report.valid) toast("调用图存在无效源码位置", true);
  } catch (error) {
    if (state !== graphState) return;
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
  document.querySelector("#zoom-in").addEventListener(
    "click",
    () => renderer.zoomBy(1.18),
  );
  document.querySelector("#zoom-out").addEventListener(
    "click",
    () => renderer.zoomBy(0.84),
  );
  document.querySelector("#fit-view").addEventListener(
    "click",
    () => renderer.fit(),
  );
  document.querySelector("#reset-view").addEventListener("click", () => state?.resetVisibility());
  document.querySelector("#reset-layout").addEventListener("click", () => {
    if (!state || !activeSlug) return;
    state.resetNodePositions();
    layoutPersistence.schedule(activeSlug, state.exportLayout(activeSlug));
    toast(`已恢复${state.orientation === "vertical" ? "纵向" : "横向"}自动排版`);
  });
  elements.orientation.addEventListener("click", () => state?.toggleOrientation());
  elements.instantOpenToggle.addEventListener("click", () => {
    const enabled = clickNavigation.toggle();
    elements.instantOpenToggle.classList.toggle("active", enabled);
    elements.instantOpenToggle.setAttribute("aria-pressed", String(enabled));
    elements.instantOpenToggle.textContent =
      `点击跳转：${enabled ? "开" : "关"}`;
  });
  elements.tracePrevious.addEventListener("click", () => navigateTrace("stepBackward"));
  elements.traceCallSite.addEventListener("click", () => navigateTrace("callSite"));
  elements.traceBranchTrigger.addEventListener("click", () => {
    setTraceBranchMenuOpen(elements.traceBranchMenu.hidden);
  });
  elements.traceBranchMenu.addEventListener("click", (event) => {
    const option = event.target.closest("[data-trace-branch-id]");
    if (!option) return;
    elements.traceBranch.value = option.dataset.traceBranchId;
    setTraceBranchMenuOpen(false);
    elements.traceBranch.dispatchEvent(new Event("change", { bubbles: true }));
    elements.traceBranchTrigger.focus();
  });
  elements.traceBranch.addEventListener("change", (event) => {
    const target = traceNavigator?.selectBranch(event.target.value);
    if (target) state?.select(target);
  });
  elements.traceNext.addEventListener("click", () => navigateTrace("stepForward"));
  document.addEventListener("click", (event) => {
    if (!elements.traceBranchWrap.contains(event.target)) {
      setTraceBranchMenuOpen(false);
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "/" && !event.defaultPrevented
      && !event.ctrlKey && !event.metaKey && !event.altKey
      && !isEditableTarget(event.target)) {
      event.preventDefault();
      elements.search.focus();
    }
    if (event.key === "Escape") {
      if (!elements.traceBranchMenu.hidden) {
        event.preventDefault();
        setTraceBranchMenuOpen(false);
        elements.traceBranchTrigger.focus();
        return;
      }
      state?.clearInteractionSelection();
    }
    if (
      !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
      && !event.defaultPrevented
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
      ? `上一步：${snapshot.previousNode.label} 或其调用位置（←）`
      : "当前调用链没有上一步",
  );
  configureTraceButton(
    elements.traceNext,
    snapshot.nextNode,
    snapshot.nextNode
      ? `下一步：调用位置或 ${snapshot.nextNode.label}（→）`
      : "当前调用链没有下一步",
  );

  const callAvailable = Boolean(snapshot.callEdge && snapshot.callSite?.available);
  elements.traceCallSite.disabled = !callAvailable;
  elements.traceCallSite.title = callAvailable
    ? `调用位置：${snapshot.callSite.compactLabel}`
    : snapshot.callSite?.note || "当前节点没有下游调用";
  elements.traceCallSite.dataset.traceEdgeId = snapshot.callEdge?.id || "";
  if (callAvailable) {
    void sourcePreview.prefetch(activeSlug, activeGraph, {
      type: "edge",
      id: snapshot.callEdge.id,
    });
  }
  if (snapshot.nextNode) {
    void sourcePreview.prefetch(activeSlug, activeGraph, {
      type: "node",
      id: snapshot.nextNode.id,
    });
  }
}

function renderTraceBranches(snapshot) {
  const showBranches = snapshot.branches.length > 1;
  elements.traceBranchWrap.hidden = !showBranches;
  if (!showBranches) {
    setTraceBranchMenuOpen(false);
    elements.traceBranch.replaceChildren();
    elements.traceBranchMenu.replaceChildren();
    elements.traceBranchCurrent.textContent = "选择下游路径";
    return;
  }

  const selectedIndex = snapshot.branches.findIndex((branch) => branch.selected);
  const groupLabel = edgeGroupLabel(
    snapshot.branches.map((branch) => branch.edge),
  );
  elements.traceBranchLabel.textContent =
    `${groupLabel} ${Math.max(0, selectedIndex) + 1}/${snapshot.branches.length}`;
  const selectedBranch = snapshot.branches[selectedIndex] || snapshot.branches[0];
  elements.traceBranchCurrent.textContent =
    selectedBranch.node?.label || selectedBranch.edge.to;

  const options = snapshot.branches.map(({ edge, node, callSite, selected }) => {
    const option = document.createElement("option");
    option.value = edge.id;
    const location = callSite.available
      ? callSite.compactLabel
      : callSite.shortLabel || "无调用位置";
    option.textContent =
      `${node?.label || edge.to} · ${edgeRelationLabel(edge)} · ${location}`;
    option.title = `${edge.id} → ${node?.label || edge.to}`;
    option.selected = selected;
    return option;
  });
  elements.traceBranch.replaceChildren(...options);
  elements.traceBranch.title = "选择右箭头继续跟随的下游分支";

  const menuOptions = snapshot.branches.map(
    ({ edge, node, callSite, selected }) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = `trace-branch-option${selected ? " selected" : ""}`;
      option.dataset.traceBranchId = edge.id;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(selected));

      const location = callSite.available
        ? callSite.compactLabel
        : callSite.shortLabel || "无调用位置";
      const relation = edgeRelationLabel(edge);
      const executionOrder = edgeExecutionOrder(edge);
      const optionIndex = document.createElement("span");
      optionIndex.className = "trace-branch-index";
      optionIndex.textContent = selected
        ? "✓"
        : executionOrder
          ? String(executionOrder)
          : "·";
      const optionCopy = document.createElement("span");
      optionCopy.className = "trace-branch-option-copy";
      const optionTitle = document.createElement("strong");
      optionTitle.textContent = node?.label || edge.to;
      const semanticBadge = document.createElement("span");
      const semanticKind = edgeFlowKind(edge) !== "normal"
        ? edgeFlowKind(edge)
        : edge.kind || "call";
      semanticBadge.className =
        `trace-branch-semantic trace-branch-semantic-${semanticKind}`;
      semanticBadge.textContent = relation;
      const optionMeta = document.createElement("small");
      optionMeta.textContent = [
        executionOrder
          ? `第 ${String(executionOrder).padStart(2, "0")} 步`
          : "",
        location,
      ].filter(Boolean).join(" · ");
      const optionHeading = document.createElement("span");
      optionHeading.className = "trace-branch-option-heading";
      optionHeading.append(optionTitle, semanticBadge);
      optionCopy.append(optionHeading, optionMeta);
      const optionArrow = document.createElement("span");
      optionArrow.className = "trace-branch-option-arrow";
      optionArrow.setAttribute("aria-hidden", "true");
      optionArrow.textContent = "→";
      option.append(optionIndex, optionCopy, optionArrow);
      option.title = [
        `${edge.id} → ${node?.label || edge.to}`,
        relation,
        edge.condition ? `条件：${edge.condition}` : "",
      ].filter(Boolean).join(" · ");
      return option;
    },
  );
  elements.traceBranchMenu.replaceChildren(...menuOptions);
  elements.traceBranchTrigger.title = `选择右箭头继续跟随的${groupLabel}`;
}

function setTraceBranchMenuOpen(open) {
  const shouldOpen = Boolean(open && !elements.traceBranchWrap.hidden);
  elements.traceBranchMenu.hidden = !shouldOpen;
  elements.traceBranchTrigger.setAttribute("aria-expanded", String(shouldOpen));
  elements.traceBranchWrap.classList.toggle("open", shouldOpen);
}

function configureTraceButton(button, node, title) {
  button.disabled = !node;
  button.title = title;
  button.dataset.traceNodeId = node?.id || "";
  button.querySelector("strong").textContent = node?.label || "—";
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
  state?.select(target, { preserveFocusAnchor: true });
  setStatus(`已在网页内预览 ${target.type === "edge" ? "调用位置" : "节点源码"}`);
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
