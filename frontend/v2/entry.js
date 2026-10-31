import { callReading, callMeaning } from './call-reading.js';
import { Graph } from '@antv/g6';
import './window-minimap.js';
import './directional-edge.js';
import { separateTracks } from './separate-tracks.js';
import { routeChannels } from './route-channels.js';
import { stablePositions } from './stable-positions.js';
import { edgeMenu } from './edge-menu.js';
import { LibraryTree } from './library-tree.js';
import { executionCards, branchAction } from './execution-node.js';
import { GraphWindow, layerPositions } from './graph-window.js';
import { PathWindow } from './path-window.js';
import { indexGraph } from './graph-index.js';
import { edgeLanes, edgePorts } from './edge-lanes.js';
import { RenderWindow, viewportBounds, containsBounds } from './render-window.js';
import { CallgraphApi } from '../../public/js/api.js';

const api = new CallgraphApi();
const $ = (id) => document.getElementById(id);
let catalog = [], names = new Map(), current, renderer, activeSlug, wantedSlug;
let loading = false, routeVersion = 0, sourceRequest, graphIndex, graphWindow, visibleGraph;
let drawing = false, elementStates = new Map();
let mountedDetail = true;
let renderedEdge = new Map(), edgeMembers = new Map();
let paintWindow, mountedIds = new Set(), paintedBounds, viewportFrame, mountBusy = false, mountPromise = Promise.resolve(), mountAgain = false, draggingNode = false;
const contextMenu = edgeMenu(id => changeBranch(id, 'collapse'));
$('canvas').tabIndex = 0;
let gesture = null;
// Measure total excursion, not just release displacement (a drag may return to its origin).
$('canvas').addEventListener('pointerdown', event => {
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: event.button !== 0 };
}, true);
const trackPointer = event => {
  if (gesture?.id === event.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.moved = true;
};
window.addEventListener('pointermove', trackPointer, true);
window.addEventListener('pointerup', trackPointer, true);
window.addEventListener('pointercancel', () => { if (gesture) gesture.moved = true; }, true);
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
// G6 merges shape attributes on redraw: every non-dim state must restore opacity.
function graphAppearance() {
  const css = getComputedStyle(document.documentElement);
  const color = name => css.getPropertyValue(`--${name}`).trim();
  return {
    node: { type: 'execution-card', style: {
      opacity: 1, ports: d => d.data.ports || [], size: d => [304, d.data.height], radius: 12, label: false,
      fill: d => color(`card-${d.data.tone}-bg`),
      stroke: d => color(`card-${d.data.tone}-line`), lineWidth: 1,
      shadowColor: color('card-shadow'), shadowBlur: 0, shadowOffsetY: 0,
      cardTitle: d => d.data.label, cardCategory: d => d.data.category,
      cardPurpose: d => d.data.purpose, cardClass: d => d.data.className,
      cardDirection: () => $('direction').querySelector('input:checked').value, cardControlFill: color('panel'),
      cardMore: d => d.data.more || '', cardExpand: d => d.data.canExpand, cardCollapse: d => d.data.canCollapse,
      cardText: color('muted'),
      cardTitleColor: color('strong'), cardAccent: d => color(`card-${d.data.tone}-text`),
    }, state: { selected: { opacity: 1, fill: color('active'), stroke: color('accent'), lineWidth: 2, halo: false }, related: { opacity: 1, stroke: color('graph-related'), lineWidth: 1.5, halo: false }, dim: { opacity: 0.25 } } },
        edge: { type: d => d.type || 'cubic-vertical', style: { labelFill: color('muted'), labelBackground: true, labelBackgroundFill: color('bg'), labelPadding: [2,4], labelFontSize: 11, opacity: 1, stroke: color('graph-edge'), lineWidth: 1, endArrow: true, radius: 6 }, state: { selected: { opacity: 1, stroke: color('accent'), lineWidth: 2, halo: false }, dim: { opacity: 0.12 } } },
  };
}

$('appearance').value = document.documentElement.dataset.theme;
$('appearance').addEventListener('change', async () => {
  const theme = $('appearance').value;
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('callgraph-v2-theme', theme); } catch {}
  if (!renderer || loading) return;
  const view = renderer;
  $('appearance').disabled = true;
  try {
    view.setOptions(graphAppearance());
    await view.draw(); // Redraw styles only; retain positions, camera and selected states.
  } catch (error) { if (view === renderer) status(error.message, true); }
  finally { $('appearance').disabled = loading; }
});

function status(message, error = false) {
  $('status').textContent = message;
  $('status').dataset.error = String(error);
}

const tree = new LibraryTree({
  container: $('catalog'), api, onSelect: slug => navigate(slug), notify: status,
  onChange: graphs => { catalog = graphs; $('graph-count').textContent = String(graphs.length); },
  onRemoved: (slug, graphs) => {
    if (slug !== wantedSlug) return;
    const next = graphs.find(g => g.projectId === current?.projectId) || graphs[0];
    if (next) { navigate(next.slug); return; }
    wantedSlug = undefined; activeSlug = undefined; routeVersion++;
    sourceRequest?.abort(); renderer?.destroy(); renderer = null; current = null;
    resetInspector(); $('symbols').replaceChildren(); $('title').textContent = '选择一个调用图';
    $('summary').textContent = '目录为空，可从回收站恢复调用图。'; $('stats').textContent = '—';
    $('coverage').hidden = true; $('fit').disabled = true;
    const url = new URL(location.href); url.searchParams.delete('graph'); history.replaceState({}, '', url);
  },
});
function renderCatalog() { tree.setData(catalog, names); tree.select(wantedSlug); }

function navigate(slug, history = true) {
  contextMenu.close();
  if (!slug || (slug === activeSlug && slug === wantedSlug && renderer && !loading)) return;
  wantedSlug = slug; routeVersion++;
  sourceRequest?.abort();
  if (history) {
    const url = new URL(location.href); url.searchParams.set('graph', slug);
    window.history.pushState({}, '', url);
  }
  renderCatalog();
  void drain();
}

async function drain() {
  if (loading) return;
  loading = true;
  try {
    while (wantedSlug && wantedSlug !== activeSlug) {
      const slug = wantedSlug, version = routeVersion;
      status('正在加载调用图…'); setControlsBusy(true); $('fit').disabled = true; $('appearance').disabled = true;
      let data;
      try { data = await api.loadGraph(slug); }
      catch (error) { if (version === routeVersion) { status(error.message, true); break; } continue; }
      if (version !== routeVersion) continue;
      renderer?.destroy(); renderer = null;
      elementStates = new Map();
      current = data; graphWindow = createWindow(data);
      $('window-size').value = slug === 'codex-cli-startup-lsp' ? '10' : '50';
      $('window-unit').value = 'layers';
      graphWindow.reset(batchSize(), $('window-unit').value);
      visibleGraph = graphWindow.snapshot(); graphIndex = indexGraph(visibleGraph); activeSlug = slug;
      gesture = null; resetInspector();
      $('title').textContent = data.title; $('summary').textContent = data.description;
      updateWindowStats();
      renderCoverage(api.analysisCoverage(data));
      renderSymbols();
      renderer = new Graph({
        container: $('canvas'), autoResize: false, animation: false, padding: 35,
        data: windowData(),
        ...graphAppearance(),
        plugins: [{ type: 'window-minimap', key: 'overview', getWindow: () => paintWindow,
          size: [220, 140], position: 'right-bottom', delay: 100,
          className: 'graph-minimap',
          containerStyle: { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px', margin: '12px' },
          maskStyle: { border: '1px solid var(--accent)', background: 'var(--active-line)', opacity: '0.6', minWidth: '4px', minHeight: '4px', boxSizing: 'border-box' },
        }],
        behaviors: ['drag-canvas', 'zoom-canvas', { type: 'drag-element', enable: event => !gesture?.branchAction && !branchAction(event) }],
      });
      const createdView = renderer;
      renderer.on('aftertransform', scheduleViewport);
      renderer.on('aftertransform', contextMenu.close);
      renderer.on('node:dragstart', () => { draggingNode = true; });
      renderer.on('node:dragend', () => {
        if (renderer !== createdView) return;
        for (const n of renderer.getNodeData()) paintWindow.move(n.id, renderer.getElementPosition(n.id));
        draggingNode = false; scheduleViewport();
      });
      renderer.on('node:pointermove', event => {
        const action = branchAction(event);
        $('canvas').title = action === 'expand' ? `展开下游 · 最多 ${batchSize()} ${$('window-unit').value === 'layers' ? '层' : '个新节点'}` : action === 'collapse' ? '收起下游' : '';
      });
      renderer.on('node:pointerleave', () => { $('canvas').title = ''; });
      renderer.on('node:pointerdown', event => { if (gesture) gesture.branchAction = branchAction(event); });
      renderer.on('node:click', event => {
        if (gesture?.moved) return;
        const action = branchAction(event);
        if (action) void changeBranch(event.target.id, action);
        else void select('node', event.target.id);
      });
      const openBranchMenu = event => {
        event.preventDefault();
        if (loading || drawing) return;
        const edge = graphIndex.edges.get(event.target.id);
        const target = event.targetType === 'node' ? graphIndex.nodes.get(event.target.id) : edge && graphIndex.nodes.get(edge.to);
        if (!target) return;
        contextMenu.open({ id: target.id, label: target.label, enabled: graphWindow.collapsible(target.id),
          x: event.client?.x ?? event.clientX ?? 0, y: event.client?.y ?? event.clientY ?? 0 });
      };
      renderer.on('edge:contextmenu', openBranchMenu);
      renderer.on('node:contextmenu', openBranchMenu);
      renderer.on('edge:click', event => { if (!gesture?.moved) void select('edge', event.target.id); });
      renderer.on('canvas:click', () => { if (!gesture?.moved) clearSelection(); });
      await renderer.render();
      updateWindowStats();
      if (version !== routeVersion) continue;
      // G6 installs a 100 ms / 10 px drag gate by default. Remove the hold
      // delay and match our click-versus-drag excursion threshold above.
      renderer.getCanvas().getLayer('main').getConfig().renderer.setConfig({ enableDirtyRectangleRendering: false, enableCulling: true });
      renderer.getCanvas().getLayer('main').getConfig().renderer
        .getPlugin('dragndrop').setOptions({ dragstartTimeThreshold: 0, dragstartDistanceThreshold: 5 });
      if (!virtualized()) await renderer.fitView({}, false);
      if (virtualized() || renderer.getZoom() < 0.85) {
        await renderer.zoomTo(0.85, false);
        await renderer.focusElement(data.root, false);
      }
      $('fit').disabled = false;
      status(data.analysis ? '已加载 · 金色边框表示尚未查询下游。静态关系不代表实际执行顺序。' : '已加载 · 从入口阅读，点击关系核对调用点。');
      clearSelection();
    }
  } catch (error) {
    status(`画布加载失败：${error.message}`, true);
    activeSlug = undefined;
  } finally { loading = false; setControlsBusy(drawing); $('appearance').disabled = false; scheduleViewport(); }
}

function renderCoverage(analysis) {
  $('coverage').hidden = !analysis; $('coverage-issues').replaceChildren();
  if (!analysis) return;
  $('coverage-title').textContent = `静态分析范围：已查询 ${analysis.queriedNodes.length} 个符号 · ${analysis.pendingNodes.length} 个待查询 · ${analysis.issues.length} 项边界说明`;
  $('coverage-scope').textContent = `${analysis.provider}。深度预算 ${analysis.maxDepth}，请求预算 ${analysis.requestBudget}。仅当前项目内静态关系；未证明业务链路完整。`;
  $('coverage').open = false;
}

let symbolMatches = [], symbolOffset = 0;
function appendSymbols() {
  const fragment = document.createDocumentFragment();
  for (const item of symbolMatches.slice(symbolOffset, symbolOffset + 100)) {
    if ([...$('symbols').options].some(option => option.value === item.id)) continue;
    const option = node('option', item.label); option.title = `${item.file}:${item.line}`; option.value = item.id; fragment.append(option);
  }
  symbolOffset += 100; $('symbols').append(fragment);
  $('symbols-more').hidden = symbolOffset >= symbolMatches.length;
  $('symbols-more').textContent = `继续加载符号（共 ${symbolMatches.length} 个匹配）`;
}
function renderSymbols() {
  const query = $('symbol-filter').value.trim().toLowerCase();
  symbolMatches = (current?.nodes || []).filter(item => `${item.label} ${item.file} ${item.id}`.toLowerCase().includes(query));
  symbolOffset = 0;
  const placeholder = node('option', '选择符号…'); placeholder.value = '';
  $('symbols').replaceChildren(placeholder); appendSymbols();
}
$('symbols-more').addEventListener('click', appendSymbols);

function resetInspector() {
  sourceRequest?.abort(); sourceRequest = null;
  $('canvas').dataset.selection = '';
  $('symbols').value = '';
  $('selection-title').textContent = '选择符号或调用关系';
  $('selection-description').textContent = '选中后高亮链路，并在这里核对源码。单击画布空白处取消选择。';
  $('relations').replaceChildren();
  $('source-location').textContent = '';
  $('source').textContent = '等待选择';

}

function clearSelection() {
  resetInspector();
  if (!renderer || !current) return;
  const view = renderer;
  const states = Object.fromEntries([...visibleGraph.nodes, ...visibleGraph.edges].map(item => [item.id, []]));
  applyStates(view, states);
}

async function select(type, id, focus = false) {
  const data = current, slug = activeSlug, version = routeVersion, view = renderer;
  if (!data || slug !== wantedSlug || drawing) return;
  if (type === 'node' && !graphWindow.visible.has(id)) {
    id = graphWindow.reveal(id) || id; await redrawWindow();
    if (version !== routeVersion || view !== renderer) return;
  }
  if (type === 'edge') {
    const edge = graphIndex.edges.get(id);
    if (edge && (!graphWindow.visible.has(edge.from) || !graphWindow.visible.has(edge.to))) {
      graphWindow.reveal(edge.from); graphWindow.reveal(edge.to); await redrawWindow();
      if (version !== routeVersion || view !== renderer) return;
    }
  }
  const item = (type === 'node' ? graphIndex.nodes : graphIndex.edges).get(id);
  if (!item) return;
  if (focus && view.getZoom() < .35) await view.zoomTo(.85, false);
  const renderId = type === 'edge' ? renderedEdge.get(id) || id : id;
  if (!mountedIds.has(renderId)) {
    const endpoint = type === 'node' ? id : item.from;
    await mountAt(endpoint);
    if (version !== routeVersion || view !== renderer) return;
  }
  if (focus) {
    await view.focusElement(renderId, false);
    if (version !== routeVersion || view !== renderer) return;
  }
  sourceRequest?.abort(); sourceRequest = new AbortController();
  const request = sourceRequest;
  $('canvas').dataset.selection = id;
  $('selection-title').textContent = type === 'node' ? item.label : `${graphIndex.nodes.get(item.from)?.label || item.from} → ${graphIndex.nodes.get(item.to)?.label || item.to}`;
  $('selection-description').textContent = (item.pathCycle ? '回环引用：递归或已标注的回环关系，不再向下复制。' : item.pathReference ? '共享方法在当前路径中的引用，与其他引用对应同一份源码。' : '') + (item.description || item.role || item.evidence || '');
  $('relations').replaceChildren();

  const selectedNodes = new Set(type === 'node' ? [id] : [item.from, item.to]);
  const selectedEdges = new Set(type === 'edge' ? [id] : []);
  if (type === 'node') {
    const context = graphIndex.context(id);
    for (const value of context.nodes) selectedNodes.add(value);
    for (const value of context.edges) selectedEdges.add(value);
  }
  const states = {};
  for (const n of visibleGraph.nodes) states[n.id] = n.id === id ? ['selected'] : selectedNodes.has(n.id) ? ['related'] : ['dim'];
  for (const e of visibleGraph.edges) states[e.id] = selectedEdges.has(e.id) ? ['selected'] : ['dim'];
  // Source loading is independent of drawing so a slow preview never locks the canvas.
  applyStates(view, states);
  if (type === 'node') {
    const sourceId = item.sourceId || id;
    if (![...$('symbols').options].some(option => option.value === sourceId)) {
      const option = node('option', item.label); option.value = sourceId; $('symbols').append(option);
    }
    $('symbols').value = sourceId;
    const reading = callReading(graphIndex.outgoing.get(id) || []);
    if (reading.note) $('relations').append(node('p', reading.note));
    for (const edge of new Set([...reading.calls, ...graphIndex.incoming.get(id)])) {
      const otherId = edge.from === id ? edge.to : edge.from;
      const other = graphIndex.nodes.get(otherId);
      const button = node('button', `${edge.from === id ? '调用 →' : '来自 ←'} ${other?.label || otherId} · 调用点 ${edge.line || '—'}`);
      button.addEventListener('click', () => { void select('edge', edge.id); }); $('relations').append(button);
    }
    if (item.sourceId) {
      const incoming = graphWindow.source.incoming.get(item.sourceId) || [];
      const details = node('details'); details.append(node('summary', `原始调用点：${incoming.length} 个入向关系`));
      for (const edge of incoming) {
        const caller = graphWindow.source.nodes.get(edge.from);
        const button = node('button', `${caller?.label || edge.from} · ${edge.file}:${edge.line}`);
        button.addEventListener('click', () => { void select('node', edge.from, true); }); details.append(button);
      }
      $('relations').append(details);
    }
  } else {
    $('relations').append(node('p', callMeaning(item)));
    const members = edgeMembers.get(renderedEdge.get(id)) || [id];
    if (members.length > 1) {
      $('relations').append(node('p', `此连线包含 ${members.length} 个调用关系，可逐一核对：`));
      for (const member of members) {
        const original = graphIndex.edges.get(member);
        const button = node('button', `调用点 ${original.file || ''}:${original.line || '—'}`);
        button.addEventListener('click', () => { void select('edge', member); });
        $('relations').append(button);
      }
    }
    for (const endpoint of [item.from, item.to]) {
      const target = graphIndex.nodes.get(endpoint);
      const button = node('button', `查看符号 ${target?.label || endpoint}`);
      button.addEventListener('click', () => { void select('node', endpoint); }); $('relations').append(button);
    }
  }
  $('source-location').textContent = item.file ? `${item.file}:${item.line}` : '无精确源码位置';
  $('source').textContent = '正在读取源码…';
  if (type === 'edge' && item.callSiteStatus && item.callSiteStatus !== 'exact') { $('source').textContent = item.callSiteNote || '此关系未提供精确调用点。'; return; }
  try {
    const source = await api.previewSource(slug, type, item.sourceId || id, 5, 'target', request.signal);
    if (request !== sourceRequest || version !== routeVersion) return;
    $('source').replaceChildren(...source.lines.map(line => node('span', `${String(line.number).padStart(4)}  ${line.text}`, line.focus ? 'focus' : '')));
  } catch (error) {
    if (request !== sourceRequest || version !== routeVersion || error.name === 'AbortError') return;
    $('source').replaceChildren(node('span', error.message, 'error'));
  }
}



function virtualized() { return paintWindow?.data.nodes.length > 300; }
function mountedData(data) {
  mountedIds = new Set([...data.nodes, ...data.edges].map(n => n.id));
  $('canvas').dataset.displayedNodes = String(visibleGraph.nodes.length);
  $('canvas').dataset.mountedNodes = String(data.nodes.length);
  mountedDetail = (renderer?.getZoom() || .85) >= .25;
  return { nodes: data.nodes.map(n => ({ ...n, type: mountedDetail ? 'execution-card' : 'rect', states: elementStates.get(n.id) || [] })),
    edges: data.edges.map(e => ({ ...e, states: combinedEdgeState(e.id) })) };
}
function scheduleViewport() {
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => { void refreshViewport(); });
}
async function refreshViewport(force = false, center) {
  if (!renderer || !virtualized() || loading || drawing || draggingNode) return;
  if (mountBusy) {
    mountAgain = true;
    if (force) { const waitingView = renderer; await mountPromise.catch(() => {}); if (waitingView === renderer) return refreshViewport(force, center); }
    return;
  }
  const view = renderer, version = routeVersion;
  const [width, height] = view.getSize(), zoom = view.getZoom();
  center ||= view.getCanvasByViewport([width / 2, height / 2]);
  const inner = viewportBounds(center, width, height, zoom, 50);
  if (!force && mountedDetail === (zoom >= .25) && containsBounds(paintedBounds, inner)) return;
  mountBusy = true;
  try {
    paintedBounds = viewportBounds(center, width, height, zoom);
    const slice = paintWindow.slice(paintedBounds);
    const ids = new Set([...slice.nodes, ...slice.edges].map(n => n.id));
    if (mountedDetail !== (zoom >= .25) || ids.size !== mountedIds.size || [...ids].some(id => !mountedIds.has(id))) {
      view.setData(mountedData(slice)); mountPromise = view.draw(); await mountPromise;
    }
  } catch (error) { if (version === routeVersion && view === renderer) status(error.message, true); }
  finally { mountBusy = false; if (mountAgain) { mountAgain = false; scheduleViewport(); } }
}
async function mountAt(id) {
  const position = paintWindow.nodes.get(id)?.style;
  if (position) await refreshViewport(true, [position.x, position.y]);
}
async function fitLogicalGraph() {
  if (!renderer || drawing || loading) return;
  if (!virtualized()) { await renderer.fitView({}, false); return; }
  const view = renderer, nodes = paintWindow.data.nodes;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const n of nodes) {
    left = Math.min(left, n.style.x - 170); right = Math.max(right, n.style.x + 170);
    top = Math.min(top, n.style.y - 90); bottom = Math.max(bottom, n.style.y + 90);
  }
  const [width, height] = view.getSize();
  await view.zoomTo(Math.min(width / (right - left + 70), height / (bottom - top + 70)), false);
  const center = view.getViewportByCanvas([(left + right) / 2, (top + bottom) / 2]);
  await view.translateBy([width / 2 - center[0], height / 2 - center[1]], false);
  await refreshViewport(true);
}

function combinedEdgeState(id) {
  const states = (edgeMembers.get(id) || [id]).map(member => elementStates.get(member) || []);
  if (states.some(state => state.includes('selected'))) return ['selected'];
  if (states.every(state => state.includes('dim'))) return ['dim'];
  return [];
}
function applyStates(view, states) {
  const changes = {}, touched = new Set();
  for (const [id, next] of Object.entries(states)) {
    const previous = elementStates.get(id) || [];
    if (previous.join(',') === next.join(',')) continue;
    elementStates.set(id, next);
    const rendered = renderedEdge.get(id);
    if (rendered) touched.add(rendered);
    else if (mountedIds.has(id)) changes[id] = next;
  }
  for (const id of touched) if (mountedIds.has(id)) changes[id] = combinedEdgeState(id);
  if (Object.keys(changes).length) void view.setElementState(changes, false).catch(error => {
    if (view === renderer) { elementStates.clear(); status(error.message, true); }
  });
}
function setControlsBusy(busy) {
  for (const id of ['view-mode', 'direction', 'apply-window', 'window-size', 'window-unit']) $(id).disabled = busy;
}
function createWindow(data) { return $('view-mode').value === 'paths' ? new PathWindow(data) : new GraphWindow(data); }
function batchSize() {
  const n = Number($('window-size').value);
  return Number.isSafeInteger(n) && n > 0 ? n : 50;
}
function windowData(anchor = current.root, preservePositions = false) {
  const direction = $('direction').querySelector('input:checked').value;
  let positions = layerPositions(visibleGraph, direction);
  if (preservePositions && paintWindow) {
    const previous = new Map(paintWindow.data.nodes.map(n => [n.id, n.style]));
    positions = stablePositions(visibleGraph, positions, previous, direction, anchor);
  }
  const edges = edgeLanes(visibleGraph.edges, elementStates, direction);
  renderedEdge = new Map(); edgeMembers = new Map();
  for (const edge of edges) {
    edgeMembers.set(edge.id, edge.data.memberIds);
    for (const id of edge.data.memberIds) renderedEdge.set(id, edge.id);
  }
  routeChannels(edges, positions, direction, true, anchor);
  const ports = edgePorts(edges, direction, positions);
  const data = {
    nodes: executionCards(visibleGraph).map(n => {
      n.data.ports = ports.get(n.id) || [];
      n.data.more = '';
      const count = graphWindow.hiddenChildren(n.id);
      const source = graphIndex.nodes.get(n.id);
      if (source.pathCycle) n.data.more = '↩ 回环引用 · 停止展开';
      else if (count) n.data.more = `${source.pathReference ? '共享引用 · ' : ''}＋ ${count} 个直接下游待展开`;
      else if (source.pathReference) n.data.more = '共享方法引用';
      // Reserve status space from immutable topology, not the current window.
      // Collapsing adds a hint, but must never resize the node or move its control.
      const sourceIndex = graphWindow.source || graphWindow.index;
      const hasStatus = source.pathReference || source.pathCycle ||
        (sourceIndex.outgoing.get(source.sourceId || source.id)?.length > 0);
      if (hasStatus) n.data.height += 24;
      n.data.canExpand = count > 0;
      n.data.canCollapse = (graphIndex.outgoing.get(n.id) || []).some(e => e.to !== n.id && e.flowKind !== 'loop-back');
      return { ...n, style: positions.get(n.id), states: elementStates.get(n.id) || [] };
    }),
    edges,
  };
  separateTracks(data, direction);
  paintWindow = new RenderWindow(data);
  const position = positions.get(anchor) || positions.get(current.root);
  paintedBounds = viewportBounds([position.x, position.y], $('canvas').clientWidth, $('canvas').clientHeight, renderer?.getZoom() || .85);
  return mountedData(virtualized() ? paintWindow.slice(paintedBounds) : data);
}
function updateWindowStats() {
  const unique = new Set(visibleGraph.nodes.map(n => n.sourceId || n.id)).size;
  $('stats').textContent = `已展示 ${unique} / ${current.nodes.length} 个符号 · ${visibleGraph.nodes.length} 个${$('view-mode').value === 'paths' ? '路径引用' : '节点'} · ${visibleGraph.edges.length} 条调用关系 · ${edgeMembers.size || visibleGraph.edges.length} 条展示连线`;
}
async function redrawWindow(anchor, preservePositions = false) {
  contextMenu.close();
  if (!renderer || loading || drawing) return;
  const view = renderer, version = routeVersion;
  await mountPromise.catch(() => {});
  if (view !== renderer || version !== routeVersion) return;
  const before = anchor && graphWindow.visible.has(anchor) ? view.getViewportByCanvas(view.getElementPosition(anchor)) : null;
  drawing = true; setControlsBusy(true);
  try {
    visibleGraph = graphWindow.snapshot(); graphIndex = indexGraph(visibleGraph);
    view.setData(windowData(anchor, preservePositions)); await view.draw();
    if (version !== routeVersion || view !== renderer) return;
    if (before) {
      const after = view.getViewportByCanvas(view.getElementPosition(anchor));
      await view.translateBy([before[0] - after[0], before[1] - after[1]], false);
    }
    updateWindowStats();
  } catch (error) { if (view === renderer) status(error.message, true); }
  finally { drawing = false; setControlsBusy(loading); }
}
$('apply-window').addEventListener('click', async () => {
  if (!graphWindow || loading || drawing) return;
  const version = routeVersion;
  $('window-size').value = batchSize();
  graphWindow.reset(batchSize(), $('window-unit').value);
  resetInspector(); await redrawWindow();
  if (version !== routeVersion) return;
  clearSelection(); await renderer.focusElement(current.root, false);
});
$('view-mode').addEventListener('change', async () => {
  if (!current || loading || drawing) return;
  graphWindow = createWindow(current); elementStates.clear();
  graphWindow.reset(batchSize(), $('window-unit').value);
  resetInspector(); await redrawWindow();
  if (renderer) await renderer.focusElement(current.root, false);
});
$('direction').addEventListener('change', async () => {
  if (!graphWindow || loading || drawing) return;
  const id = $('canvas').dataset.selection, version = routeVersion;
  await redrawWindow(graphIndex.nodes.has(id) ? id : current.root);
  if (version === routeVersion && id) await select(graphIndex.nodes.has(id) ? 'node' : 'edge', id);
});
async function changeBranch(id, action) {
  if (!graphWindow || loading || drawing || !graphWindow.visible.has(id)) return;
  const version = routeVersion;
  const changed = action === 'collapse' ? graphWindow.collapse(id) : graphWindow.expand(id, batchSize(), $('window-unit').value);
  if (!changed) { status('下游仍被其他分支引用，已保留共享节点。'); return; }
  const selected = $('canvas').dataset.selection;
  const selectedType = graphIndex.nodes.has(selected) ? 'node' : 'edge';
  const retained = selectedType === 'node' ? graphWindow.visible.has(selected) : graphWindow.snapshot().edges.some(e => e.id === selected);
  elementStates.clear();
  if (selected && !retained) resetInspector();
  await redrawWindow(id, true);
  if (version !== routeVersion) return;
  if (selected && retained) await select(selectedType, selected);
  status(`已${action === 'collapse' ? '收起' : '展开'} ${changed} 个节点；原始调用数据保留。`);
}
$('coverage').addEventListener('toggle', () => {
  if (!$('coverage').open || $('coverage-issues').childElementCount || !current?.analysis) return;
  // Render a page only when requested, instead of creating thousands of hidden DOM nodes.
  let offset = 0;
  const more = node('button', '继续查看边界说明');
  const append = () => {
    const issues = current.analysis.issues;
    for (const issue of issues.slice(offset, offset + 100)) $('coverage-issues').append(node('li', issue));
    offset += 100; more.remove();
    if (offset < issues.length) $('coverage-issues').append(more);
  };
  more.addEventListener('click', append); append();
});

$('filter').addEventListener('input', () => tree.filter($('filter').value));
$('symbol-filter').addEventListener('input', renderSymbols);
$('symbols').addEventListener('change', async () => {
  if (!$('symbols').value) { clearSelection(); return; }
  await select('node', $('symbols').value, true);
});
$('fit').addEventListener('click', () => { void fitLogicalGraph(); });
let resizeFrame;
new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { renderer?.resize(); scheduleViewport(); }); }).observe($('canvas'));
window.addEventListener('popstate', () => navigate(new URL(location.href).searchParams.get('graph') || catalog[0]?.slug, false));
try {
  const [graphs, health] = await Promise.all([api.listGraphs(), api.health()]);
  catalog = graphs; names = new Map((health.projects || []).map(p => [p.id, p.name]));
  $('graph-count').textContent = String(catalog.length); renderCatalog(); void tree.refreshTrash();
  const slug = new URL(location.href).searchParams.get('graph') || catalog[0]?.slug;
  if (slug) navigate(slug, false); else status('尚无调用图。使用 analyze 命令生成图后刷新目录。');
} catch (error) { status(error.message, true); }
