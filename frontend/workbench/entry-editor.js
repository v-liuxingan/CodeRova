const wrapKey='coderova:source-word-wrap';
function wordWrap(){if(typeof window[wrapKey]==='boolean')return window[wrapKey];try{return localStorage.getItem(wrapKey)!=='false';}catch{return true;}}
function setWordWrap(active){window[wrapKey]=active;try{localStorage.setItem(wrapKey,String(active));}catch{}window.dispatchEvent(new CustomEvent('source-word-wrap',{detail:active}));}
// Monaco owns text selection and rendering inside its existing isolated surface.
export class EntryEditor {
  constructor(onLine=()=>{}, {selectable=true,loadMore}={}) { this.onLine=onLine; this.loadMore=loadMore; this.selectable=selectable; this.pending=new Map(); this.sequence=0; }
  async mount(container,preview) {
    this.preview=preview;
    this.frame=document.createElement('iframe');
    this.frame.className='entry-editor-frame'; this.frame.title=this.selectable?'源码选行编辑器':'只读源码预览';
    this.frame.src='/monaco-preview.html';
    const ready=new Promise((resolve,reject)=>{ this.readyResolve=resolve;this.readyReject=reject;this.readyTimer=setTimeout(()=>reject(new Error('编辑器加载超时，请重新打开文件。')),15000); });
    this.receive=event=>{
      if(event.source!==this.frame?.contentWindow||event.origin!==location.origin||event.data?.channel!=='callgraph-monaco')return;
      const data=event.data;
      if(data.type==='ready'){clearTimeout(this.readyTimer);this.readyResolve();}
      else if(data.type==='wrapChanged'){if(wordWrap()!==data.active)setWordWrap(data.active);}
      else if(data.type==='selection'&&Number.isInteger(data.line)&&data.line>0)this.onLine(data.line);
      else if(data.type==='response'){
        const request=this.pending.get(data.requestId);if(!request)return;
        clearTimeout(request.timer);this.pending.delete(data.requestId);
        if(data.ok)request.resolve(data.result);else request.reject(new Error(data.error));
      }
    };
    const bar=document.createElement('div');bar.className='code-preview-bar';
    const file=document.createElement('strong');file.textContent=preview.path.split(/[\\/]/).pop();file.title=preview.path;
    const meta=document.createElement('span');meta.className='code-preview-meta';meta.textContent=`${preview.language.toUpperCase()} · 只读`;
    const tools=document.createElement('div');tools.className='code-preview-actions';
    const action=(label,path,run)=>{const button=document.createElement('button');button.type='button';button.title=label;button.setAttribute('aria-label',label);button.innerHTML=`<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="${path}"/></svg>`;button.disabled=true;button.onclick=async()=>{try{await run(button);}catch(error){meta.textContent=error.message;}};tools.append(button);return button;};
    const search=action('搜索代码','M13 13l4 4M14 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0',()=>this.search());
    const wrap=action('自动换行','M3 5h14M3 9h11a3 3 0 0 1 0 6h-4m2-2-2 2 2 2M3 15h3',()=>setWordWrap(!wordWrap()));wrap.setAttribute('aria-pressed',String(wordWrap()));
    bar.append(file,meta,tools);
    window.addEventListener('message',this.receive);container.replaceChildren(bar,this.frame);
    if(this.loadMore){
      this.moreButtons=[];
      for(const direction of ['before','after']){
        const button=document.createElement('button');button.type='button';button.disabled=true;button.className='source-load-more';
        button.textContent=direction==='before'?'↑ 加载前 20 行':'↓ 加载后 20 行';
        button.onclick=()=>this.expand(direction);
        this.moreButtons.push(button);
        if(direction==='before')this.frame.before(button);else this.frame.after(button);
      }
      this.moreError=document.createElement('p');this.moreError.className='source-load-error';this.moreError.setAttribute('role','alert');container.append(this.moreError);this.updateMore();
    }
    await ready;
    await this.request('mount',{preview:{...preview,selectable:this.selectable,wrap:wordWrap()},theme:document.documentElement.dataset.theme});
    search.disabled=wrap.disabled=false;this.moreButtons?.forEach(button=>button.disabled=false);
    this.syncWrap=event=>{const active=event.type==='storage'?wordWrap():event.detail;wrap.setAttribute('aria-pressed',String(active));void this.request('wrap',{active}).then(()=>this.fillViewport()).catch(()=>{});};
    this.storageWrap=event=>{if(event.key===wrapKey){window[wrapKey]=event.newValue!=='false';this.syncWrap(event);}};
    window.addEventListener('source-word-wrap',this.syncWrap);window.addEventListener('storage',this.storageWrap);
    this.syncWrap({detail:wordWrap()});
    if(this.loadMore){
      this.resizeObserver=new ResizeObserver(()=>{clearTimeout(this.fillTimer);this.fillTimer=setTimeout(()=>void this.fillViewport(),80);});
      this.resizeObserver.observe(this.frame);
      await this.fillViewport();
    }
    this.themeObserver=new MutationObserver(()=>{void this.request('theme',{theme:document.documentElement.dataset.theme}).catch(()=>{});});
    this.themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  }
  async expand(direction){
    if(this.expanding||!this.frame)return false;
    this.expanding=true;this.moreButtons.forEach(button=>button.disabled=true);
    try{
      const next=await this.loadMore(direction,this.preview);if(!this.frame)return false;
      if(next.startLine===this.preview.startLine&&next.endLine===this.preview.endLine)return false;
      await this.request('extend',{preview:next});this.preview=next;this.updateMore();this.fillFailed=false;return true;
    }catch(error){this.fillFailed=true;if(this.frame)this.moreError.textContent=error.message;return false;}
    finally{this.expanding=false;this.moreButtons.forEach(button=>button.disabled=false);}
  }
  async fillViewport(){
    if(!this.loadMore||!this.frame||this.filling||this.expanding||this.fillFailed)return;
    this.filling=true;
    try{
      for(let step=0;step<30&&this.frame;step++){
        const size=await this.request('measure');
        if(size.viewport<=0||size.content>=size.viewport+10)break;
        const p=this.preview;
        const direction=p.truncatedBefore&&(!p.truncatedAfter||p.focusLine-p.startLine<=p.endLine-p.focusEndLine)?'before':p.truncatedAfter?'after':null;
        if(!direction||!await this.expand(direction))break;
      }
    }catch{}finally{this.filling=false;}
  }
  updateMore(){if(this.moreButtons){this.moreButtons[0].hidden=!this.preview.truncatedBefore;this.moreButtons[1].hidden=!this.preview.truncatedAfter;this.moreError.textContent='';}}
  request(type,data={}) {
    if(!this.frame)return Promise.reject(new Error('编辑器已关闭'));
    const requestId=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error('编辑器响应超时'));},15000);
      this.pending.set(requestId,{resolve,reject,timer});
      this.frame.contentWindow.postMessage({channel:'callgraph-monaco',type,requestId,...data},location.origin);
    });
  }
  search() { return this.request('action',{action:'find'}); }
  dispose() {
    window.removeEventListener('source-word-wrap',this.syncWrap);window.removeEventListener('storage',this.storageWrap);
    this.resizeObserver?.disconnect();clearTimeout(this.fillTimer);
    this.themeObserver?.disconnect();
    clearTimeout(this.readyTimer);this.readyReject?.(new Error('编辑器已关闭'));
    window.removeEventListener('message',this.receive);
    for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(new Error('编辑器已关闭'));}
    this.pending.clear();this.frame?.remove();this.frame=null;
  }
}
