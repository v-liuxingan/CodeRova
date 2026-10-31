export function collectionDialog(onStarted) {
  const dialog = document.createElement('dialog');
  dialog.className = 'tree-dialog collection-dialog';
  dialog.setAttribute('aria-labelledby', 'collection-title');
  dialog.innerHTML = `<form>
    <h2 id="collection-title">继续采集</h2>
    <div class="collection-target"><strong></strong><span></span></div>
    <label for="resume-budget">请求预算</label>
    <input id="resume-budget" type="number" min="1" max="1000" step="1" value="100" required aria-describedby="collection-budget-help">
    <p id="collection-budget-help">本轮最多查询多少次调用关系（1–1000）。预算越大，耗时可能越长。</p>
    <p>从所选节点向下采集，仅分析当前项目。结果暂存，采纳并保存后才写入图文件。可随时请求停止。</p>
    <p class="collection-error" role="alert" hidden></p>
    <div class="dialog-actions"><button type="button">取消</button><button type="submit">开始采集</button></div>
  </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form'), input = dialog.querySelector('input');
  const cancel = dialog.querySelector('[type=button]'), submit = dialog.querySelector('[type=submit]');
  const error = dialog.querySelector('.collection-error');
  let start, busy = false;
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true; cancel.disabled = submit.disabled = input.disabled = true;
    submit.textContent = '正在启动…'; error.hidden = true;
    try {
      const task = await start(Number(input.value));
      dialog.close(); onStarted(task);
    } catch (cause) { error.textContent = cause.message; error.hidden = false; }
    finally {
      busy = false; cancel.disabled = submit.disabled = input.disabled = false;
      submit.textContent = '开始采集';
    }
  });
  return { open(target, onSubmit) {
    if (dialog.open) return;
    start = onSubmit; error.hidden = true;
    dialog.querySelector('strong').textContent = target.label;
    dialog.querySelector('.collection-target span').textContent = `${target.file}:${target.line}`;
    dialog.showModal(); input.focus(); input.select();
  } };
}
