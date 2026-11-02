const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
export function projectLsp(api) {
  const element=el('section');element.className='project-lsp';element.hidden=true;
  const heading=el('div');heading.className='project-lsp-heading';
  const label=el('strong','语言服务器');
  const language=el('select');language.setAttribute('aria-label','项目语言');
  for(const [value,text] of [['rust','Rust'],['java','Java']]){const option=el('option',text);option.value=value;language.append(option);}
  const status=el('span');status.setAttribute('role','status');
  const error=el('p');error.className='project-lsp-error';error.setAttribute('role','alert');
  const controls=el('div');controls.className='project-lsp-controls';
  const start=el('button','启动 LSP'), stop=el('button','停止');
  start.type=stop.type='button';controls.append(start,stop);heading.append(label,language,status);element.append(heading,controls,error);
  let project='',version=0,timer,working=false,phase='stopped';
  function paint(value){phase=value.state;element.dataset.state=phase;status.textContent=({starting:'正在准备…',running:'已启动',busy:'使用中',stopped:'未启动',failed:'启动失败'})[phase]||phase;
    stop.title=phase==='busy'?'请先停止采集或等待入口校验完成':'';start.disabled=working||['starting','running','busy'].includes(phase);stop.hidden=!['starting','running','busy'].includes(phase);start.hidden=['running','busy'].includes(phase);stop.disabled=working||!['starting','running'].includes(phase);error.textContent=value.message&&phase==='failed'?value.message:'';}
  async function refresh(v=version){try{const value=await api.lspStatus(project,language.value);if(v===version)paint(value);}catch(e){if(v===version){error.textContent=e.message;start.disabled=false;}}}
  async function act(action){const v=version;working=true;paint({state:phase});error.textContent='';try{const value=await api.controlLsp(project,language.value,action);if(v===version)paint(value);}catch(e){if(v===version)error.textContent=e.message;}finally{if(v===version){working=false;start.disabled=['starting','running','busy'].includes(phase);stop.disabled=!['starting','running'].includes(phase);}}}
  start.onclick=()=>act('start');stop.onclick=()=>act('stop');language.onchange=()=>{version++;working=false;void refresh();};
  function close(){version++;working=false;clearInterval(timer);element.hidden=true;project='';}
  return {element,close,async setProject(id){close();if(!id)return;project=id;element.hidden=false;const v=version;status.textContent='检查项目…';start.disabled=stop.disabled=true;
    try{const files=await api.projectFiles(id);if(v!==version)return;
      const languages=new Set(files.map(f=>f.name.endsWith('.java')?'java':f.name.endsWith('.rs')?'rust':null).filter(Boolean));
      for(const option of language.options)option.hidden=!languages.has(option.value);
      language.value=languages.has('rust')?'rust':'java';language.hidden=languages.size<2;
      if(!languages.size){error.textContent='未找到 Rust 或 Java 源文件。';return;}
      await refresh(v);if(v===version)timer=setInterval(()=>{if(!working)void refresh();},1500);
    }catch(e){if(v===version)error.textContent=e.message;}
  }};
}
