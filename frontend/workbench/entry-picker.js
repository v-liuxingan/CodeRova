import { EntryEditor } from './entry-editor.js';
const el=(tag,text)=>{const item=document.createElement(tag);if(text)item.textContent=text;return item;};
export function entryPicker(api,onAdded,options={}) {
  const dialog=el('dialog');dialog.className='entry-picker';dialog.setAttribute('aria-label',options.title||'添加节点');
  const header=el('div');header.className='entry-picker-heading';header.append(el('h2',options.title||'添加节点'));
  const close=el('button','关闭');close.setAttribute('aria-label','关闭');header.append(close);
  const intro=el('p',options.intro||'打开文件，选择函数所在行，校验后添加。点击主页面“保存”后写入文件。');
  const tools=el('div');tools.className='entry-picker-tools';
  const path=el('input');path.placeholder='输入或选择项目内源文件';path.setAttribute('aria-label','项目文件');path.setAttribute('list',options.listId||'entry-files');path.autocomplete='off';
  const list=el('datalist');list.id=options.listId||'entry-files';const open=el('button','打开文件'),find=el('button','搜索代码');find.disabled=true;const browse=el('button','浏览本地文件');browse.className='primary';
  const local=el('input');local.type='file';local.accept='.rs,.java';local.hidden=true;local.setAttribute('aria-label','选择本地源文件');
  const matches=el('select');matches.hidden=true;matches.setAttribute('aria-label','选择项目内同名文件');
  tools.append(browse,path,list,open,find,local,matches);
  const editor=el('div');editor.className='entry-picker-editor';editor.textContent='打开文件后，在这里选择函数定义或函数体内的一行。';
  const footer=el('div');footer.className='entry-picker-footer';const selection=el('span','尚未选择代码行'),check=el('button','校验'),add=el('button',options.action||'添加');add.disabled=true;check.disabled=true;footer.append(selection,check,add);
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
  note.hidden=!!options.hideNote;dialog.append(header,intro,context,tools,status,editor,note,footer);document.body.append(dialog);
  let slug,parent,files=[],runtime,selectedFile,line=1,candidate,revision=0,checking=false,localRevision=0,localFile;
  browse.disabled=true;
  const dispose=()=>{revision++;runtime?.dispose();runtime=null;candidate=null;};
  dialog.addEventListener('close',()=>{dispose();localRevision++;localFile=null;});close.onclick=()=>dialog.close();
  path.addEventListener('input',()=>{candidate=null;add.disabled=true;});
  open.onclick=async()=>{
    const file=files.find(f=>f.name===path.value.trim());if(!file){message('请从当前项目文件列表中选择，不能输入项目外路径。',true);return;}
    dispose();const version=revision;selectedFile=undefined;check.disabled=true;find.disabled=true;message('正在打开文件…');
    try {
      const source=await api.entrySource(slug,file.id);
      if(version!==revision||!dialog.open)return;
      const mounted=new EntryEditor(nextLine=>{
        if(version!==revision||!dialog.open||line===nextLine)return;
        line=nextLine;candidate=null;add.disabled=true;selection.textContent=`${file.name} : ${line}`;
      });runtime=mounted;
      await mounted.mount(editor,{path:source.name,language:source.name.endsWith('.java')?'java':'rust',startLine:1,focusLine:1,focusEndLine:1,scope:'file',lines:source.text.split('\n').map((text,i)=>({number:i+1,text}))});
      if(version!==revision||!dialog.open){mounted.dispose();return;}
      selectedFile=file;line=1;selection.textContent=`${file.name} : 1`;check.disabled=false;find.disabled=false;message('点击代码行或行号选择；Ctrl+F 搜索。');
    }catch(error){if(version===revision)message(error.message,true);}
  };
  browse.onclick=()=>{local.value='';local.click();};
  const openLocal=async(file)=>{
    const version=++localRevision,picked=localFile;
    browse.disabled=true;matches.disabled=true;check.disabled=true;open.disabled=true;path.disabled=true;message('正在确认项目文件…');
    try {
      const [source,text]=await Promise.all([api.entrySource(slug,file.id),picked.text()]);
      if(version!==localRevision||!dialog.open)return;
      if(source.text.replace(/\r\n/g,'\n')!==text.replace(/\r\n/g,'\n')){message('所选文件与项目源码不一致。请在当前项目目录内重新选择文件。',true);return;}
      path.value=file.name;matches.hidden=true;await open.onclick();
    }catch(error){if(version===localRevision)message(error.message,true);}
    finally{if(version===localRevision){browse.disabled=false;matches.disabled=false;open.disabled=false;path.disabled=false;check.disabled=!selectedFile;}}
  };
  local.onchange=()=>{
    localRevision++;localFile=local.files?.[0];matches.hidden=true;
    if(!localFile)return;
    candidate=null;add.disabled=true;
    if(localFile.size>2*1024*1024){message('文件超过 2 MiB，请选择较小的源文件。',true);return;}
    const candidates=files.filter(f=>f.name.split('/').pop()===localFile.name);
    if(!candidates.length){message(`未找到“${localFile.name}”：当前项目的可用源码列表中没有同名文件。请关闭此窗口检查项目，或重新选择该项目内的 .rs / .java 文件。构建目录和符号链接不在列表中。`,true);return;}
    if(candidates.length===1){void openLocal(candidates[0]);return;}
    const placeholder=el('option','请选择项目内对应路径');placeholder.value='';
    matches.replaceChildren(placeholder,...candidates.map(f=>{const option=el('option',f.name);option.value=f.id;return option;}));
    matches.hidden=false;matches.disabled=false;matches.focus();message('项目中有同名文件，请确认路径。');
  };
  matches.onchange=()=>{const file=files.find(f=>f.id===matches.value);if(file)void openLocal(file);};
  find.onclick=()=>runtime?.search().catch(error=>message(error.message,true));
  check.onclick=async()=>{
    if(!selectedFile||checking)return;checking=true;check.disabled=true;open.disabled=true;browse.disabled=true;matches.disabled=true;candidate=null;add.disabled=true;
    const version=revision,chosenLine=line,file=selectedFile;message('正在校验入口…');
    try {const result=await api.checkEntry(slug,file.id,chosenLine);if(version!==revision||!dialog.open)return;
      if(line!==chosenLine||path.value.trim()!==file.name){message('文件或选中行已改变，请打开目标文件后重新校验。',true);return;}
      candidate=result.candidateId;message(`可采集：${result.node.label} · ${result.node.file}:${result.node.line}。${result.message}`);add.disabled=false;
    }catch(error){if(version===revision)message(`无法添加：${error.message}`,true);}
    finally{checking=false;check.disabled=!selectedFile;open.disabled=false;browse.disabled=!files.length;matches.disabled=false;}
  };
  add.onclick=async()=>{if(!candidate)return;add.disabled=true;const originalSlug=slug,version=revision;try{
    const result=await api.createEntry(slug,{fromId:parent,candidateId:candidate,note:note.value});if(version===revision)dialog.close();onAdded(originalSlug,result.nodeId,result);
  }catch(error){if(version===revision){message(error.message,true);add.disabled=false;}}};
  return {async open(next,from){dispose();localRevision++;localFile=null;files=[];browse.disabled=true;matches.hidden=true;path.disabled=true;open.disabled=true;slug=next;parent=from;path.value='';note.value='';selectedFile=undefined;check.disabled=true;add.disabled=true;find.disabled=true;selection.textContent='尚未选择代码行';editor.textContent='打开文件后选择代码行。';context.textContent=options.context?.()||'';context.hidden=!context.textContent;dialog.showModal();message('正在读取项目文件…');const version=revision;
    try{files=await api.entryFiles(slug);if(version!==revision)return;browse.disabled=!files.length;path.disabled=!files.length;open.disabled=!files.length;list.replaceChildren(...files.map(f=>{const o=el('option');o.value=f.name;return o;}));message(files.length?'点击“浏览本地文件”选择源码，也可以输入项目内相对路径。':'当前项目没有可选择的 Rust 或 Java 源文件。');}
    catch(error){message(error.message,true);}
  }};
}
