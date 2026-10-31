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
  let current = null, opening = false;
  toggle.addEventListener('click', () => {
    const enabled = policy.toggle();
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = `点击跳转：${enabled ? '开' : '关'}`;
  });
  async function open() {
    if (!current || opening) return;
    const target = current;
    const selectedEditor = editor?.value || 'vscode';
    opening = true; button.disabled = true;
    try {
      const result = await api.buildSourceLink(target.slug, target.type, target.id);
      if (target !== current) return;
      launch(editorLink(result, selectedEditor));
      notify(selectedEditor === 'idea' ? '已请求 IDEA 打开源码；无响应时请检查 idea:// 协议关联' : '已请求在编辑器打开源码');
    } catch (error) {
      if (target === current) notify(error.message, true);
    } finally { opening = false; button.disabled = !current; }
  }
  button.addEventListener('click', () => void open());
  return {
    clear() { current = null; button.hidden = true; button.disabled = true; },
    select(graph, slug, type, id, clicked = false) {
      const target = { type, id };
      current = isSourceTargetAvailable(graph, target) ? { slug, ...target } : null;
      button.hidden = !current; button.disabled = !current || opening;
      if (clicked && policy.shouldOpen(graph, target)) void open();
    },
  };
}
