export function collectionDialog(onStarted) {
  const dialog = document.createElement('dialog');
  dialog.className = 'tree-dialog collection-dialog';
  dialog.setAttribute('aria-labelledby', 'collection-title');
  dialog.innerHTML = `<form>
    <h2 id="collection-title">继续采集</h2>
    <div class="collection-target"><strong></strong><span></span></div>
    <div class="collection-limits">
      <label for="resume-depth">采集深度<input id="resume-depth" type="number" min="1" max="100" value="3" placeholder="不限"><small>起点为第 0 层</small></label>
      <label for="resume-budget">新增节点上限<input id="resume-budget" type="number" min="1" max="10000" value="100" placeholder="不限"><small>不计已有节点</small></label>
    </div>
    <p class="collection-hint">可只填写一项；留空表示不限。达到任一上限即停止。重复符号与调用点自动合并，保留已有说明。</p>
    <p class="collection-error" role="alert" hidden></p>
    <div class="dialog-actions"><button type="button">取消</button><button type="submit">开始采集</button></div>
  </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form'), input = dialog.querySelector('#resume-budget'), depth = dialog.querySelector('#resume-depth');
  const cancel = dialog.querySelector('[type=button]'), submit = dialog.querySelector('[type=submit]');
  const error = dialog.querySelector('.collection-error');
  let start, busy = false;
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true; cancel.disabled = submit.disabled = depth.disabled = input.disabled = true;
    submit.textContent = '正在启动…'; error.hidden = true;
    try {
      const limits = {};
      if (input.value !== '') limits.maxNodes = Number(input.value);
      if (depth.value !== '') limits.maxDepth = Number(depth.value);
      const task = await start(limits);
      dialog.close(); onStarted(task);
    } catch (cause) { error.textContent = cause.message; error.hidden = false; }
    finally {
      busy = false; cancel.disabled = submit.disabled = depth.disabled = input.disabled = false;
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
