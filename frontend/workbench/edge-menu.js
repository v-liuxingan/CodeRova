// A single DOM menu keeps native keyboard interaction out of the canvas shapes.
export function edgeMenu(onCollapse, onCollect, onAdd, onPrune, onHide, onDescribe) {
  const menu = document.createElement('div');
  menu.id = 'edge-context-menu'; menu.className = 'edge-context-menu';
  menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '分支操作'); menu.hidden = true;
  const header = document.createElement('div'); header.className = 'edge-menu-header';
  const heading = document.createElement('strong');
  const title = document.createElement('div'); title.className = 'edge-menu-target';
  const location = document.createElement('div'); location.className = 'edge-menu-location';
  header.append(heading, title, location);
  const button = document.createElement('button'); button.setAttribute('role', 'menuitem');
  button.textContent = '收起下游';
  const hint = document.createElement('div'); hint.className = 'edge-menu-hint';
  const collect=document.createElement('button'),add=document.createElement('button');
  collect.setAttribute('role','menuitem');add.setAttribute('role','menuitem');
  collect.textContent='继续采集';add.textContent='添加节点';
  collect.addEventListener('click',()=>{const id=target;close();if(id)void onCollect(id);});
  add.addEventListener('click',()=>{const id=target;close();if(id)void onAdd(id);});
  const prune=document.createElement('button');prune.setAttribute('role','menuitem');prune.textContent='删除';prune.addEventListener('click',()=>{const id=target;close();if(id)void onPrune(id);});
  const hide=document.createElement('button');hide.setAttribute('role','menuitem');hide.textContent='隐藏';hide.addEventListener('click',()=>{const id=target;close();if(id)void onHide(id);});
  const describe=document.createElement('button');describe.setAttribute('role','menuitem');describe.textContent='编辑说明';
  describe.addEventListener('click',()=>{const item=editTarget;close();if(item)onDescribe(item.type,item.id);});
  const divider = () => { const el=document.createElement('div');el.className='edge-menu-divider';el.setAttribute('role','separator');return el; };
  const editingDivider=divider();
  const icon = (control, path) => {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('aria-hidden','true');
    const shape=document.createElementNS(svg.namespaceURI,'path');shape.setAttribute('d',path);svg.append(shape);
    const text=document.createElement('span');text.textContent=control.textContent;control.replaceChildren(svg,text);
  };
  icon(button,'M4 5h12M4 15h12m3-7 3 3 3-3');
  icon(collect,'M7 4v12l9-6Z');
  icon(add,'M10 4v12M4 10h12');
  icon(hide,'m3 3 14 14M8 4.5c4-1 7 2 9 5.5-.8 1.4-1.7 2.5-2.8 3.3M5.5 5.5C3.7 6.7 2.5 8.2 2 10c2.7 4 6 6 10 4.7');
  icon(describe,'m4 13-1 4 4-1L17 6l-3-3Z M12 5l3 3');
  icon(prune,'M4 6h12M8 6V3h4v3M6 6l1 11h6l1-11M9 9v5m2-5v5');
  prune.className='edge-menu-danger';
  menu.append(header, button, collect, add, editingDivider, describe, hide, prune, hint); document.body.append(menu);
  let target, editTarget;
  const close = () => { menu.hidden = true; target = null; editTarget = null; };
  button.addEventListener('click', () => { const id = target; close(); if (id) void onCollapse(id); });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) close(); }, true);
  document.addEventListener('keydown', event => {
    if (menu.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); document.getElementById('canvas').focus(); }
    if (event.key === 'Tab') close();
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();
      const items=[...menu.querySelectorAll('button')].filter(item=>!item.hidden&&!item.disabled);
      if(!items.length)return;
      const index=items.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
      items[next].focus();
    }
  });
  window.addEventListener('resize', close);
  window.addEventListener('scroll', close, true);
  return { close, open({ editTarget: descriptionTarget, id, label, enabled, isNode=false, canCollect=false, canAdd=false, canPrune=false, file, line, x, y }) {
    hide.hidden=false;hide.disabled=!canPrune;prune.hidden=false;prune.disabled=!canPrune;
    collect.hidden=!isNode;add.hidden=!isNode;collect.disabled=!canCollect;add.disabled=!canAdd;
    editTarget = descriptionTarget; describe.hidden = !editTarget;
    target = id; heading.textContent=isNode?'节点操作':'连线操作';
    title.textContent = label; title.title = label;
    location.textContent=file?`${file.split(/[\\/]/).pop()}${line?`:${line}`:''}`:'';
    location.title=file||'';location.hidden=!file;editingDivider.hidden=false;
    collect.title=canCollect?'继续采集':'仅待采集且没有已知下游的叶子节点可采集';
    add.title=canAdd?'选择源码中的函数作为后续节点':'当前图未配置 LSP 分析，暂不支持添加';
    hide.title=canPrune?'刷新后恢复，或使用恢复隐藏':'入口节点不能隐藏';
    prune.title=canPrune?'移除节点及独占下游，保存修改后写入文件':'入口节点不能删除';
    button.disabled = !enabled;
    button.title=enabled?'保留此节点，收起其下游':'没有可独立收起的下游';
    hint.textContent=isNode?'隐藏仅本次有效；删除需保存后生效。':'说明针对连线；其他操作针对箭头指向的节点。';
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
    [button, collect, add, describe, hide, prune].find(item => !item.hidden && !item.disabled)?.focus({ preventScroll: true });
  } };
}
