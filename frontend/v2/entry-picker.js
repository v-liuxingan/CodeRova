const el=(tag,text)=>{const item=document.createElement(tag);if(text)item.textContent=text;return item;};
export function entryPicker(api,onAdded) {
  const dialog=el('dialog');dialog.className='entry-picker';dialog.setAttribute('aria-label','添加节点');
  const header=el('div');header.className='entry-picker-heading';header.append(el('h2','添加节点'));
  const close=el('button','关闭');close.setAttribute('aria-label','关闭');header.append(close);
  const intro=el('p','打开文件，选择函数所在行，校验后添加。点击主页面“保存”后写入文件。');
  const tools=el('div');tools.className='entry-picker-tools';
  const path=el('input');path.placeholder='输入或选择项目内源文件';path.setAttribute('aria-label','项目文件');path.setAttribute('list','entry-files');path.autocomplete='off';
  const list=el('datalist');list.id='entry-files';const open=el('button','打开文件'),find=el('button','搜索代码');find.disabled=true;tools.append(path,list,open,find);
  const editor=el('div');editor.className='entry-picker-editor';editor.textContent='打开文件后，在这里选择函数定义或函数体内的一行。';
  const footer=el('div');footer.className='entry-picker-footer';const selection=el('span','尚未选择代码行'),check=el('button','校验'),add=el('button','添加');add.disabled=true;check.disabled=true;footer.append(selection,check,add);
  const note=el('input');note.placeholder='关联说明（可选）：消息名、事件、接收逻辑等';note.setAttribute('aria-label','入口关联说明');note.maxLength=2000;
  const status=el('p');status.setAttribute('role','status');status.className='entry-picker-status';
  dialog.append(header,intro,tools,editor,note,footer,status);document.body.append(dialog);
  let slug,parent,files=[],runtime,selectedFile,line=1,candidate,revision=0,checking=false;
  const dispose=()=>{revision++;runtime?.dispose();runtime=null;candidate=null;};
  dialog.addEventListener('close',dispose);close.onclick=()=>dialog.close();
  path.addEventListener('input',()=>{candidate=null;add.disabled=true;});
  open.onclick=async()=>{
    const file=files.find(f=>f.name===path.value.trim());if(!file){status.textContent='请从当前项目文件列表中选择，不能输入项目外路径。';return;}
    dispose();const version=revision;selectedFile=undefined;check.disabled=true;find.disabled=true;status.textContent='正在打开文件…';
    try {
      const source=await api.entrySource(slug,file.id);
      const runtimeUrl='/js/source-surfaces/monaco-editor-runtime.js';
      const {MonacoEditorRuntime}=await import(runtimeUrl);
      if(version!==revision||!dialog.open)return;
      const mounted=new MonacoEditorRuntime();runtime=mounted;
      await mounted.mount(editor,{path:source.name,language:source.name.endsWith('.java')?'java':'rust',startLine:1,focusLine:1,focusEndLine:1,scope:'file',lines:source.text.split('\n').map((text,i)=>({number:i+1,text}))});
      if(version!==revision||!dialog.open){mounted.dispose();return;}
      selectedFile=file;line=1;selection.textContent=`${file.name} : 1`;check.disabled=false;find.disabled=false;status.textContent='点击代码行或行号选择；Ctrl+F 搜索。';
      runtime.editor.onDidChangeCursorSelection(event=>{line=event.selection.startLineNumber;candidate=null;add.disabled=true;selection.textContent=`${file.name} : ${line}`;});
    }catch(error){if(version===revision)status.textContent=error.message;}
  };
  find.onclick=()=>runtime?.editor.getAction('actions.find').run();
  check.onclick=async()=>{
    if(!selectedFile||checking)return;checking=true;check.disabled=true;open.disabled=true;candidate=null;add.disabled=true;
    const version=revision,chosenLine=line,file=selectedFile;status.textContent='LSP 正在确认函数身份，首次索引可能需要一些时间…';
    try {const result=await api.checkEntry(slug,file.id,chosenLine);if(version!==revision||!dialog.open)return;
      if(line!==chosenLine||path.value.trim()!==file.name){status.textContent='文件或选中行已改变，请打开目标文件后重新校验。';return;}
      candidate=result.candidateId;status.textContent=`可采集：${result.node.label} · ${result.node.file}:${result.node.line}。${result.message}`;add.disabled=false;
    }catch(error){if(version===revision)status.textContent=`无法添加：${error.message}`;}
    finally{checking=false;check.disabled=!selectedFile;open.disabled=false;}
  };
  add.onclick=async()=>{if(!candidate)return;add.disabled=true;const originalSlug=slug,version=revision;try{
    const result=await api.createEntry(slug,{fromId:parent,candidateId:candidate,note:note.value});if(version===revision)dialog.close();onAdded(originalSlug,result.nodeId);
  }catch(error){if(version===revision){status.textContent=error.message;add.disabled=false;}}};
  return {async open(next,from){dispose();slug=next;parent=from;path.value='';note.value='';selectedFile=undefined;check.disabled=true;add.disabled=true;find.disabled=true;selection.textContent='尚未选择代码行';editor.textContent='打开文件后选择代码行。';dialog.showModal();status.textContent='正在读取项目文件…';const version=revision;
    try{files=await api.entryFiles(slug);if(version!==revision)return;list.replaceChildren(...files.map(f=>{const o=el('option');o.value=f.name;return o;}));status.textContent=`找到 ${files.length} 个源文件。`;}
    catch(error){status.textContent=error.message;}
  }};
}
