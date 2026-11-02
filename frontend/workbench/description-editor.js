// Description editing is explicitly separate from collection and source facts.
export function editDescriptions(api, slug, target, applied) {
  const dialog = document.createElement('dialog'); dialog.className = 'unsaved-dialog';
  const title = document.createElement('h2'); title.textContent = '编辑描述'; title.id = 'description-editor-title'; dialog.setAttribute('aria-labelledby',title.id);
  const label = document.createElement('label'); label.textContent = '描述';
  const text = document.createElement('textarea'); text.rows = 6; text.maxLength = 16000;
  text.value = target.description || ''; text.style.width = '100%'; label.append(text);
  const bulk = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '批量编辑 JSON';
  const json = document.createElement('textarea'); json.rows = 8; json.style.width = '100%'; json.setAttribute('aria-label','批量描述 JSON');
  json.value = JSON.stringify([{targetType:target.targetType,id:target.id,description:target.description || ''}],null,2);
  bulk.append(summary,json);
  const error = document.createElement('p'); error.setAttribute('role','alert'); error.className = 'unsaved-error';
  const actions = document.createElement('div'); actions.className = 'unsaved-actions';
  const cancel = document.createElement('button'); cancel.textContent = '取消'; cancel.onclick = () => dialog.close();
  const apply = document.createElement('button'); apply.textContent = '应用到草稿'; apply.className = 'primary';
  let busy = false;
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  apply.onclick = async () => {
    if(busy)return;
    try {
      const edits = bulk.open ? JSON.parse(json.value) : [{targetType:target.targetType,id:target.id,description:text.value}];
      if(!Array.isArray(edits))throw new Error('请输入描述项数组');
      busy = true; apply.disabled = cancel.disabled = true;
      await api.describeGraph(slug,edits); applied(edits); dialog.close();
    } catch(e) { error.textContent = e.message; }
    finally { busy = false; apply.disabled = cancel.disabled = false; }
  };
  actions.append(cancel,apply); dialog.append(title,label,bulk,error,actions);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();text.focus();
}
