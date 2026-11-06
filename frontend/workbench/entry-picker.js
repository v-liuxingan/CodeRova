import { EntryEditor } from './entry-editor.js';
const el=(tag,text)=>{const item=document.createElement(tag);if(text)item.textContent=text;return item;};
export function entryPicker(api,onAdded,options={}) {
  const dialog=el('dialog');dialog.className='entry-picker';dialog.setAttribute('aria-label',options.title||'添加节点');
  const header=el('div');header.className='entry-picker-heading';header.append(el('h2',options.title||'添加节点'));
  const close=el('button','关闭');close.setAttribute('aria-label','关闭');header.append(close);
  const intro=el('p',options.intro||'选一个源文件，找到要添加的函数。');
  intro.className='entry-picker-instruction';
  const tools=el('div');tools.className='entry-picker-tools';
  const path=el('input');path.placeholder='输入或选择项目内源文件';path.setAttribute('aria-label','项目文件');path.setAttribute('list',options.listId||'entry-files');path.autocomplete='off';
  const list=el('datalist');list.id=options.listId||'entry-files';const open=el('button','打开文件');const browse=el('button','浏览本地文件');browse.className='primary';
  tools.append(browse,path,list,open);
  const editor=el('div');editor.className='entry-picker-editor';editor.textContent='选择入口所在的源文件，例如 Main.java 或 main.rs。';
  const footer=el('div');footer.className='entry-picker-footer';const selection=el('span','尚未选择代码行'),check=el('button','校验入口'),add=el('button',options.action||'添加');add.disabled=true;add.hidden=true;check.disabled=true;footer.append(check,add);
  const note=el('input');note.placeholder='关联说明（可选）：消息名、事件、接收逻辑等';note.setAttribute('aria-label','入口关联说明');note.maxLength=2000;
  const status=el('p');status.setAttribute('role','status');status.className='entry-picker-status';
  const context=el('p');context.className='entry-picker-context';
  const message=(text,error=false)=>{
    status.getAnimations().forEach(animation=>animation.cancel());
    status.classList.toggle('is-error',error);
    status.setAttribute('role',error?'alert':'status');
    status.textContent=text;
    if(error&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      status.animate([{transform:'translateX(0)'},{transform:'translateX(-5px)'},{transform:'translateX(5px)'},{transform:'translateX(-3px)'},{transform:'translateX(0)'}],{duration:300,iterations:1});
    }
  };
  const selected=el('div');selected.className='entry-picker-selection';selected.append(selection,status);footer.prepend(selected);
  const directionRow=el('label','采集方向'), direction=el('select');
  direction.id=`${options.listId||'entry'}-direction`;directionRow.htmlFor=direction.id;
  for(const [value,label] of [['outgoing','向下采集 · 它调用谁'],['incoming','向上采集 · 谁调用它']]) {
    const option=el('option',label);option.value=value;direction.append(option);
  }
  directionRow.append(direction);directionRow.hidden=true;
  directionRow.className="entry-picker-direction";
  const showDirection=visible=>{directionRow.hidden=!options.chooseDirection || !visible;};
  note.hidden=!!options.hideNote;dialog.append(header,intro,context,tools,editor,note,...(options.chooseDirection?[directionRow]:[]),footer);document.body.append(dialog);
  let slug,parent,files=[],runtime,selectedFile,line=1,candidate,revision=0,checking=false,checkingRequest;
  browse.disabled=true;
  const dispose=()=>{revision++;checkingRequest?.abort();checkingRequest=null;checking=false;runtime?.dispose();runtime=null;candidate=null;showDirection(false);add.hidden=true;check.hidden=false;};
  dialog.addEventListener('close',()=>dispose());close.onclick=()=>dialog.close();
  path.addEventListener('input',()=>{candidate=null;showDirection(false);add.disabled=true;add.hidden=true;check.hidden=false;});
  open.onclick=async()=>{
    const file=files.find(f=>f.name===path.value.trim());if(!file){message('请从当前项目文件列表中选择，不能输入项目外路径。',true);return;}
    dispose();const version=revision;selectedFile=undefined;check.disabled=true;message('正在打开文件…');
    try {
      const source=await api.entrySource(slug,file.id);
      if(version!==revision||!dialog.open)return;
      const mounted=new EntryEditor(nextLine=>{
        if(version!==revision||!dialog.open||line===nextLine)return;
        line=nextLine;candidate=null;showDirection(false);add.disabled=true;add.hidden=true;check.hidden=false;message('已选中代码行，点击“校验入口”。');selection.textContent=`第 ${line} 行 · ${file.name.split("/").pop()}`;
      });runtime=mounted;
      await mounted.mount(editor,{path:source.name,language:source.name.endsWith('.java')?'java':'rust',startLine:1,focusLine:1,focusEndLine:1,scope:'file',lines:source.text.split('\n').map((text,i)=>({number:i+1,text}))});
      if(version!==revision||!dialog.open){mounted.dispose();return;}
      selectedFile=file;line=1;selection.textContent=`第 1 行 · ${file.name.split("/").pop()}`;check.disabled=false;intro.textContent='点击函数中的一行，将它设为分析起点。';message('找不到函数？用“搜索代码”查找方法名。');
    }catch(error){if(version===revision)message(error.message,true);}
  };
  browse.onclick=async()=>{
    const version=revision;browse.disabled=true;message('请在项目目录中选择源文件…');
    try {
      const file=await api.selectEntryFile(slug);
      if(version!==revision||!dialog.open)return;
      if(file.cancelled){message('选择一个源文件开始。');return;}
      if(!files.some(item=>item.id===file.id))files.push(file);
      path.value=file.name;await open.onclick();
    }catch(error){if(version===revision)message(error.message,true);}
    finally{if(dialog.open)browse.disabled=false;}
  };
  check.onclick=async()=>{
    if(!selectedFile||checking)return;checking=true;check.disabled=true;check.textContent='正在校验…';open.disabled=true;browse.disabled=true;candidate=null;showDirection(false);add.disabled=true;add.hidden=true;check.hidden=false;
    const version=revision,chosenLine=line,file=selectedFile;checkingRequest=new AbortController();message('正在确认源码位置…');
    try {const result=await api.checkEntry(slug,file.id,chosenLine,checkingRequest.signal);if(version!==revision||!dialog.open)return;
      if(line!==chosenLine||path.value.trim()!==file.name){message('文件或选中行已改变，请打开目标文件后重新校验。',true);return;}
      candidate=result.candidateId;showDirection(true);check.hidden=true;add.hidden=false;message(result.verification==='source-position' ? `入口已选好，点击“${options.action||'添加'}”。函数将在采集时确认。` : result.message);add.disabled=false;
    }catch(error){if(version===revision)message(`无法添加：${error.message}`,true);}
    finally{if(version===revision){checking=false;checkingRequest=null;check.textContent='校验入口';check.disabled=!selectedFile;open.disabled=false;browse.disabled=!files.length;}}
  };
  add.onclick=async()=>{if(!candidate)return;add.disabled=true;const originalSlug=slug,version=revision;try{
    const result=await api.createEntry(slug,{fromId:parent,candidateId:candidate,note:note.value,...(options.chooseDirection?{direction:direction.value}:{})});if(version===revision)dialog.close();onAdded(originalSlug,result.nodeId,result);
  }catch(error){if(version===revision){message(error.message,true);add.disabled=false;}}};
  return {async open(next,from){dispose();direction.value="outgoing";files=[];browse.disabled=true;path.disabled=true;open.disabled=true;slug=next;parent=from;path.value='';note.value='';selectedFile=undefined;check.disabled=true;add.disabled=true;selection.textContent='尚未选择代码行';intro.textContent=options.intro||'选一个源文件，找到要添加的函数。';editor.textContent='选择入口所在的源文件，例如 Main.java 或 main.rs。';context.title=options.context?.()||'';context.textContent=context.title.split(' · ')[0];context.hidden=!context.textContent;dialog.showModal();message('正在读取项目文件…');const version=revision;
    try{files=await api.entryFiles(slug);if(version!==revision)return;browse.disabled=!files.length;path.disabled=!files.length;open.disabled=!files.length;list.replaceChildren(...files.map(f=>{const o=el('option');o.value=f.name;return o;}));message(files.length?'文件选择器会打开当前项目，也可输入相对路径。':'当前项目没有可选择的 Rust 或 Java 源文件。');}
    catch(error){message(error.message,true);}
  }};
}
