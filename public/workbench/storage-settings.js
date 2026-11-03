import {CodeRovaApi} from '/js/api.js';
const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text || ''; return node; };
export function installStorageSettings() {
  const trigger = document.getElementById('storage-settings');
  trigger.onclick = async () => {
    const api = new CodeRovaApi();
    const dialog = element('dialog'); dialog.className = 'tree-dialog storage-dialog';
    const title = element('h2', '资料库存储'); title.id = 'storage-title'; dialog.setAttribute('aria-labelledby', title.id);
    const content = element('div'); const status = element('p', '正在读取…'); status.setAttribute('role', 'status');
    const actions = element('div'); actions.className = 'dialog-actions';
    const close = element('button', '关闭'), choose = element('button', '选择目录'), save = element('button', '保存位置');
    save.className = 'primary'; save.hidden = true;
    actions.append(close, choose, save); dialog.append(title, content, status, actions); document.body.append(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); trigger.focus(); }); close.onclick = () => dialog.close(); dialog.showModal();
    let selected;
    function paint(info) {
      content.replaceChildren();
      for (const [label, value] of [['当前目录', info.root], ...(info.restartRequired ? [['重启后使用', info.nextRoot]] : []), ['配置文件', info.configFile]]) {
        const row = element('label', label), path = element('code', value); row.append(path); content.append(row);
      }
      content.append(element('p', '默认使用 graphs。分组、图文件与独立说明一同保存在资料库目录中。'));
      status.textContent = info.commandLineOverride ? '当前由 --graphs 参数指定位置。页面配置已保存时，需去掉该参数再重启服务才能生效。' : info.restartRequired ? '已保存。重启服务后使用新目录；现有文件保留原位。' : '更改目录在重启服务后生效，不会自动搬移现有文件。';
    }
    choose.onclick = async () => {
      choose.disabled = true;
      try { const value = await api.selectProjectDirectory(); if (!dialog.open || value.cancelled) return;
        selected = value; status.textContent = `将使用：${value.path || value.root || value.name}。保存后重启服务生效。`; save.hidden = false;
      } catch (error) { status.textContent = error.message; } finally { choose.disabled = false; }
    };
    save.onclick = async () => {
      save.disabled = choose.disabled = true;
      try { paint(await api.configureStorage(selected.selectionId)); save.hidden = true; }
      catch (error) { status.textContent = error.message; }
      finally { save.disabled = choose.disabled = false; }
    };
    try { paint(await api.storage()); } catch (error) { status.textContent = error.message; choose.disabled = true; }
  };
}
