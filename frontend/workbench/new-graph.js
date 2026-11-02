import { projectLsp } from './project-lsp.js';
import { entryPicker } from './entry-picker.js';
const el = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
export function newGraph(api, onCreated) {
  const dialog = el('dialog'); dialog.className = 'new-graph-dialog'; dialog.setAttribute('aria-label', '新建图');
  const heading = el('h2', '新建图');
  const project = el('select'); project.id = 'new-graph-project';
  const title = el('input'); title.id = 'new-graph-title'; title.maxLength = 160; title.placeholder = '例如：应用启动流程';
  const projectLabel = el('label', '项目'); projectLabel.htmlFor = project.id;
  const titleLabel = el('label', '图名称'); titleLabel.htmlFor = title.id;
  const connect = el('button','接入项目'); connect.type='button'; connect.className='project-connect';
  const projectRow=el('div');projectRow.className='project-select-row';projectRow.append(project,connect);
  const lsp=projectLsp(api);
  project.onchange=()=>{void lsp.setProject(project.value);};
  const status = el('p'); status.setAttribute('role', 'status');
  const actions = el('div'); actions.className = 'new-graph-actions';
  const cancel = el('button', '取消'), next = el('button', '选择根节点'); next.className = 'primary';
  actions.append(cancel, next); dialog.append(heading, projectLabel, projectRow, titleLabel, title, lsp.element, status, actions); document.body.append(dialog);
  let chosenProject, chosenTitle;
  connect.onclick=async()=>{
    const openedRevision=revision;
    connect.disabled=true;status.textContent='请选择本地源码目录…';
    try {
      const selected=await api.selectProjectDirectory();if(!dialog.open || openedRevision!==revision)return;if(selected.cancelled){status.textContent='';return;}
      const confirm=el('dialog');confirm.className='new-graph-dialog';confirm.setAttribute('aria-label','接入项目');
      const h=el('h2','接入项目'),nameLabel=el('label','项目名称'),name=el('input'),root=el('p',selected.root),feedback=el('p'),buttons=el('div');
      nameLabel.htmlFor='connect-project-name';name.id=nameLabel.htmlFor;name.value=selected.name;name.maxLength=120;root.className='project-root';feedback.setAttribute('role','alert');
      const back=el('button','取消'),apply=el('button','接入项目');apply.className='primary';buttons.className='new-graph-actions';buttons.append(back,apply);
      back.onclick=()=>confirm.close();confirm.addEventListener('close',()=>confirm.remove(),{once:true});
      let registering=false;confirm.addEventListener('cancel',event=>{if(registering)event.preventDefault();});
      apply.onclick=async()=>{registering=true;apply.disabled=true;back.disabled=true;try{const item=await api.registerProject(selected.selectionId,name.value);
        let option=[...project.options].find(o=>o.value===item.id);if(!option){option=el('option',item.name);option.value=item.id;option.dataset.root=item.root;project.append(option);}
        project.value=item.id;window.dispatchEvent(new CustomEvent('projects-changed'));next.disabled=false;status.textContent='';confirm.close();void lsp.setProject(item.id);
      }catch(e){feedback.textContent=e.message;}finally{registering=false;apply.disabled=false;back.disabled=false;}};
      confirm.append(h,nameLabel,name,root,feedback,buttons);dialog.append(confirm);confirm.showModal();name.focus();
    }catch(e){status.textContent=e.message;}finally{connect.disabled=false;}
  };
  const selectedFiles=new Map();
  const picker = entryPicker({
    entryFiles: async id => {const files=await api.projectFiles(id);selectedFiles.clear();for(const file of files)selectedFiles.set(file.id,file.name);return files;},
    entrySource: (id, file) => api.projectSource(id, file),
    checkEntry: async (id, file, line, signal) => {
      const language=selectedFiles.get(file)?.endsWith('.java')?'java':'rust';
      let waiting=false;
      for(let attempt=0;attempt<1200;attempt++) {
        if(signal?.aborted)throw new DOMException("已取消", "AbortError");
        const state=await api.lspStatus(id,language,signal);
        if(state.state==='failed')throw new Error(state.message || '语言服务器启动失败，请到项目设置重试。');
        if(state.state!=='starting') {
          if(waiting && state.state==='stopped')throw new Error('语言服务器已停止，请重新启动后校验。');
          return api.checkProjectEntry(id,file,line,signal);
        }
        waiting=true;await new Promise(resolve=>setTimeout(resolve,500));
      }
      throw new Error('语言服务器准备超时，请到项目设置查看状态。');
    },
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
  dialog.addEventListener('close', event => {if(event.target===dialog){revision++;lsp.close();}});
  return { async open(options = {}) {
    heading.textContent=options.settings?'项目设置':'新建图';dialog.setAttribute('aria-label',heading.textContent);title.hidden=titleLabel.hidden=next.hidden=Boolean(options.settings);cancel.textContent=options.settings?'完成':'取消';
    dialog.showModal(); const version = ++revision; next.disabled = true; status.textContent = '正在读取项目…'; project.replaceChildren(); title.value = options.title || '';
    try {
      const health = await api.health(); if (version !== revision) return;
      const placeholder = el('option', '请选择源码项目'); placeholder.value = ''; placeholder.disabled = true; placeholder.selected = true; project.append(placeholder);
      for (const item of health.projects || []) { if (!item.rootExists) continue; const option = el('option', item.name); option.value = item.id; option.dataset.root = item.root; project.append(option); }
      next.disabled = project.options.length <= 1;
      status.textContent = next.disabled ? '还没有项目，点击“接入项目”选择源码目录。' : '';
      if(options.projectId && [...project.options].some(o=>o.value===options.projectId)){project.value=options.projectId;void lsp.setProject(project.value);}
      (options.settings?project:title).focus();
    } catch (error) { if (version === revision) status.textContent = error.message; }
  }};
}
