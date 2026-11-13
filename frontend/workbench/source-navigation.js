import { ClickNavigationPolicy, isSourceTargetAvailable } from '../../public/js/click-navigation-policy.js';
import { editorLink } from './editor-link.js';

// Owns external navigation only. Source previews and graph selection stay independent.
export function sourceNavigation({ api, toggle, button, editor, notify, launch = uri => { window.location.href = uri; } }) {
  const policy = new ClickNavigationPolicy();
  if (editor) {
    try { editor.value = localStorage.getItem('callgraph-v2-editor') === 'idea' ? 'idea' : 'vscode'; } catch { editor.value = 'vscode'; }
    editor.addEventListener('change', () => {
      try { localStorage.setItem('callgraph-v2-editor', editor.value); } catch { /* Session preference still works. */ }
    });
  }
  let current = null, opening = false, pending = null, automaticRevision = 0;
  toggle.addEventListener('click', () => {
    const enabled = policy.toggle();
    automaticRevision++;
    if (!enabled && pending?.automatic) pending = null;
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = `自动跳转：${enabled ? '开' : '关'}`;
  });
  async function open(automatic = false) {
    if (!current) return;
    pending = {target:current, selectedEditor:editor?.value || 'vscode', automatic, revision:automaticRevision};
    if (opening) return;
    opening = true; button.disabled = true;
    try {
      while (pending) {
        const request = pending; pending = null;
        const {target,selectedEditor,automatic} = request;
        try {
          const result = await api.buildSourceLink(target.slug, target.type, target.id);
          if (target !== current || (automatic && (!policy.enabled || request.revision !== automaticRevision))) continue;
          launch(editorLink(result, selectedEditor));
          notify(selectedEditor === 'idea' ? '已请求 IDEA 打开源码；无响应时请检查 idea:// 协议关联' : '已请求在编辑器打开源码');
        } catch (error) {
          if (target === current && (!automatic || (policy.enabled && request.revision === automaticRevision))) notify(error.message, true);
        }
      }
    } finally { opening = false; button.disabled = !current; }
  }
  button.addEventListener('click', () => void open());
  return {
    clear() { current = null; pending = null; button.hidden = true; button.disabled = true; },
    select(graph, slug, type, id, userInitiated = false) {
      const target = { type, id };
      current = isSourceTargetAvailable(graph, target) ? { slug, ...target } : null;
      pending = null;
      button.hidden = !current; button.disabled = !current || opening;
      if (userInitiated && policy.shouldOpen(graph, target)) void open(true);
    },
  };
}
