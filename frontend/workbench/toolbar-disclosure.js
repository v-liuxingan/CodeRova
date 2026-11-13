// Separate compact/desktop preferences: trying the toolbar on a phone should
// not unexpectedly hide it on the desktop (or vice versa).
export function toolbarDisclosure(button, toolbar) {
  const media = matchMedia('(max-width: 800px), (max-height: 650px)');
  const key = 'callgraph-toolbar-expanded';
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem(key)) || {}; } catch { /* Defaults remain usable. */ }
  if (typeof preferences !== 'object' || Array.isArray(preferences)) preferences = {};
  const mode = () => media.matches ? 'compact' : 'desktop';
  function render() {
    const saved = preferences[mode()];
    const expanded = typeof saved === 'boolean' ? saved : !media.matches;
    if (!expanded) {
      if (toolbar.contains(document.activeElement)) button.focus();
      // Close floating entry panels, but preserve their nested review sections.
      for (const details of toolbar.querySelectorAll('details[open]')) {
        if (!details.parentElement.closest('details')) details.open = false;
      }
      for (const select of toolbar.querySelectorAll('select')) select.tomselect?.close();
    }
    toolbar.hidden = !expanded;
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', expanded ? '收起工具栏' : '展开工具栏');
    button.title = expanded ? '收起工具栏' : '展开工具栏';
  }
  button.addEventListener('click', () => {
    preferences[mode()] = toolbar.hidden;
    try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { /* Session preference still works. */ }
    render();
  });
  media.addEventListener('change', render);
  render();
}
