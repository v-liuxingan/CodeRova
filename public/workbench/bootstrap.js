import {installControls} from '/vendor/components/controls.js';
import {installStorageSettings} from './storage-settings.js';
installControls();
installStorageSettings();
// One product entry. Old deep links are normalized without loading another UI.
const url = new URL(location.href);
if (url.pathname !== '/') {
  url.pathname = '/';
  history.replaceState(null, '', url);
}
const scene = url.searchParams.get('scene');
if (scene && /^[a-z0-9][a-z0-9_-]*$/.test(scene)) {
  location.replace(`/scenes/${encodeURIComponent(scene)}.html`);
} else if (url.searchParams.has('graph') || url.searchParams.get('view') === 'workbench') {
  document.getElementById('enter-workbench').hidden = true;
  document.querySelector('.workspace').hidden = false;
  import('/vendor/workbench/workbench.js').catch(error => {
    document.getElementById('status').textContent = `工作台加载失败：${error.message}。请刷新重试。`;
  });
} else {
  document.querySelector('.skip-link').href = '#project-home';
  document.getElementById('project-home').hidden = false;
  import('./home.js');
}
