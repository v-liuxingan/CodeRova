import { entryPicker } from './entry-picker.js';
const el = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
export function newGraph(api, onCreated) {
  const dialog = el('dialog'); dialog.className = 'new-graph-dialog'; dialog.setAttribute('aria-label', '新建图');
  const heading = el('h2', '新建图');
  const project = el('select'); project.id = 'new-graph-project';
  const title = el('input'); title.id = 'new-graph-title'; title.maxLength = 160; title.placeholder = '例如：应用启动流程';
  const projectLabel = el('label', '项目'); projectLabel.htmlFor = project.id;
  const titleLabel = el('label', '图名称'); titleLabel.htmlFor = title.id;
  const status = el('p'); status.setAttribute('role', 'status');
  const actions = el('div'); actions.className = 'new-graph-actions';
  const cancel = el('button', '取消'), next = el('button', '选择根节点'); next.className = 'primary';
  actions.append(cancel, next); dialog.append(heading, projectLabel, project, titleLabel, title, status, actions); document.body.append(dialog);
  let chosenProject, chosenTitle;
  const picker = entryPicker({
    entryFiles: id => api.projectFiles(id),
    entrySource: (id, file) => api.projectSource(id, file),
    checkEntry: (id, file, line) => api.checkProjectEntry(id, file, line),
    createEntry: (id, data) => api.createGraph({projectId:id, title:chosenTitle, candidateId:data.candidateId}),
  }, (_project, _node, result) => onCreated(result), {
    context:()=>`项目：${project.selectedOptions[0]?.textContent||chosenProject} · ${project.selectedOptions[0]?.dataset.root||''}`,
    title:'选择根节点', action:'创建图', listId:'new-graph-files', hideNote:true,
    intro:'打开文件，选择入口函数所在行。创建后配置采集；采集结果需另行采纳保存。',
  });
  cancel.onclick = () => dialog.close();
  next.onclick = () => {
    if (!project.value || !title.value.trim()) { status.textContent = '请选择项目并填写图名称。'; return; }
    chosenProject = project.value; chosenTitle = title.value.trim(); dialog.close(); void picker.open(chosenProject);
  };
  let revision = 0;
  dialog.addEventListener('close', () => revision++);
  return { async open(options = {}) {
    dialog.showModal(); const version = ++revision; next.disabled = true; status.textContent = '正在读取项目…'; project.replaceChildren(); title.value = options.title || '';
    try {
      const health = await api.health(); if (version !== revision) return;
      const placeholder = el('option', '请选择源码项目'); placeholder.value = ''; placeholder.disabled = true; placeholder.selected = true; project.append(placeholder);
      for (const item of health.projects || []) { if (!item.rootExists) continue; const option = el('option', item.name); option.value = item.id; option.dataset.root = item.root; project.append(option); }
      next.disabled = project.options.length <= 1;
      status.textContent = next.disabled ? '没有可用项目，请在 callgraph.projects.json 中配置项目目录。' : '';
      title.focus();
    } catch (error) { if (version === revision) status.textContent = error.message; }
  }};
}
