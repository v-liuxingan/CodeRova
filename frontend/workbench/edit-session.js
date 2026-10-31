export function editSession(api, currentSlug, reload) {
  const $=id=>document.getElementById(id);
  const dialog=document.createElement('dialog');dialog.className='unsaved-dialog';dialog.setAttribute('aria-labelledby','unsaved-title');
  dialog.innerHTML='<h2 id="unsaved-title">保存当前图的修改？</h2><p>修改尚未保存。隐藏仅本次有效，不会写入文件。</p><div class="unsaved-actions"><button value="cancel">取消</button><button value="discard">放弃修改</button><button value="save" class="primary">保存并离开</button></div><p class="unsaved-error" role="alert"></p>';
  document.body.append(dialog);
  let resolveLeave, working=false;
  function update() {
    const state=api.drafts.get(currentSlug()),dirty=Boolean(state?.dirty),busy=working||api.editBusy>0;
    $('save-edits').disabled=!dirty||busy;$('discard-edits').disabled=!dirty||busy;
    $('edit-bar').hidden=!dirty&&!busy&&$('restore-hidden').hidden;
    const c=state?.changes;
    $('edit-state').textContent=busy?'处理中…':dirty?`未保存 · 新增 ${c?.addedNodes||0} / 删除 ${c?.removedNodes||0} 个节点 · 连线 +${c?.addedEdges||0} / −${c?.removedEdges||0}`:'已保存';
    $('edit-state').dataset.dirty=String(dirty);
  }
  api.onDraftChange=update;
  async function save(){await api.saveDraft(currentSlug());update();}
  async function discard(){await api.discardDraft(currentSlug());update();}
  async function run(action){working=true;update();try{await action();}catch(error){$('status').textContent=error.message;$('status').dataset.error='true';}finally{working=false;update();}}
  $('save-edits').onclick=()=>run(save);
  $('discard-edits').onclick=()=>run(async()=>{if(window.confirm('放弃当前图的全部未保存修改？')){await discard();reload();}});
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!working)finish(false);});
  const finish=result=>{dialog.close();const resolve=resolveLeave;resolveLeave=null;resolve?.(result);};
  for(const button of dialog.querySelectorAll('button'))button.onclick=async()=>{
    if(working)return;
    if(button.value==='cancel'){finish(false);return;}
    working=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);update();
    try{if(button.value==='save')await save();else await discard();finish(true);}
    catch(error){dialog.querySelector('.unsaved-error').textContent=error.message;}
    finally{working=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);update();}
  };
  window.addEventListener('beforeunload',event=>{if(api.hasUnsaved(currentSlug())||api.editBusy){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',event=>{if(!event.persisted)api.abandonDrafts();});
  return {update, async leave(){
    if(resolveLeave)return false;
    if(!api.hasUnsaved(currentSlug())&&!api.editBusy)return true;
    dialog.querySelector('.unsaved-error').textContent='';dialog.showModal();dialog.querySelector('button[value="cancel"]').focus();
    return new Promise(resolve=>{resolveLeave=resolve;});
  }};
}
