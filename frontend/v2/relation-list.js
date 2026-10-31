// Progressive disclosure bounds DOM work without dropping any source relationships.
export function relationList(title, items, makeButton, open = items.length <= 5) {
  const details = document.createElement('details');
  details.className = 'relation-list';
  const summary = document.createElement('summary');
  summary.textContent = `${title}（${items.length}）`;
  const list = document.createElement('div');
  const more = document.createElement('button');
  let offset = 0;
  function append() {
    const end = Math.min(offset + 20, items.length);
    const fragment = document.createDocumentFragment();
    for (; offset < end; offset++) fragment.append(makeButton(items[offset]));
    list.append(fragment);
    more.hidden = offset === items.length;
    more.textContent = `继续显示 · 还有 ${items.length - offset} 项`;
  }
  more.onclick = append;
  details.append(summary, list, more);
  details.addEventListener('toggle', () => { if (details.open && offset === 0) append(); });
  if (open) { details.open = true; append(); }
  return details;
}
