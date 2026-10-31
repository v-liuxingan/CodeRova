import { newGraph } from './new-graph.js';
import { sidebarWidths } from './sidebar-widths.js';
import { sourceNavigation } from './source-navigation.js';
import { relationList } from './relation-list.js';
import { collectionDialog } from './collection-dialog.js';
import { editSession } from './edit-session.js';
import { entryPicker } from './entry-picker.js';
import { resumePanel } from './resume-panel.js';
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
import { layerPositions } from './graph-window.js';
import { PathWindow } from './path-window.js';
import { indexGraph } from './graph-index.js';
import { edgeLanes, edgePorts } from './edge-lanes.js';
import { RenderWindow, viewportBounds, containsBounds } from './render-window.js';
import { CallgraphApi, isImplementationCandidate, symbolPresentation } from '../../public/js/api.js';

const api = new CallgraphApi({drafts:true});
const $ = (id) => document.getElementById(id);
const sourceNavigationController = sourceNavigation({api, toggle:$('click-source'), button:$('open-source'), editor:$('source-editor'), notify:status});
const collectionOrigins=new Map();
const resume = resumePanel(api, async (slug,action) => {
  activeSlug = undefined;
  await navigate(slug, false);
  if (activeSlug !== slug || wantedSlug !== slug || !renderer) throw new Error('结果未加载，请重试。');
  const origin=collectionOrigins.get(slug);
  if(origin && (action==='accept'||action==='preview')) await select('node',graphIndex.nodes.has(origin.id)?origin.id:origin.sourceId,true);
  if(action==='accept'||action==='discard')collectionOrigins.delete(slug);
});
const collection = collectionDialog(task => resume.started(task));
let catalog = [], names = new Map(), current, renderer, activeSlug, wantedSlug;
let loading = false, routeVersion = 0, sourceRequest, graphIndex, graphWindow, visibleGraph;
let drawing = false, elementStates = new Map();
let mountedDetail = true;
let renderedEdge = new Map(), edgeMembers = new Map();
let paintWindow, mountedIds = new Set(), paintedBounds, viewportFrame, mountBusy = false, mountPromise = Promise.resolve(), mountAgain = false, draggingNode = false;
const contextMenu = edgeMenu(id => changeBranch(id, 'collapse'), collectNode, addEntry, pruneNode, hideNode);
let focusAfterLoad=null;
const picker=entryPicker(api,(slug,id)=>{if(wantedSlug===slug){focusAfterLoad=id;activeSlug=undefined;navigate(slug,false);}});
const hiddenNodes = new Map();
let changingVisibility = false;
const edits=editSession(api,()=>wantedSlug,()=>{const slug=wantedSlug;activeSlug=undefined;navigate(slug,false);});
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
      cardBadge: d => d.data.badge, cardTitle: d => d.data.label, cardCategory: d => d.data.category,
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
    if (next) return navigate(next.slug);
    wantedSlug = undefined; activeSlug = undefined; routeVersion++;
    sourceRequest?.abort(); renderer?.destroy(); renderer = null; current = null;
    resetInspector(); $('symbols').replaceChildren(); $('title').textContent = '选择一个调用图';
    $('summary').textContent = '目录为空，可从回收站恢复调用图。'; $('stats').textContent = '—';
    $('coverage').hidden = true; $('fit').disabled = true;
    const url = new URL(location.href); url.searchParams.delete('graph'); history.replaceState({}, '', url);
  },
});
function renderCatalog() { tree.setData(catalog, names); tree.select(wantedSlug); }

async function navigate(slug, history = true) {
  if(slug && wantedSlug && slug!==wantedSlug && !await edits.leave()) {
    const url=new URL(location.href);url.searchParams.set('graph',wantedSlug);window.history.replaceState({},'',url);renderCatalog();return;
  }
  contextMenu.close();
  if (!slug || (slug === activeSlug && slug === wantedSlug && renderer && !loading)) return;
  wantedSlug = slug; routeVersion++;
  sourceRequest?.abort();
  if (history) {
    const url = new URL(location.href); url.searchParams.set('graph', slug);
    window.history.pushState({}, '', url);
  }
  renderCatalog();
  return drain();
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
      paintWindow = null; current = data; graphWindow = createWindow(data);
      $('window-size').value = slug === 'codex-cli-startup-lsp' ? '10' : '50';
      $('window-unit').value = 'layers';
      graphWindow.reset(batchSize(), $('window-unit').value);
      visibleGraph = visibleSnapshot(); graphIndex = indexGraph(visibleGraph); activeSlug = slug;
      gesture = null; resetInspector();
      $('title').textContent = data.title; $('summary').textContent = data.description;
      updateWindowStats();
      renderCoverage(api.analysisCoverage(data));
      resume.setGraph(slug, data);
      renderSymbols();edits.update();updateHidden();
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
        else void select('node', event.target.id, false, true);
      });
      const openBranchMenu = event => {
        event.preventDefault();
        if (loading || drawing) return;
        const edge = graphIndex.edges.get(event.target.id);
        const target = event.targetType === 'node' ? graphIndex.nodes.get(event.target.id) : edge && graphIndex.nodes.get(edge.to);
        if (!target) return;
        contextMenu.open({ id: target.id, label: target.label, file:target.file, line:target.line, enabled: graphWindow.collapsible(target.id), isNode:event.targetType==='node',canCollect:canCollect(target.id),canAdd:Boolean(current.analysis),canPrune:(graphIndex.nodes.get(target.id)?.sourceId||target.id)!==current.root,
          x: event.client?.x ?? event.clientX ?? 0, y: event.client?.y ?? event.clientY ?? 0 });
      };
      renderer.on('edge:contextmenu', openBranchMenu);
      renderer.on('node:contextmenu', openBranchMenu);
      renderer.on('edge:click', event => { if (!gesture?.moved) void select('edge', event.target.id, false, true); });
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
      status('');
      clearSelection();
    }
  } catch (error) {
    status(`画布加载失败：${error.message}`, true);
    activeSlug = undefined;
  } finally { loading = false; setControlsBusy(drawing); $('appearance').disabled = false; scheduleViewport(); if(focusAfterLoad){const id=focusAfterLoad;focusAfterLoad=null;void select('node',id,true);} }
}

function updateHidden(){const count=hiddenNodes.get(wantedSlug)?.size||0;$('restore-hidden').hidden=!count;$('restore-hidden').textContent=`恢复隐藏（${count}）`;edits.update();}
function visibilityViewport(anchor = current.root) {
  const point = paintWindow.data.nodes.find(n => n.id === anchor)?.style || {x:0,y:0};
  const rect=$('canvas').getBoundingClientRect(), origin=renderer.getViewportByCanvas([point.x,point.y]);
  return { view:renderer, version:routeVersion, anchor, screen:[origin[0]+rect.left,origin[1]+rect.top] };
}
async function refreshVisibility({view,version,screen,anchor}=visibilityViewport()) {
  const selected = $('canvas').dataset.selection;
  await redrawWindow(anchor, true);
  if(view!==renderer || version!==routeVersion)return;
  renderSymbols();
  if (selected && !graphIndex.nodes.has(selected) && !graphIndex.edges.has(selected)) { clearSelection(); for (const key of elementStates.keys()) if (!graphIndex.nodes.has(key) && !graphIndex.edges.has(key)) elementStates.delete(key); }
  else if (selected) await select(graphIndex.nodes.has(selected) ? 'node' : 'edge', selected);
  updateHidden();
  // Resize and flush the camera before compensating for the edit bar.
  view.resize();
  await view.draw();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  if(view!==renderer || version!==routeVersion)return;
  const point = paintWindow.data.nodes.find(n => n.id === anchor)?.style || {x:0,y:0};
  const nextRect=$('canvas').getBoundingClientRect(), next=view.getViewportByCanvas([point.x,point.y]);
  await view.translateBy([screen[0]-next[0]-nextRect.left,screen[1]-next[1]-nextRect.top],false);
  scheduleViewport();
}
async function hideNode(id) {
  if (changingVisibility || drawing || loading) return;
  changingVisibility = true; setControlsBusy(true);
  const slug=activeSlug, version=routeVersion, sourceId=graphIndex.nodes.get(id)?.sourceId||id;
  try {
    const plan=await api.pruneNode(slug,sourceId);
    if(slug!==activeSlug || version!==routeVersion)return;
    const removed = new Set(plan.removedNodeIds);
    const ancestors = [id], seen = new Set(ancestors);
    let anchor = current.root;
    for (let i = 0; i < ancestors.length; i++) {
      const candidate = graphIndex.nodes.get(ancestors[i]);
      if (candidate && !removed.has(candidate.sourceId || candidate.id)) { anchor = candidate.id; break; }
      for (const edge of graphIndex.incoming.get(ancestors[i]) || []) {
        if (!seen.has(edge.from)) { seen.add(edge.from); ancestors.push(edge.from); }
      }
    }
    const viewport = visibilityViewport(anchor);
    const hidden=hiddenNodes.get(slug)||new Set();
    plan.removedNodeIds.forEach(n=>hidden.add(n));hiddenNodes.set(slug,hidden);
    await refreshVisibility(viewport);
    status('已临时隐藏，画布位置与展开状态保留。');
  } catch(error) { status(error.message,true); }
  finally { changingVisibility=false; setControlsBusy(loading || drawing); }
}
$('restore-hidden').onclick=async()=>{
  if(changingVisibility || drawing || loading)return;
  changingVisibility=true; setControlsBusy(true);
  try { hiddenNodes.delete(wantedSlug); await refreshVisibility(); status('已恢复隐藏节点，画布位置保持不变。'); }
  finally { changingVisibility=false; setControlsBusy(loading || drawing); }
};
document.addEventListener('click',async event=>{
  const anchor=event.target.closest('a[href]');if(!anchor||event.defaultPrevented||event.ctrlKey||event.metaKey||event.shiftKey||anchor.target==='_blank')return;
  const url=new URL(anchor.href);if(url.hash && url.pathname===location.pathname && url.search===location.search)return;
  if(!api.hasUnsaved(wantedSlug)&&!api.editBusy)return;
  event.preventDefault();if(await edits.leave())location.assign(anchor.href);
});
let pruning = false;
async function pruneNode(id) {
  if(pruning)return;
  pruning=true;
  const slug=activeSlug, sourceId=graphIndex.nodes.get(id)?.sourceId||id;
  try {
    const plan=await api.pruneNode(slug,sourceId);
    if(slug!==activeSlug)return;
    if(!window.confirm(`将从图数据中移除该方法的所有调用位置及其独占下游：${plan.removedNodeIds.length} 个节点、${plan.removedEdgeIds.length} 条连线。保留 ${plan.preservedSharedNodeIds.length} 个共享下游节点。不影响源码，点击“保存”后写入图文件。确定删除？`))return;
    await api.pruneNode(slug,sourceId,plan.revision);
    if(slug===activeSlug){activeSlug=undefined;navigate(slug,false);}
  }catch(error){status(error.message,true);}finally{pruning=false;}
}
function canCollect(id) {
  const sourceId=graphIndex.nodes.get(id)?.sourceId||id;
  return current?.analysis?.pendingNodes.includes(sourceId) && !current.edges.some(e=>e.from===sourceId);
}
let startingCollection = false;
async function collectNode(id) {
  if(startingCollection || resume.isRunning()){status('已有采集任务运行，请停止或等待结束后再提交。',true);return;}
  if(!canCollect(id)){status('只能采集没有已知下游的待采叶子节点。',true);return;}
  const sourceId=graphIndex.nodes.get(id)?.sourceId||id;
  const slug=activeSlug, version=routeVersion;
  collection.open(graphIndex.nodes.get(id), async budget => {
    if(version!==routeVersion || slug!==activeSlug || !canCollect(id))throw new Error('节点状态已变化，请重新选择。');
    if(startingCollection || resume.isRunning())throw new Error('已有采集任务运行，请等待结束或先停止。');
    startingCollection=true;
    try{const task=await api.analysisTask(slug,'POST',budget,sourceId);collectionOrigins.set(slug,{id,sourceId});return task;}
    finally{startingCollection=false;}
  });
}
function addEntry(id) {
  if(!current?.analysis)return;
  void picker.open(activeSlug,graphIndex.nodes.get(id)?.sourceId||id);
}
for(const [button,panel,cls] of [['toggle-library','project-library','library-collapsed'],['toggle-inspector','source-inspector','inspector-collapsed']]) {
  const label = panel === 'project-library' ? '项目栏' : '详情栏';
  const apply = collapsed => {
    document.querySelector('.workspace').classList.toggle(cls, collapsed);
    $(button).setAttribute('aria-expanded', String(!collapsed));
    $(button).setAttribute('aria-label', `${collapsed ? '展开' : '收起'}${label}`);
    $(button).title = `${collapsed ? '展开' : '收起'}${label}`;
    $(panel).inert = collapsed;
    try { localStorage.setItem(cls, String(collapsed)); } catch {}
  };
  let initial = false;
  try { initial = localStorage.getItem(cls) === 'true'; } catch {}
  apply(initial);
  $(button).addEventListener('click', () => apply($(button).getAttribute('aria-expanded') === 'true'));
}

function renderCoverage(analysis) {
  $('graph-details').open = false;
  $('analysis-brief').textContent = analysis ? '静态关系 · 非运行轨迹' : '说明与采集状态';
  $('coverage').hidden = !analysis; $('coverage-issues').replaceChildren();
  if (!analysis) return;
  $('coverage-title').textContent = `静态分析范围：已查询 ${analysis.queriedNodes.length} 个符号 · ${analysis.pendingNodes.length} 个待查询 · ${analysis.issues.length} 项边界说明${analysis.prunedNodeIds?.length ? ` · 已减枝 ${analysis.prunedNodeIds.length} 个符号` : ''}`;
  $('coverage-scope').textContent = `${analysis.provider}。初次采集深度 ${analysis.maxDepth}，初次请求预算 ${analysis.requestBudget}；页面续采按本轮预算继续。仅当前项目内静态关系，历史边界说明保留供核对；未证明业务链路完整。`;
  $('coverage').open = false;
}

let symbolMatches = [], symbolOffset = 0;
function appendSymbols() {
  const fragment = document.createDocumentFragment();
  for (const item of symbolMatches.slice(symbolOffset, symbolOffset + 100)) {
    if ([...$('symbols').options].some(option => option.value === item.id)) continue;
    const option = node('option', item.label); option.title = `${item.file}:${item.line}`; option.value = item.id; fragment.append(option);
  }
  symbolOffset = Math.min(symbolOffset + 100, symbolMatches.length); $('symbols').append(fragment);
  $('symbols-more').hidden = symbolOffset >= symbolMatches.length;
  $('symbols-more').textContent = `加载更多选项（${symbolOffset} / ${symbolMatches.length}）`;
  $('symbols-more').title = '加载到上方节点列表，不改变画布';
}
function renderSymbols() {
  const query = $('symbol-filter').value.trim().toLowerCase();
  symbolMatches = (current?.nodes || []).filter(item => !hiddenNodes.get(wantedSlug)?.has(item.id)).filter(item => `${item.label} ${item.file} ${item.id}`.toLowerCase().includes(query));
  symbolOffset = 0;
  $('symbol-load-status').textContent = '';
  const placeholder = node('option', '选择节点…'); placeholder.value = '';
  $('symbols').replaceChildren(placeholder); appendSymbols();
}
$('symbols-more').addEventListener('click', () => {
  appendSymbols();
  $('symbol-load-status').textContent = `已加载 ${symbolOffset} / ${symbolMatches.length}，请在上方列表选择`;
  if ($('symbols-more').hidden) $('symbols').focus();
});

function resetInspector() {
  sourceNavigationController.clear();
  sourceRequest?.abort(); sourceRequest = null;
  $('canvas').dataset.selection = '';
  $('symbols').value = '';
  $('inspector-heading').textContent='详情';
  $('selection-title').textContent = '未选择节点';
  $('node-actions-panel').replaceChildren();
  $('source').hidden=true;
  $('selection-notes').hidden=true;
  $('selection-notes').open=false;
  $('selection-description').textContent = '';
  $('relations').replaceChildren();
  $('source-location').textContent = '';
  $('source').textContent = '';

}

function clearSelection() {
  resetInspector();
  if (!renderer || !current) return;
  const view = renderer;
  const states = Object.fromEntries([...visibleGraph.nodes, ...visibleGraph.edges].map(item => [item.id, []]));
  applyStates(view, states);
}

async function openCall(parent, callId) {
  if (loading || drawing) return;
  const version = routeVersion, view = renderer;
  const edgeId = graphWindow.revealCall(parent, callId);
  if (!edgeId) return;
  if (!graphIndex.edges.has(edgeId)) await redrawWindow(parent, true);
  if (version !== routeVersion || view !== renderer) return;
  await select('edge', edgeId, true);
}

async function select(type, id, focus = false, clicked = false) {
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
  $('inspector-heading').textContent=type==='node'?'节点详情':item.kind==='trait-dispatch'?'多态关系':'调用详情';
  $('source').hidden=false;
  $('node-actions-panel').replaceChildren();
  $('selection-notes').open=false;
  $('selection-title').textContent = type === 'node' ? item.label : `${graphIndex.nodes.get(item.from)?.label || item.from} → ${graphIndex.nodes.get(item.to)?.label || item.to}`;
  $('selection-description').textContent = (item.pathCycle ? '回环引用：递归或已标注的回环关系，不再向下复制。' : item.pathReference ? '共享方法在当前路径中的引用，与其他引用对应同一份源码。' : '') + (item.description || item.role || item.evidence || '');
  if (type === 'node') { const facts = symbolPresentation(item); if(facts.type) $('selection-description').textContent = [facts.type, facts.detail, $('selection-description').textContent].filter(Boolean).join(' · '); }
  $('selection-notes').hidden=!$('selection-description').textContent.trim();
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
    if (current.analysis) {
      const actions=node('div');actions.className='node-actions';
      const collect=node('button','继续采集');collect.disabled=!canCollect(id);
      collect.title=collect.disabled?'仅没有已知下游的待采叶子节点可以采集':'从当前节点采集下游';
      collect.addEventListener('click',()=>void collectNode(id));
      const add=node('button','添加节点');add.addEventListener('click',()=>addEntry(id));
      actions.append(collect,add);$('node-actions-panel').append(actions);
    }
    const prune=node('button','删除');prune.disabled=sourceId===current.root;
    prune.addEventListener('click',()=>void pruneNode(id));
    const hide=node('button','隐藏');hide.disabled=sourceId===current.root;hide.addEventListener('click',()=>void hideNode(id));
    const editTools=node('details');editTools.className='node-edit-tools';editTools.append(node('summary','编辑节点'),hide,prune);$('node-actions-panel').append(editTools);
    const independentCalls = !item.pathCycle;
    const reading = callReading((independentCalls ? graphWindow.source.outgoing.get(sourceId) : graphIndex.outgoing.get(id)) || []);
    if(reading.note) { $('selection-description').textContent += ` ${reading.note}`; $('selection-notes').hidden=false; }
    if(reading.calls.length)$('relations').append(relationList(reading.calls.some(isImplementationCandidate) ? '下游方法与实现' : '直接调用点',reading.calls,edge=>{
      const other = (independentCalls ? graphWindow.source.nodes : graphIndex.nodes).get(edge.to);
      const button = node('button', isImplementationCandidate(edge) ? `${other?.label || edge.to}` : `调用 → ${other?.label || edge.to} · 调用点 ${edge.line || '—'}`);
      button.addEventListener('click', () => {
        if (independentCalls) void openCall(id, edge.id);
        else void select('edge', edge.id, true);
      });
      return button;
    },false));
    const callers=graphIndex.incoming.get(id)||[];
    if(callers.length)$('relations').append(relationList('当前路径的调用方',callers,edge=>{
      const otherId = edge.from === id ? edge.to : edge.from;
      const other = graphIndex.nodes.get(otherId);
      const button = node('button', `${edge.from === id ? '调用 →' : '来自 ←'} ${other?.label || otherId} · 调用点 ${edge.line || '—'}`);
      button.addEventListener('click', () => { void select('edge', edge.id); }); return button;
    },false));
    if (item.sourceId) {
      const incoming = graphWindow.source.incoming.get(item.sourceId) || [];
      if(incoming.length)$('relations').append(relationList('全部调用方',incoming,edge=>{
        const caller = graphWindow.source.nodes.get(edge.from);
        const button = node('button', `${caller?.label || edge.from} · ${edge.file}:${edge.line}`);
        button.addEventListener('click', () => { void select('node', edge.from, true); });
        return button;
      },false));
    }
  } else {
    $('relations').append(node('p', callMeaning(item)));
    const sourceEdgeId=item.sourceId||id;
    if(sourceEdgeId.startsWith('manual-async-') && item.kind==='async-boundary') {
      $('relations').append(node('p',item.evidence));
      const contextSlug=activeSlug, remove=node('button','撤销人工关联');
      remove.addEventListener('click',async()=>{remove.disabled=true;try{await api.removeManualLink(contextSlug,sourceEdgeId);if(wantedSlug===contextSlug){activeSlug=undefined;navigate(contextSlug,false);}}catch(error){remove.disabled=false;status(error.message,true);}});
      $('relations').append(remove);
    }

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
  sourceNavigationController.select(current, slug, type, item.sourceId || id, clicked);
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
  if (resizingSidebar && !force) return;
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
  busy ||= changingVisibility;
  for (const id of ['direction', 'apply-window', 'window-size', 'window-unit']) $(id).disabled = busy;
}
function createWindow(data) { return new PathWindow(data); }
function visibleSnapshot() {
  const data = graphWindow.snapshot(), hidden = hiddenNodes.get(wantedSlug);
  if (!hidden?.size) return data;
  const nodes = data.nodes.filter(n => !hidden.has(n.sourceId || n.id));
  const ids = new Set(nodes.map(n => n.id));
  return { ...data, nodes, edges: data.edges.filter(e => ids.has(e.from) && ids.has(e.to)) };
}
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
  const center = [position.x, position.y];
  paintedBounds = viewportBounds(center, $('canvas').clientWidth, $('canvas').clientHeight, renderer?.getZoom() || .85);
  return mountedData(virtualized() ? paintWindow.slice(paintedBounds) : data);
}
function updateWindowStats() {
  const unique = new Set(visibleGraph.nodes.map(n => n.sourceId || n.id)).size;
  $('stats').textContent = `已展示 ${unique} / ${current.nodes.length} 个符号 · ${visibleGraph.nodes.length} 个路径引用 · ${visibleGraph.edges.length} 条调用关系 · ${edgeMembers.size || visibleGraph.edges.length} 条展示连线`;
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
    visibleGraph = visibleSnapshot(); graphIndex = indexGraph(visibleGraph);
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
const displaySettings = $('display-settings');
document.addEventListener('pointerdown', event => {
  if (displaySettings.open && !displaySettings.contains(event.target)) displaySettings.open = false;
});
displaySettings.addEventListener('keydown', event => {
  if (event.key === 'Escape' && displaySettings.open) {
    event.preventDefault(); event.stopPropagation();
    displaySettings.open = false;
    displaySettings.querySelector('summary').focus();
  }
});
displaySettings.addEventListener('focusout', event => {
  if (event.relatedTarget && !displaySettings.contains(event.relatedTarget)) displaySettings.open = false;
});
$('apply-window').addEventListener('click', async () => {
  if (!graphWindow || loading || drawing) return;
  displaySettings.open = false;
  displaySettings.querySelector('summary').focus();
  const version = routeVersion;
  $('window-size').value = batchSize();
  graphWindow.reset(batchSize(), $('window-unit').value);
  resetInspector(); await redrawWindow();
  if (version !== routeVersion) return;
  clearSelection(); await renderer.focusElement(current.root, false);
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
let resizeFrame, resizingSidebar = false;
function scheduleCanvasResize() {
  cancelAnimationFrame(resizeFrame);
  if (resizingSidebar) return;
  resizeFrame = requestAnimationFrame(() => {
    if (changingVisibility || resizingSidebar) return;
    renderer?.resize();
    scheduleViewport();
  });
}
sidebarWidths(document.querySelector('.workspace'), { library:$('resize-library'), inspector:$('resize-inspector') }, {
  onDragChange(active) {
    // Keep the backing canvas intact while its container clips it during a drag.
    // Always flush on release/cancel, even if the last ResizeObserver already ran.
    resizingSidebar = active;
    if (active) cancelAnimationFrame(viewportFrame);
    scheduleCanvasResize();
  }
});
const creator = newGraph(api, result => location.assign(`/?graph=${encodeURIComponent(result.slug)}&collect=1`));
$('new-graph').onclick = async () => { if (await edits.leave()) await creator.open(); };
new ResizeObserver(scheduleCanvasResize).observe($('canvas'));
window.addEventListener('popstate', () => navigate(new URL(location.href).searchParams.get('graph') || catalog[0]?.slug, false));
try {
  const [graphs, health] = await Promise.all([api.listGraphs(), api.health()]);
  catalog = graphs; names = new Map((health.projects || []).map(p => [p.id, p.name]));
  $('graph-count').textContent = String(catalog.length); renderCatalog(); void tree.refreshTrash();
  const slug = new URL(location.href).searchParams.get('graph') || catalog[0]?.slug;
  if (slug) {
    await navigate(slug, false);
    const url = new URL(location.href);
    if (url.searchParams.has('collect')) {
      url.searchParams.delete('collect'); history.replaceState(null, '', url);
      const rootNode = [...graphIndex.nodes.values()].find(n => (n.sourceId || n.id) === current?.root);
      if (rootNode) await collectNode(rootNode.id);
    }
  } else status('尚无调用图。点击“新建图”选择源码入口。');
} catch (error) { status(error.message, true); }
