import { textEditor } from '../components/text-editor.js';
// Description editing is explicitly separate from collection and source facts.
export function editDescriptions(api, slug, target, applied) {
  const dialog = document.createElement('dialog'); dialog.className = 'unsaved-dialog description-dialog';
  const title = document.createElement('h2'); title.textContent = '编辑说明'; title.id = 'description-editor-title'; dialog.setAttribute('aria-labelledby',title.id);
  const label = document.createElement('div'); label.className='editor-label'; label.textContent = '说明';
  const count=document.createElement('span');label.append(count);
  const surface=document.createElement('div');surface.className='description-editor';
  const text=textEditor(surface,{value:target.description || '',label:'说明',onChange:value=>{count.textContent=`${value.length} / 16000`;}});
  count.textContent=`${text.value.length} / 16000`;
  const bulk = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '批量编辑 JSON';
  const jsonSurface=document.createElement('div');jsonSurface.className='description-editor json-editor';
  const json=textEditor(jsonSurface,{format:'json',label:'批量描述 JSON',value:JSON.stringify([{targetType:target.targetType,id:target.id,description:target.description || ''}],null,2)});
  bulk.append(summary,jsonSurface);
  const error = document.createElement('p'); error.setAttribute('role','alert'); error.className = 'unsaved-error';
  const actions = document.createElement('div'); actions.className = 'unsaved-actions';
  const cancel = document.createElement('button'); cancel.textContent = '取消'; cancel.onclick = () => dialog.close();
  const apply = document.createElement('button'); apply.textContent = '应用到草稿'; apply.className = 'primary';
  let busy = false;
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  apply.onclick = async () => {
    if(busy)return;
    try {
      let edits;
      if (bulk.open) { try { edits=JSON.parse(json.value); } catch { throw new Error('JSON 格式不正确，请检查引号和逗号。'); } }
      else edits=[{targetType:target.targetType,id:target.id,description:text.value}];
      if(!Array.isArray(edits))throw new Error('请输入描述项数组');
      if(edits.some(edit=>typeof edit.description!=='string'||edit.description.length>16000))throw new Error('每项说明不能超过 16000 字，请缩短后重试。');
      busy = true; apply.disabled = cancel.disabled = true;
      text.setReadOnly(true);json.setReadOnly(true);
      await api.describeGraph(slug,edits); applied(edits); dialog.close();
    } catch(e) { error.textContent = e.message; }
    finally { busy = false; apply.disabled = cancel.disabled = false; if(dialog.open){text.setReadOnly(false);json.setReadOnly(false);} }
  };
  const shortcut=document.createElement('small');shortcut.textContent='Ctrl / ⌘ + Enter 应用';
  actions.append(shortcut,cancel,apply); dialog.append(title,label,surface,bulk,error,actions);
  dialog.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();apply.click();}});
  dialog.addEventListener('close',()=>{text.destroy();json.destroy();dialog.remove();},{once:true});document.body.append(dialog);dialog.showModal();text.focus();
}
