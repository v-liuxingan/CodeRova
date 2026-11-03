import { supportsCollection } from '../../public/js/api.js';
export function resumePanel(api, reload) {
  const $ = id => document.getElementById(id);
  let slug, generation=0, timer, latestTask={status:'idle'}, stopRequested=false;
  let pending=0, previewed=false, working=false;
  // Remove the obsolete notification receipt; no result is accepted by local preference.
  try { for(const key of Object.keys(localStorage))if(key.startsWith('callgraph:loaded-result:'))localStorage.removeItem(key); } catch {}
  const finished = task => ['finished','stopped','failed'].includes(task.status);
  function show(task) {
    const previous=latestTask.status, running=task.status==='running', done=finished(task);
    latestTask=task;
    if(!running)stopRequested=false;
    if(running && previous!=='running')previewed=false;
    $('active-collection').hidden=!running&&!done;
    $('active-collection').dataset.state=task.status;
    const counts=Number.isInteger(task.addedNodes)?`本轮新增 ${task.addedNodes} 个节点`:'节点统计暂不可用';
    $('active-collection').setAttribute('aria-busy',String(running));
    const label={finished:'采集完成',stopped:'采集已停止',failed:'采集失败'}[task.status];
    $('active-collection-status').textContent=running
      ? stopRequested?'正在停止…':Number.isInteger(task.addedNodes)?`${task.message || '正在采集'}${task.message?.includes('新增')?'':` · 新增 ${task.addedNodes} 个节点`}`:'正在采集…'
      : `${label} · ${counts} · ${previewed?'预览中，尚未保存':'结果待采纳'}`;
    $('collection-indicator').textContent=running?'运行中':done?(task.status==='failed'?'失败':'待采纳'):'';
    $('collection-indicator').dataset.state=task.status;

    $('resume-summary').textContent='采集任务';
    if(task.status!==previous && (running||done))$('resume-panel').open=true;
    if(Number.isInteger(task.pending)&&task.status!=='idle')pending=task.pending;
    $('resume-stop').hidden=!running;
    $('resume-stop').disabled=stopRequested||working;
    $('resume-stop').textContent=stopRequested?'正在停止…':'停止采集';
    $('collection-result-actions').hidden=!done;
    $('resume-refresh').textContent=previewed?'重新预览':'预览';
    for(const id of ['resume-refresh','resume-accept','resume-discard'])$(id).disabled=working;
    const detail=Number.isInteger(task.totalNodes)?`新增 ${task.addedEdges} 条关系 · 当前图 ${task.totalNodes} 个符号、${task.totalEdges} 条关系。`:'';
    $('resume-status').textContent=task.status==='idle'?`${pending} 个待采符号。`: task.status==='failed'?`${task.message}。结果尚未写入图文件。`:detail;
  }
  async function poll(version) {
    try {
      const task=await api.analysisTask(slug);
      if(version!==generation)return;
      show(task);
      if(task.status==='running')timer=setTimeout(()=>poll(version),1500);
    } catch(error) {if(version===generation)$('resume-status').textContent=`无法读取任务：${error.message}`;}
  }
  api.onCollectionChange=target=>{if(target===slug){clearTimeout(timer);void poll(generation);}};
  $('resume-stop').onclick=async()=>{
    const version=generation;stopRequested=true;show(latestTask);
    try {const task=await api.analysisTask(slug,'DELETE');if(version===generation)show(task);}
    catch(error){if(version===generation){stopRequested=false;show(latestTask);$('active-collection-status').textContent=`停止失败：${error.message}`;}}
  };
  async function resultAction(action) {
    if(working)return;
    const target=slug;
    if(action==='discard'&&!window.confirm('放弃当前草稿？采集结果和其他未保存修改都会丢弃。'))return;
    working=true;show(latestTask);
    try {
      if(action==='accept')await api.saveDraft(target);
      if(action==='discard')await api.discardDraft(target);
      await reload(target,action);
      if(slug!==target)return;
      previewed=action==='preview';
      await poll(generation);
      $('status').textContent=action==='preview'?'':action==='accept'?'已采纳并保存':'已放弃草稿';
      if(action==='preview')$('graph-details').open=true;
      $('canvas').focus({preventScroll:true});
    }catch(error){if(slug===target)$('status').textContent=`操作失败：${error.message}`;}
    finally{working=false;show(latestTask);}
  }
  $('resume-refresh').onclick=()=>void resultAction('preview');
  $('resume-accept').onclick=()=>void resultAction('accept');
  $('resume-discard').onclick=()=>void resultAction('discard');
  return {
    started(task){++generation;previewed=false;show(task);clearTimeout(timer);void poll(generation);$('status').textContent='';$('graph-details').open=false;$('graph-details').querySelector('summary').focus({preventScroll:true});},
    isRunning(){return latestTask.status==='running';},
    watch(){clearTimeout(timer);void poll(generation);},
    setGraph(next,graph){clearTimeout(timer);const version=++generation;if(slug!==next){stopRequested=false;previewed=false;}slug=next;$('resume-panel').open=false;pending=graph.analysis?.pendingNodes?.length||0;
      $('resume-panel').hidden=!supportsCollection(graph);
      show({status:'idle'});if(!$('resume-panel').hidden)void poll(version);
    }
  };
}
