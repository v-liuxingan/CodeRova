import {autoUpdate, computePosition, flip, offset, shift} from '@floating-ui/dom';
import {libraryProjects} from '../../public/js/library-catalog.js';
const el = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const key = 'callgraph-v2-library';
const icon = kind => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'tree-icon'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', kind === 'menu' ? 'M5 12h1m5 0h1m5 0h1' : 'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6');
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.6'); path.setAttribute('stroke-linecap', 'round');
  svg.append(path); return svg;
};

// Native disclosure elements provide keyboard-accessible folders without pretending
// to implement the more complex ARIA tree keyboard contract.
export class LibraryTree {
  constructor({ container, api, onSelect, onChange, onRemoved, notify, onCreateGraph, onCreateProject }) {
    Object.assign(this, { container, api, onSelect, onChange, onRemoved, notify, onCreateGraph, onCreateProject });
    this.graphs = []; this.projects = new Map(); this.trash = []; this.query = ''; this.selected = '';
    this.preferences = { closed: [], order: [], groups: [], removedProjects: [] }; this.busy = false;
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved) this.preferences = {
        removedProjects: Array.isArray(saved.removedProjects) ? saved.removedProjects.filter(x => typeof x === 'string') : [],
        closed: Array.isArray(saved.closed) ? saved.closed.filter(x => typeof x === 'string') : [],
        order: Array.isArray(saved.order) ? saved.order.filter(x => typeof x === 'string') : [],
        groups: Array.isArray(saved.groups) ? saved.groups.filter(x => x && typeof x.project === 'string' && typeof x.id === 'string' && typeof x.name === 'string') : [],
      };
    } catch {}
  }

  save() {
    try { localStorage.setItem(key, JSON.stringify(this.preferences)); }
    catch { this.notify('浏览器无法保存目录偏好，本次操作仅在当前页面保留。', true); }
  }
  async loadLibrary() {
    let data=await this.api.library();
    const health=await this.api.health();this.projects=new Map(health.projects.map(p=>[p.id,data.directories?.[p.id]||p.name]));
    let migrated=false;
    try{migrated=!!localStorage.getItem(key+'-groups-migrated');}catch{}
    if(!migrated) {
      for(const group of this.preferences.groups)if(this.projects.has(group.project)&&!data.groups.some(g=>g.project===group.project&&g.id===group.id))data=await this.api.changeLibrary({action:'upsertGroup',projectId:group.project,groupId:group.id,name:group.name});
      try{localStorage.setItem(key+'-groups-migrated','true');}catch{}
    }
    this.preferences.groups=data.groups;this.directoryNames=data.directories;this.save();
  }

  async rename(kind,target) {
    if(this.api.editBusy || (kind==='图' && this.api.hasUnsaved(target.slug))){this.notify('请先保存或放弃当前修改。',true);return;}
    const previous=kind==='图'?target.title:target.name;
    const result=await this.dialog(`重命名${kind}`,'修改显示名称，原有链接和源码位置保持不变。',[{name:'name',label:'名称',value:previous,maxLength:kind==='图'?160:kind==='目录'?120:40}],'保存名称');
    if(!result)return;
    if(this.api.editBusy || (kind==='图' && this.api.hasUnsaved(target.slug))){this.notify('请先保存或放弃当前修改。',true);return;}
    await this.mutate(async()=>{
      if(kind==='图'){if(this.api.drafts?.has(target.slug))await this.api.discardDraft(target.slug);await this.api.renameGraph(target.slug,result.name);}
      else await this.api.changeLibrary(kind==='目录'?{action:'renameDirectory',projectId:target.project,name:result.name}:{action:'upsertGroup',projectId:target.project,groupId:target.id,name:result.name});
    },'名称已更新');
    if(kind==='图' && target.slug===this.selected) { const heading=document.getElementById('title');if(heading)heading.textContent=result.name.trim(); }
  }
  setData(graphs, projects) { this.graphs = graphs; this.projects = new Map([...projects].map(([id,name])=>[id,this.directoryNames?.[id]||name])); this.render(); }
  select(slug) {
    this.selected = slug;
    const graph = this.graphs.find(g => g.slug === slug);
    if (graph) this.preferences.closed = this.preferences.closed.filter(k => ![graph.projectId, `${graph.projectId}/${graph.categoryId || 'uncategorized'}`].includes(k));
    this.render();
  }
  filter(query) { this.query = query.trim().toLowerCase(); this.render(); }
  async refreshTrash() {
    try { this.trash = await this.api.listArchivedGraphs(); this.render(); }
    catch (error) { this.notify(`回收站读取失败：${error.message}`, true); }
  }
  groups(project) {
    const groups = new Map(this.preferences.groups.filter(g => g.project === project).map(g => [g.id, { ...g, graphs: [] }]));
    for (const graph of this.graphs.filter(g => g.projectId === project)) {
      const id = graph.categoryId || 'uncategorized';
      if (!groups.has(id)) groups.set(id, { project, id, name: graph.category || '未分类', graphs: [] });
      groups.get(id).graphs.push(graph);
    }
    return [...groups.values()];
  }
  folder(id, title, count, className) {
    const folder = el('details', null, className); folder.dataset.folder = id;
    folder.open = !!this.query || !this.preferences.closed.includes(id);
    const summary = el('summary'); summary.title = title; summary.append(el('span', title), el('small', String(count)));
    folder.append(summary);
    folder.addEventListener('toggle', () => {
      if (!folder.isConnected || this.query) return;
      this.preferences.closed = this.preferences.closed.filter(k => k !== id);
      if (!folder.open) this.preferences.closed.push(id);
      this.save();
    });
    return folder;
  }
  action(text, label, callback) {
    const button = el('button', text); button.type = 'button'; button.title = label;
    button.setAttribute('aria-label', label); button.disabled = this.busy;
    button.addEventListener('click', event => { event.preventDefault();event.stopPropagation();button.closest('[popover]')?.hidePopover();callback(); });
    return button;
  }
  menu(label, actions) {
    const menu=el('span',null,'tree-menu'),trigger=this.action('⋯',label,()=>{}),body=el('div',null,'tree-menu-actions');
    body.popover='auto';trigger.setAttribute('aria-haspopup','true');trigger.setAttribute('aria-expanded','false');
    trigger.onclick=()=>body.togglePopover();body.append(...actions);menu.append(trigger,body);
    let cleanup;
    body.addEventListener('toggle',()=>{
      cleanup?.();cleanup=null;
      const open=body.matches(':popover-open');trigger.setAttribute('aria-expanded',String(open));
      if(open)cleanup=autoUpdate(trigger,body,async()=>{
        const {x,y}=await computePosition(trigger,body,{strategy:'fixed',placement:'bottom-end',middleware:[offset(4),flip({padding:8}),shift({padding:8})]});
        if(body.matches(':popover-open'))Object.assign(body.style,{left:`${x}px`,top:`${y}px`});
      });
    });
    menu.dispose=()=>cleanup?.();
    return menu;
  }
  render() {
    this.container.querySelectorAll('[popover]:popover-open').forEach(panel=>panel.hidePopover());
    this.container.querySelectorAll('.tree-menu').forEach(menu=>menu.dispose?.());
    this.container.replaceChildren(); this.container.setAttribute('aria-busy', String(this.busy));
    const toolbar = el('div', null, 'tree-toolbar');
    toolbar.append(el('span','项目与目录'),this.menu('资料库操作',[this.action('新建项目','新建项目',()=>this.onCreateProject()),this.action('新建目录','新建目录',()=>this.createGroup()),this.action('新建图','新建图',()=>this.onCreateGraph()), this.action('刷新', '刷新目录', () => this.mutate(async () => {}, '目录已刷新')), this.action('折叠', '折叠所有目录', () => {
      this.preferences.closed = [...new Set([...this.preferences.closed, 'trash', ...[...this.projects.keys()].flatMap(id => [id, ...this.groups(id).map(g => `${id}/${g.id}`)])])];
      // Close in place, including search-expanded folders, without recreating the
      // clicked button or reopening folders omitted from the project catalog.
      this.container.querySelectorAll('details[data-folder]').forEach(folder => { folder.open = false; });
      this.save();
    })]));
    this.container.append(toolbar);
    const ordered = graphs => [...graphs].sort((a, b) => {
      const ai = this.preferences.order.indexOf(a.slug), bi = this.preferences.order.indexOf(b.slug);
      return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) || a.title.localeCompare(b.title);
    });
    let matches = 0;
    for (const [project, name] of libraryProjects(this.projects,this.graphs,this.preferences.groups,this.preferences.removedProjects)) {
      const groups = this.groups(project).map(group => ({ ...group, graphs: ordered(group.graphs).filter(g => `${name} ${group.name} ${g.title}`.toLowerCase().includes(this.query)) }));
      const count = groups.reduce((sum, g) => sum + g.graphs.length, 0);
      if (this.query && !count) continue;
      matches += count;
      const folder = this.folder(project, name, count, 'tree-project');
      folder.querySelector('summary').append(this.menu(`项目操作 ${name}`, [
        this.action('新建目录',`在 ${name} 新建目录`,()=>this.createGroup(project)),
        this.action('新建图',`在 ${name} 新建图`,()=>this.onCreateGraph({projectId:project})),
        this.action('重命名',`重命名目录 ${name}`,()=>this.rename('目录',{project,name})),
        this.action('移入回收站',`删除目录 ${name}`,()=>this.archiveProject(project,name)),
      ]));
      for (const group of groups) {
        if (this.query && !group.graphs.length) continue;
        const branch = this.folder(`${project}/${group.id}`, group.name, group.graphs.length, 'tree-group');
        branch.dataset.project = project; branch.dataset.category = group.id;
        this.dropTarget(branch, group);
        branch.querySelector('summary').append(this.menu(`目录操作 ${group.name}`, [
          this.action('重命名',`重命名分组 ${group.name}`,()=>this.rename('分组',group)),
          this.action('移入回收站',`删除分组 ${group.name}`,()=>this.archiveGroup(group)),
        ]));
        if (!group.graphs.length) {
          const empty = el('div', null, 'tree-empty'); empty.append(el('span', '拖入调用图'));
          branch.append(empty);
        }
        for (const graph of group.graphs) {
          const row = el('div', null, 'tree-file'); row.draggable = !this.busy; row.dataset.graph = graph.slug;
          const open = this.action(graph.title, graph.title, () => this.onSelect(graph.slug));
          open.replaceChildren(icon('file'), el('span', graph.title, 'tree-label'));
          open.dataset.slug = graph.slug; open.className = 'tree-open'; open.setAttribute('aria-current', String(graph.slug === this.selected));
          row.append(open,this.menu(`操作 ${graph.title}`, [this.action('重命名',`重命名图 ${graph.title}`,()=>this.rename('图',graph)),this.action('移动到…',`移动 ${graph.title}`,()=>this.chooseMove(graph)),this.action('移入回收站',`删除 ${graph.title}`,()=>this.archive(graph))]));
          row.addEventListener('dragstart', event => { if (this.busy) { event.preventDefault(); return; } this.dragged = graph.slug; event.dataTransfer.setData('text/plain', graph.slug); event.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
          row.addEventListener('dragend', () => { this.dragged = null; row.classList.remove('dragging'); this.container.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target')); });
          this.dropTarget(row, group, graph.slug); branch.append(row);
        }
        folder.append(branch);
      }
      if (!groups.length) folder.append(el('p', '暂无调用图，可从项目菜单新建目录或图。', 'tree-empty'));
      this.container.append(folder);
    }
    if (this.query && !matches) this.container.append(el('p', '没有匹配的调用图', 'tree-empty'));
    const trash = this.folder('trash', '回收站', this.trash.length, 'tree-trash');
    for (const graph of this.trash) {
      const row = el('div', null, 'tree-trash-row'); row.append(el('span', graph.title), this.menu(`回收站操作 ${graph.title}`,[this.action('恢复', `恢复 ${graph.title}`, () => this.mutate(async () => { await this.api.restoreGraph(graph.slug); }, '已恢复调用图')), this.action('删除', `永久删除 ${graph.title}`, () => this.deletePermanently(graph))])); trash.append(row);
    }
    if (!this.trash.length) trash.append(el('p', '回收站为空', 'tree-empty'));
    this.container.append(trash);
  }
  dropTarget(element, group, before) {
    element.addEventListener('dragover', event => {
      const source = this.graphs.find(g => g.slug === this.dragged);
      if (this.busy || !source || source.projectId !== group.project) return;
      event.preventDefault(); event.stopPropagation(); element.classList.add('drop-target');
    });
    element.addEventListener('dragleave', () => element.classList.remove('drop-target'));
    element.addEventListener('drop', event => {
      event.preventDefault(); event.stopPropagation(); element.classList.remove('drop-target');
      const graph = this.graphs.find(g => g.slug === this.dragged); this.dragged = null;
      if (!graph || this.busy) return;
      if (graph.projectId !== group.project) { this.notify('只能在同一个项目内移动，源码归属不会改变。', true); return; }
      if (graph.slug === before) return;
      void this.move(graph, group, before);
    });
  }
  async mutate(operation, message, removed) {
    if (this.busy) return;
    this.busy = true; this.render();
    try {
      await operation();
      await this.loadLibrary();
      const [graphs, trash] = await Promise.all([this.api.listGraphs(), this.api.listArchivedGraphs()]);
      this.graphs = graphs; this.trash = trash; this.onChange(graphs);
      if (removed) this.onRemoved(removed, graphs);
      this.notify(message);
    } catch (error) { this.notify(`操作失败：${error.message}。可刷新目录核对状态。`, true); }
    finally { this.busy = false; this.render(); }
  }
  async move(graph, group, before) {
    const reorder = () => {
      // Materialize the displayed order first, so moving one item does not pull
      // its target ahead of all previously unranked siblings.
      const rank = id => { const i = this.preferences.order.indexOf(id); return i < 0 ? Infinity : i; };
      const order = [...this.graphs].sort((a, b) => rank(a.slug) - rank(b.slug) || a.title.localeCompare(b.title)).map(g => g.slug).filter(id => id !== graph.slug);
      const index = before ? order.indexOf(before) : order.length;
      order.splice(index, 0, graph.slug); this.preferences.order = order;
      this.preferences.closed = this.preferences.closed.filter(id => id !== `${group.project}/${group.id}`);
      this.save();
    };
    if (graph.categoryId === group.id) { reorder(); this.render(); return; }
    await this.mutate(async () => { await this.api.updateGraphCategory(graph.slug, group.id, group.name); reorder(); }, `已移动到「${group.name}」`);
  }
  async chooseMove(graph) {
    const groups = this.groups(graph.projectId);
    const result = await this.dialog('移动调用图', graph.title, [{ name: 'group', label: '目标分组', options: groups.map(g => [g.id, g.name]) }], '移动');
    if (result) await this.move(graph, groups.find(g => g.id === result.group));
  }
  async archive(graph) {
    if (await this.dialog('移入回收站', `「${graph.title}」将从目录移除，可随时恢复。源码和布局不会删除。`, [], '移入回收站')) {
      await this.mutate(() => this.api.archiveGraph(graph.slug), '已移入回收站，可在左侧恢复。', graph.slug);
    }
  }
  async archiveGroup(group) {
    return this.archiveFolder(group);
  }
  async archiveProject(project, name) {
    return this.archiveFolder({ project, name }, true);
  }
  async archiveFolder(group, wholeProject = false) {
    if (this.busy) return;
    const kind = wholeProject ? '目录' : '分组';
    // Resolve against the complete catalog, never the filtered display list.
    const members = this.graphs.filter(g => g.projectId === group.project && (wholeProject || (g.categoryId || 'uncategorized') === group.id));
    if (this.api.editBusy || members.some(g => this.api.hasUnsaved(g.slug))) {
      this.notify('请先保存或放弃组内调用图的修改。', true); return;
    }
    const confirmed = await this.dialog(`删除${kind}`, members.length
      ? `「${group.name}」中的全部 ${members.length} 张调用图将移入回收站，包括搜索隐藏的图。源码不会删除，可在回收站恢复调用图。`
      : `删除空${kind}「${group.name}」？源码不会删除。`, [], `删除${kind}`);
    if (!confirmed || this.busy) return;
    // Edits may have started while confirmation was open; check the whole batch.
    if (this.api.editBusy || members.some(g => this.api.hasUnsaved(g.slug))) {
      this.notify('请先保存或放弃组内调用图的修改。', true); return;
    }
    this.busy = true; this.render();
    const archived = new Set();
    let failure = null, refreshFailure = null;
    try {
      for (const graph of members) {
        await this.api.archiveGraph(graph.slug);
        archived.add(graph.slug);
      }
      for(const item of this.groups(group.project).filter(g=>wholeProject||g.id===group.id))await this.api.changeLibrary({action:'deleteGroup',projectId:group.project,groupId:item.id});
      this.preferences.groups = this.preferences.groups.filter(g => !(g.project === group.project && (wholeProject || g.id === group.id)));
      this.preferences.closed = this.preferences.closed.filter(id => wholeProject ? id !== group.project && !id.startsWith(`${group.project}/`) : id !== `${group.project}/${group.id}`);
      if (wholeProject && !this.preferences.removedProjects.includes(group.project)) this.preferences.removedProjects.push(group.project);
    } catch (error) { failure = error; }
    try {
      const [graphs, trash] = await Promise.all([this.api.listGraphs(), this.api.listArchivedGraphs()]);
      this.graphs = graphs; this.trash = trash;
      // A response can be lost after the server has archived the file.
      for (const graph of members) if (!graphs.some(g => g.slug === graph.slug) && trash.some(g => g.slug === graph.slug)) archived.add(graph.slug);
    } catch (error) {
      refreshFailure = error;
      this.graphs = this.graphs.filter(g => !archived.has(g.slug));
      this.trash = [...this.trash.filter(g => !archived.has(g.slug)), ...members.filter(g => archived.has(g.slug))];
    }
    this.preferences.order = this.preferences.order.filter(id => !archived.has(id));
    this.save(); this.busy = false; this.render(); this.onChange(this.graphs);
    if (archived.has(this.selected)) await this.onRemoved(this.selected, this.graphs);
    if (failure || refreshFailure) {
      this.notify(`已移入回收站 ${archived.size}/${members.length} 张。${failure?.message || ''}${refreshFailure ? '目录刷新失败，请刷新后核对状态。' : '其余调用图保留。'}`, true);
    } else this.notify(members.length ? `已删除${kind}，${archived.size} 张调用图可在回收站恢复。` : `已删除空${kind}。`);
  }
  async createGroup(projectId) {
    if(!this.projects.size){this.notify('请先新建项目，接入本地源码目录。',true);return;}
    const result = await this.dialog('新建目录', '在项目内整理调用图。', [
      { name: 'project', label: '所属项目', options: [...this.projects], value:projectId }, { name: 'name', label: '目录名称' },
    ], '创建');
    if (!result) return;
    if (this.groups(result.project).some(g => g.name === result.name.trim())) { this.notify('该项目下已有同名分组。', true); return; }
    try{const data=await this.api.changeLibrary({action:'upsertGroup',projectId:result.project,groupId:`group-${crypto.randomUUID()}`,name:result.name.trim()});this.preferences.groups=data.groups;}catch(error){this.notify(error.message,true);return;}
    this.preferences.removedProjects = this.preferences.removedProjects.filter(id => id !== result.project);
    this.preferences.closed = this.preferences.closed.filter(id => id !== result.project);
    this.save(); this.render();
  }
  async deletePermanently(graph) {
    if (await this.dialog('永久删除本机图配置', `将永久删除「${graph.title}」对应的本机图配置文件，无法从回收站恢复。源码和布局文件保留。`, [], '永久删除')) {
      await this.mutate(() => this.api.deleteArchivedGraph(graph.slug), '本机图配置文件已永久删除。');
    }
  }
  dialog(title, description, fields, submitText) {
    return new Promise(resolve => {
      const dialog = el('dialog', null, 'tree-dialog'); const form = el('form');
      const heading = el('h2', title); heading.id = 'tree-dialog-title'; dialog.setAttribute('aria-labelledby', heading.id);
      form.append(heading, el('p', description));
      for (const field of fields) {
        const label = el('label', field.label), input = el(field.options ? 'select' : 'input'); input.name = field.name; input.required = true;
        if (field.options) for (const [value, name] of field.options) { const option = el('option', name); option.value = value; input.append(option); }
        else { input.maxLength = field.maxLength || 40; input.pattern = '.*\\S.*'; input.value=field.value||''; }
        if(field.options && field.value) input.value=field.value;
        label.append(input); form.append(label);
      }
      const actions = el('div', null, 'dialog-actions'); const cancel = el('button', '取消'); cancel.type = 'button';
      const submit = el('button', submitText); submit.type = 'submit';
      if (submitText === '永久删除') { submit.className = 'danger'; cancel.autofocus = true; }
      actions.append(cancel, submit); form.append(actions); dialog.append(form);
      const close = value => { dialog.close(); dialog.remove(); resolve(value); };
      cancel.addEventListener('click', () => close(null)); dialog.addEventListener('cancel', event => { event.preventDefault(); close(null); });
      form.addEventListener('submit', event => { event.preventDefault(); close(Object.fromEntries(new FormData(form))); });
      document.body.append(dialog); dialog.showModal();
    });
  }
}
