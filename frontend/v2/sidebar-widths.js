const storageKey = 'callgraph-v2-sidebar-widths';

export function sidebarWidths(workspace, handles, { onDragChange = () => {} } = {}) {
  const defaults = () => ({ library: Math.min(320, Math.max(264, innerWidth * .22)), inspector: 320 });
  let preferred = defaults(), widths = {}, drag = null, frame = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    for (const side of ['library', 'inspector']) if (Number.isFinite(saved?.[side]) && saved[side] > 0) preferred[side] = saved[side];
  } catch { /* Width preferences never block the workbench. */ }
  const collapsed = side => workspace.classList.contains(`${side}-collapsed`);
  const minimum = side => side === 'library' ? 220 : 260;
  const available = () => workspace.clientWidth - (innerWidth > 1100 ? 320 : 280);
  const visible = side => innerWidth > (side === 'library' ? 600 : 1100) && !collapsed(side);
  function render() {
    cancelAnimationFrame(frame); frame = 0;
    const active = Object.keys(handles).filter(visible);
    widths = Object.fromEntries(Object.keys(handles).map(side => [side, Math.max(minimum(side), Math.min(preferred[side], available()))]));
    let excess = active.reduce((sum, side) => sum + widths[side], 0) - available();
    // Preserve the actively dragged panel's sibling. Window resizes clamp widths
    // without overwriting the user's desktop preference.
    const shrink = drag ? active.filter(s => s === drag.side) : active;
    for (const side of shrink) {
      const reduction = Math.min(Math.max(0, excess), widths[side] - minimum(side));
      widths[side] -= reduction; excess -= reduction;
    }
    for (const side of Object.keys(handles)) {
      workspace.style.setProperty(`--${side}-width`, `${Math.round(widths[side])}px`);
      const other = side === 'library' ? 'inspector' : 'library';
      const max = Math.max(minimum(side), available() - (visible(other) ? widths[other] : 0));
      const handle = handles[side];
      handle.hidden = !visible(side);
      handle.setAttribute('aria-valuemin', String(minimum(side)));
      handle.setAttribute('aria-valuemax', String(Math.round(max)));
      handle.setAttribute('aria-valuenow', String(Math.round(widths[side])));
      handle.setAttribute('aria-valuetext', `${Math.round(widths[side])} 像素`);
    }
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(preferred)); } catch { /* Session-only resize is still useful. */ }
  }
  function finish(cancel = false) {
    if (!drag) return;
    const current = drag;
    if (cancel) preferred[current.side] = current.before;
    render();
    if (!cancel) preferred[current.side] = widths[current.side];
    drag = null;
    workspace.classList.remove('resizing-sidebar');
    onDragChange(false);
    if (current.handle.hasPointerCapture(current.id)) current.handle.releasePointerCapture(current.id);
    if (!cancel) persist();
  }
  for (const [side, handle] of Object.entries(handles)) {
    const sign = side === 'library' ? 1 : -1;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !visible(side) || drag) return;
      event.preventDefault();
      drag = { side, handle, id: event.pointerId, x: event.clientX, width: widths[side], before: preferred[side] };
      handle.setPointerCapture(event.pointerId); handle.focus();
      workspace.classList.add('resizing-sidebar');
      onDragChange(true);
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      preferred[side] = drag.width + sign * (event.clientX - drag.x);
      if (!frame) frame = requestAnimationFrame(render);
    });
    handle.addEventListener('pointerup', event => { if (drag?.id === event.pointerId) finish(); });
    handle.addEventListener('pointercancel', event => { if (drag?.id === event.pointerId) finish(true); });
    handle.addEventListener('lostpointercapture', event => { if (drag?.id === event.pointerId) finish(true); });
    handle.addEventListener('dblclick', () => { preferred[side] = defaults()[side]; render(); persist(); });
    handle.addEventListener('keydown', event => {
      if (event.key === 'Escape' && drag) { event.preventDefault(); finish(true); return; }
      if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
      event.preventDefault();
      preferred[side] = event.key === 'Home' ? defaults()[side] : widths[side] + sign * (event.key === 'ArrowRight' ? 20 : -20);
      render(); preferred[side] = widths[side]; persist();
    });
  }
  window.addEventListener('blur', () => finish(true));
  window.addEventListener('resize', () => { finish(true); render(); });
  new MutationObserver(() => {
    if (drag && !visible(drag.side)) finish(true);
    render();
  }).observe(workspace, { attributes: true, attributeFilter: ['class'] });
  render();
}
