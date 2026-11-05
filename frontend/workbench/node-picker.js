import TomSelect from 'tom-select';

// All symbols stay searchable in memory; only the first 100 results become DOM.
export function nodePicker(select, onMatches) {
  let query = '';
  const trimNativeOptions=()=>{for(const option of [...select.options])if(!option.selected)option.remove();};
  const control = new TomSelect(select, {
    plugins: ['dropdown_input'], create:false, maxOptions:100, closeAfterSelect:true,
    openOnFocus:false, diacritics:false, refreshThrottle:0,
    placeholder:'搜索方法、类或文件…',
    searchField:['text','owner','file','value'], sortField:[{field:'$order',direction:'asc'}],
    render:{
      option:(data,escape)=>`<div aria-label="${escape(data.text)}"><strong class="node-option-title">${escape(data.text)}</strong><span class="node-option-context">${escape([data.owner,data.file ? `${data.file}:${data.line || 1}` : ''].filter(Boolean).join(' · '))}</span></div>`,
      no_results:()=>'<div class="no-results">没有匹配节点</div>',
    },
    onType(value) {query=value;onMatches(this.search(value).items.map(item=>item.id));},
    onChange:trimNativeOptions,
    onInitialize() {
      this.focus_node.setAttribute('aria-label','搜索并选择节点');
      this.control_input.setAttribute('aria-label','搜索方法、类或文件');
      this.control_input.placeholder='方法名、类名或文件名';
    },
    onDropdownOpen() {this.setTextboxValue(query);this.refreshOptions(false);},
  });
  control.wrapper.dataset.selectId=select.id;
  let wasOpen=false;
  control.control.addEventListener('pointerdown',()=>{wasOpen=control.isOpen;},true);
  control.control.addEventListener('click',()=>{if(!wasOpen&&!control.isDisabled)control.open();});
  const note=document.createElement('div');note.className='node-search-limit';note.setAttribute('role','status');
  control.dropdown.append(note);
  const updateNote=()=>{const total=control.search(query).items.length;note.hidden=total<=100;note.textContent=`显示前 100 / ${total} 项，请输入关键词缩小范围`;};
  control.on('type',updateNote);control.on('dropdown_open',updateNote);
  return {
    update(nodes) {
      const selected=control.getValue();query='';control.clear(true);control.clearOptions();control.clearCache();
      control.addOptions(nodes.map((n,index)=>({value:n.id,text:n.label,owner:n.symbol?.ownerName||'',file:n.file||'',line:n.line,$order:index})));
      if(control.options[selected])control.setValue(selected,true);
      control.setTextboxValue('');control.refreshOptions(false);onMatches(nodes.map(n=>n.id));updateNote();trimNativeOptions();
    },
    select(id) {control.setValue(id,true);trimNativeOptions();},
    clear() {control.clear(true);trimNativeOptions();},
  };
}
