// A single DOM menu keeps native keyboard interaction out of the canvas shapes.
export function edgeMenu(onCollapse) {
  const menu = document.createElement('div');
  menu.id = 'edge-context-menu'; menu.className = 'edge-context-menu';
  menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '分支操作'); menu.hidden = true;
  const title = document.createElement('div'); title.className = 'edge-menu-target';
  const button = document.createElement('button'); button.setAttribute('role', 'menuitem');
  button.textContent = '收起此分支';
  const hint = document.createElement('div'); hint.className = 'edge-menu-hint';
  menu.append(title, button, hint); document.body.append(menu);
  let target;
  const close = () => { menu.hidden = true; target = null; };
  button.addEventListener('click', () => { const id = target; close(); if (id) void onCollapse(id); });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) close(); }, true);
  document.addEventListener('keydown', event => {
    if (menu.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); document.getElementById('canvas').focus(); }
    if (event.key === 'Tab') close();
  });
  window.addEventListener('resize', close);
  window.addEventListener('scroll', close, true);
  return { close, open({ id, label, enabled, x, y }) {
    target = id; title.textContent = label; title.title = label;
    button.disabled = !enabled;
    hint.textContent = enabled ? '保留此节点，收起其下游' : '没有可独立收起的下游';
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
    if (enabled) button.focus({ preventScroll: true });
  } };
}
