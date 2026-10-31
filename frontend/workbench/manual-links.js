import { supportsCollection } from '../../public/js/api.js';
const element=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
export function manualLinkForm(container,{api,slug,graph,sourceId,catalog,reload,collect}) {
  const details=element('details'),summary=element('summary','关联异步后续');details.className='manual-link';details.append(summary);
  const explain=element('p','选择同项目已分析的接收函数，填写消息或事件依据。此关系会标为人工关联，不视为直接调用。');
  const graphSelect=element('select'),target=element('select'),note=element('textarea');
  graphSelect.setAttribute('aria-label','接收函数所在图');target.setAttribute('aria-label','接收函数');note.setAttribute('aria-label','异步关联依据');note.placeholder='例如：发送事件名、消费者注册位置及匹配依据';note.maxLength=2000;
  for(const item of catalog.filter(g=>g.projectId===graph.projectId)) {const option=element('option',item.title);option.value=item.slug;graphSelect.append(option);}
  graphSelect.value=slug;
  const save=element('button','保存人工关联'),start=element('button','从接收函数继续采集'),refresh=element('button','加载关联结果'),message=element('p');message.setAttribute('role','status');start.hidden=true;refresh.hidden=true;
  let targetId,version=0;
  async function load(){const revision=++version;save.disabled=true;target.replaceChildren();try{
    const data=graphSelect.value===slug?graph:await api.loadGraph(graphSelect.value);
    if(revision!==version||!details.isConnected)return;
    if(!supportsCollection(data))throw Error('请选择 LSP 分析图');
    for(const n of data.nodes.filter(n=>n.id!==sourceId && ['function','method'].includes(n.kind))){const option=element('option',`${n.label} · ${n.file}:${n.line}`);option.value=n.id;target.append(option);}
    save.disabled=!target.options.length;message.textContent='';
  }catch(error){if(revision===version)message.textContent=error.message;}}
  graphSelect.addEventListener('change',load);
  details.append(explain,graphSelect,target,note,save,start,refresh,message);container.append(details);
  let loaded=false;details.addEventListener('toggle',()=>{if(details.open&&!loaded){loaded=true;void load();}});
  save.addEventListener('click',async()=>{if(!note.value.trim()){message.textContent='请填写关联依据。';note.focus();return;}save.disabled=true;try{
    const result=await api.addManualLink(slug,{fromId:sourceId,targetGraph:graphSelect.value,targetId:target.value,note:note.value});
    targetId=result.nodeId;graphSelect.disabled=true;target.disabled=true;note.disabled=true;start.hidden=false;refresh.hidden=false;message.textContent='关联已保存。可以从接收函数定向续采，或先加载图查看关联。';
  }catch(error){message.textContent=error.message;save.disabled=false;}});
  start.addEventListener('click',async()=>{start.disabled=true;try{await collect(targetId);message.textContent='定向续采已启动，请在上方查看进度；关联已保存。';}catch(error){message.textContent=`关联已保存，采集未启动：${error.message}`;start.disabled=false;}});
  refresh.addEventListener('click',reload);
  if(graph.analysis?.pendingNodes.includes(sourceId)) {
    const seed=element('button','继续采集');seed.addEventListener('click',async()=>{seed.disabled=true;try{await collect(sourceId);}catch(error){seed.disabled=false;message.textContent=error.message;details.open=true;}});container.append(seed);
  }
}
