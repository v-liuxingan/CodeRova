import {libraryPreferences,libraryProjects} from '../js/library-catalog.js';
import { CodeRovaApi } from '../js/api.js';

const api = new CodeRovaApi(), home = document.getElementById('project-home');
document.querySelector('.header-actions a[href="/"]').hidden = true;
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const theme = document.getElementById('appearance');
theme.value = document.documentElement.dataset.theme;
theme.onchange = () => {
  document.documentElement.dataset.theme = theme.value;
  try { localStorage.setItem('callgraph-v2-theme', theme.value); } catch { /* Session preference. */ }
};
const heading = el('div', null, 'home-heading');
const intro = el('div'); intro.append(el('h2', '项目资料库'));
intro.lastChild.id = 'home-title';
const summary = el('p', '正在读取项目…', 'home-summary'); intro.append(summary);
const search = el('input'); search.type = 'search'; search.placeholder = '搜索项目、调用图或场景…'; search.setAttribute('aria-label', '搜索项目内容');
const tools = el('div', null, 'home-tools');
const manage = el('a', '管理目录 / 回收站'); manage.href = '/?view=workbench';
const create = el('button', '', 'primary');
create.setAttribute('aria-label', '新建图'); create.title = '开始';
create.classList.add('home-create');
const createIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
createIcon.setAttribute('viewBox', '0 0 20 20'); createIcon.setAttribute('aria-hidden', 'true');
const createPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
createPath.setAttribute('d', 'm3 9 14-6-6 14-2-6-6-2Zm6 2 8-8'); createIcon.append(createPath); create.prepend(createIcon);
let creator;
const start = el('section', null, 'home-start'); start.setAttribute('aria-label', '开始分析源码');
const composer = el('form', null, 'home-composer');
const analysisName = el('input'); analysisName.id = 'analysis-name'; analysisName.maxLength = 160;
analysisName.placeholder = '想理解哪段流程？'; analysisName.autocomplete = 'off';
analysisName.setAttribute('aria-label', '分析名称（可选）');
create.type = 'submit';
const startError = el('p', '', 'home-start-error'); startError.setAttribute('role', 'alert');
composer.append(analysisName, create, startError);
composer.onsubmit = async event => {
  event.preventDefault();
  if (create.disabled) return;
  create.disabled = true; startError.textContent = '';
  try {
    const {newGraph} = await import('/vendor/workbench/new-graph.js');
    creator ||= newGraph(api, result => location.assign(`/?graph=${encodeURIComponent(result.slug)}&collect=1`));
    await creator.open({title:analysisName.value.trim(), returnFocus:create});
  } catch(error) { startError.textContent = error.message; }
  finally { create.disabled = false; }
};
start.append(composer);
tools.append(manage); heading.append(intro, tools);
const toolbar = el('div', null, 'home-toolbar');
const searchLabel = el('label', '查找内容', 'home-search');
search.id = 'home-search'; searchLabel.htmlFor = search.id; searchLabel.append(search);
toolbar.append(searchLabel);
const index = el('nav', null, 'home-index'); index.setAttribute('aria-label', '项目索引');
const indexTitle = el('h2', '项目');
const indexLinks = el('div', null, 'home-index-links'); index.append(indexTitle, indexLinks);
const feedback = el('p', '', 'home-feedback'); feedback.setAttribute('role', 'status');
const projects = el('div', null, 'home-projects');
const content = el('div', null, 'home-content'); content.append(feedback, projects);
const body = el('div', null, 'home-body'); body.append(index, content);
const tabs=el('div',null,'home-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','工作区');
const createTab=el('button','开始分析'),libraryTab=el('button','项目资料库');
const library=el('section',null,'home-library');library.append(heading,toolbar,body);
start.id='home-create-panel';library.id='home-library-panel';
for(const [button,panel,id] of [[createTab,start,'home-create-tab'],[libraryTab,library,'home-library-tab']]) {
  button.type='button';button.id=id;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);
  panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',id);
  button.onclick=()=>switchTab(button===libraryTab);
  button.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const toLibrary=event.key==='End'||(event.key!=='Home'&&button===createTab);switchTab(toLibrary);(toLibrary?libraryTab:createTab).focus();}};
}
function switchTab(showLibrary) {
  start.hidden=showLibrary;library.hidden=!showLibrary;
  createTab.setAttribute('aria-selected',String(!showLibrary));libraryTab.setAttribute('aria-selected',String(showLibrary));
  createTab.tabIndex=showLibrary?-1:0;libraryTab.tabIndex=showLibrary?0:-1;
  const url=new URL(location.href);if(showLibrary)url.searchParams.set('view','projects');else url.searchParams.delete('view');
  history.replaceState(null,'',url);
}
tabs.append(createTab,libraryTab);home.append(tabs,start,library);
switchTab(new URLSearchParams(location.search).get('view')==='projects'||new URLSearchParams(location.search).has('project')||Boolean(location.hash));
let catalog = [], scenes = [], names = new Map(), groups = [];
function visibleProjects(){return libraryProjects(names,catalog,groups,libraryPreferences().removedProjects);}
function render() {
  projects.replaceChildren();
  indexLinks.replaceChildren();
  const query = search.value.trim().toLocaleLowerCase();
  const visible = visibleProjects();
  const ids = visible.keys();
  summary.textContent = `${visible.size} 个项目 · ${catalog.length} 张调用图 · ${scenes.length} 张场景地图`;
  let count = 0;
  for (const id of ids) {
    const name = names.get(id) || scenes.find(s => s.projectId === id)?.projectLabel || id || '未分类项目';
    const matches = item => `${name} ${item.title} ${item.category || ''}`.toLocaleLowerCase().includes(query);
    const graphs = catalog.filter(g => g.projectId === id && matches(g));
    const sequences = scenes.filter(s => s.projectId === id && matches(s));
    if (!graphs.length && !sequences.length && (query && !name.toLocaleLowerCase().includes(query))) continue;
    count += graphs.length + sequences.length;
    const section = el('section', null, 'home-project'); section.id = `project-${id}`;
    const jump = el('a'); jump.href = `#${encodeURIComponent(section.id)}`;
    jump.append(el('span', name), el('small', `${graphs.length} 张图`));
    indexLinks.append(jump);
    const head = el('div', null, 'home-project-heading');
    head.append(el('h2', name), el('span', [graphs.length && `${graphs.length} 张调用图`, sequences.length && `${sequences.length} 张场景地图`].filter(Boolean).join(' · ')));
    if(names.has(id)) {
      const settings=el('button','项目设置');settings.type='button';settings.onclick=async()=>{
        try{const {newGraph}=await import('/vendor/workbench/new-graph.js');creator ||= newGraph(api,result=>location.assign(`/?graph=${encodeURIComponent(result.slug)}&collect=1`));await creator.open({projectId:id,settings:true});}catch(e){feedback.textContent=e.message;}
      };head.append(settings);
    }
    section.append(head);
    if(!graphs.length&&!sequences.length) {
      const empty=el('p','暂无调用图。');const add=el('button','新建图');add.onclick=async()=>{const {newGraph}=await import('/vendor/workbench/new-graph.js');creator ||= newGraph(api,result=>location.assign(`/?graph=${encodeURIComponent(result.slug)}&collect=1`));await creator.open({projectId:id});};section.append(empty,add);
    }
    const groups = new Map();
    for (const graph of graphs) {
      const group = graph.category || '调用图';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(graph);
    }
    for (const [name, items] of groups) section.append(contentGroup(name, items, false));
    if (sequences.length) section.append(contentGroup('场景地图', sequences, true));
    projects.append(section);
  }
  const references=scenes.filter(scene=>!names.has(scene.projectId)&&!catalog.some(g=>g.projectId===scene.projectId)).filter(scene=>`${scene.projectLabel || scene.projectId} ${scene.title}`.toLocaleLowerCase().includes(query));
  if(references.length){const section=el('section',null,'home-reference-scenes');section.append(contentGroup('参考场景 · 未接入项目',references,true));projects.append(section);count+=references.length;}
  feedback.textContent = count ? '' : query ? '没有匹配的内容。试试项目名或方法名。' : '暂无调用图。点击“新建图”，从源码入口开始。';
  index.hidden = !count;
}
function contentGroup(name, items, scene) {
  const group = el('div', null, 'home-group'); group.append(el('h3', name));
  const list = el('ul', null, 'home-links');
  for (const item of items) {
    const link = el('a');
    link.href = scene ? `/scenes/${encodeURIComponent(item.slug)}.html` : `/?graph=${encodeURIComponent(item.slug)}`;
    const text = el('span', item.title, 'home-link-title');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('viewBox', '0 0 16 16'); arrow.setAttribute('aria-hidden', 'true'); arrow.classList.add('home-arrow');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M3 8h10M9 4l4 4-4 4'); arrow.append(path);
    link.append(el('span', scene ? '时序' : '调用', 'home-kind'), text, arrow);
    const row = el('li'); row.append(link); list.append(row);
  }
  group.append(list); return group;
}
search.addEventListener('input', render);
try {
  const results = await Promise.allSettled([api.listGraphs(), api.health(), api.listSceneCatalog(), api.library()]);
  if (results[0].status === 'rejected') throw results[0].reason;
  catalog = results[0].value;
  if (results[1].status === 'fulfilled') names = new Map((results[1].value.projects || []).map(p => [p.id, p.name]));
  if (results[2].status === 'fulfilled') scenes = results[2].value.scenes || [];
  groups = results[3].status === 'fulfilled' ? results[3].value.groups : libraryPreferences().groups;
  render();
  if (results[2].status === 'rejected') feedback.textContent = '场景目录暂时不可用，调用图仍可访问。刷新可重试。';
  const project = new URL(location.href).searchParams.get('project');
  if (project) document.getElementById(`project-${project}`)?.scrollIntoView({block:'start'});
} catch (error) {
  summary.textContent = '目录暂时不可用';
  feedback.textContent = error.message;
  const retry = el('button', '重新加载'); retry.onclick = () => location.reload(); home.append(retry);
}

window.addEventListener('projects-changed',async()=>{
  try{const health=await api.health();names=new Map((health.projects||[]).map(p=>[p.id,p.name]));
    render();
  }catch(e){feedback.textContent=e.message;}
});
