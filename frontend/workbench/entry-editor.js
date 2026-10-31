// Monaco owns text selection and rendering inside its existing isolated surface.
export class EntryEditor {
  constructor(onLine) { this.onLine=onLine; this.pending=new Map(); this.sequence=0; }
  async mount(container,preview) {
    this.frame=document.createElement('iframe');
    this.frame.className='entry-editor-frame'; this.frame.title='源码选行编辑器';
    this.frame.src='/monaco-preview.html';
    const ready=new Promise((resolve,reject)=>{ this.readyResolve=resolve;this.readyReject=reject;this.readyTimer=setTimeout(()=>reject(new Error('编辑器加载超时，请重新打开文件。')),15000); });
    this.receive=event=>{
      if(event.source!==this.frame?.contentWindow||event.origin!==location.origin||event.data?.channel!=='callgraph-monaco')return;
      const data=event.data;
      if(data.type==='ready'){clearTimeout(this.readyTimer);this.readyResolve();}
      else if(data.type==='selection'&&Number.isInteger(data.line)&&data.line>0)this.onLine(data.line);
      else if(data.type==='response'){
        const request=this.pending.get(data.requestId);if(!request)return;
        clearTimeout(request.timer);this.pending.delete(data.requestId);
        if(data.ok)request.resolve(data.result);else request.reject(new Error(data.error));
      }
    };
    window.addEventListener('message',this.receive);container.replaceChildren(this.frame);
    await ready;
    await this.request('mount',{preview:{...preview,selectable:true},theme:document.documentElement.dataset.theme});
  }
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
    clearTimeout(this.readyTimer);this.readyReject?.(new Error('编辑器已关闭'));
    window.removeEventListener('message',this.receive);
    for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(new Error('编辑器已关闭'));}
    this.pending.clear();this.frame?.remove();this.frame=null;
  }
}
