import {autoUpdate, computePosition, flip, offset, shift} from '@floating-ui/dom';

export function toolbarPopover(panel) {
  const anchor = panel.querySelector('summary');
  const body = anchor?.nextElementSibling;
  if (!body) return;
  body.classList.add('toolbar-floating');
  // Plain-text clicks must focus inside the panel, not its focusable page
  // ancestor. Otherwise focusout can hide <details> during native mouse focus.
  if (!body.hasAttribute('tabindex')) body.tabIndex = -1;
  let cleanup, revision = 0;
  panel.addEventListener('toggle', () => {
    cleanup?.(); cleanup = undefined;
    const current = ++revision;
    if (!panel.open) return;
    cleanup = autoUpdate(anchor, body, async () => {
      const {x, y} = await computePosition(anchor, body, {
        strategy: 'fixed', placement: 'bottom-start',
        middleware: [offset(8), flip({padding: 12}), shift({padding: 12})],
      });
      if (panel.open && current === revision) Object.assign(body.style, {left: `${x}px`, top: `${y}px`});
    });
  });
}
