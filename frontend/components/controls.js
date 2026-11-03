import TomSelect from 'tom-select';
import 'tom-select/dist/css/tom-select.default.css';

// Keep domain code and native form submission on the original select. The
// component owns only presentation, searching and keyboard interaction.
const mounted = new Map();
function enhance(select) {
  if (mounted.has(select) || select.multiple) return;
  const label = select.getAttribute('aria-label') || select.labels?.[0]?.textContent.trim() || select.title || '选择选项';
  const searchable = select.dataset.search !== 'false';
  const control = new TomSelect(select, {
    plugins: searchable ? ['dropdown_input'] : [],
    ...(searchable ? {} : {controlInput:null}),
    create: false, maxOptions: 200, allowEmptyOption: true, closeAfterSelect: true, openOnFocus:false,
    // Preserve identifier/source-location punctuation instead of folding it away.
    diacritics: false, refreshThrottle:0,
    sortField: [{field:'$order',direction:'asc'}],
    render: {no_results: () => '<div class="no-results">没有匹配项</div>'},
    onInitialize() { this.focus_node.setAttribute('aria-label',label);this.control_input.setAttribute('aria-label',`搜索 ${label}`); },
  });
  control.wrapper.dataset.selectId = select.id;
  // Restoring focus after a modal/editor jump must not reopen a covering popup.
  let wasOpen = false;
  control.control.addEventListener('pointerdown',()=>{wasOpen=control.isOpen;},true);
  control.control.addEventListener('click',()=>{if(!wasOpen && !control.isDisabled)control.open();});
  select.focus = () => control.focus();
  let signature = '', syncing = false, queued = false;
  const fingerprint = () => JSON.stringify([...select.options].map(o => [o.value,o.text,o.disabled]).sort((a,b)=>a[0].localeCompare(b[0])));
  const sync = () => {
    queued = false;
    if (syncing || !select.isConnected) return;
    syncing = true;
    const wasOpen = control.isOpen;
    try {
      const next = fingerprint();
      if (next !== signature) {
        control.clearOptions(() => false);
        control.sync();
        signature = fingerprint();
      } else if (String(control.getValue()) !== select.value) control.setValue(select.value, true);
      if (select.disabled !== control.isDisabled) select.disabled ? control.disable() : control.enable();
      control.focus_node.setAttribute('aria-disabled',String(select.disabled));
      control.wrapper.hidden = select.hidden;
      control.refreshOptions(false);
      if (!wasOpen) control.close();
    } finally { syncing = false; }
  };
  const schedule = () => { if (!queued && !syncing) { queued = true; queueMicrotask(sync); } };
  // Property writes do not emit DOM mutations (notably the selected graph node).
  for (const property of ['value','selectedIndex']) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, property);
    Object.defineProperty(select, property, {configurable:true, get() { return descriptor.get.call(this); }, set(value) { descriptor.set.call(this,value); schedule(); }});
  }
  const observer = new MutationObserver(schedule);
  observer.observe(select,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','hidden','label','value','selected']});
  select.addEventListener('change',schedule);
  const invalid = event => {event.preventDefault();control.wrapper.classList.add('invalid');control.focus();};
  const valid = () => control.wrapper.classList.remove('invalid');
  select.addEventListener('invalid',invalid);
  select.addEventListener('change',valid);
  mounted.set(select,()=>{observer.disconnect();select.removeEventListener('change',schedule);select.removeEventListener('change',valid);select.removeEventListener('invalid',invalid);control.destroy();delete select.value;delete select.selectedIndex;delete select.focus;});
  signature = fingerprint();
  sync();
}

export function installControls() {
  const scan = root => {
    if (root instanceof HTMLSelectElement) enhance(root);
    root.querySelectorAll?.('select:not([data-native])').forEach(enhance);
  };
  scan(document);
  new MutationObserver(records => {
    for (const record of records) for (const added of record.addedNodes) if (added.nodeType===1) scan(added);
    for (const [select,destroy] of mounted) if (!select.isConnected) {destroy();mounted.delete(select);}
  }).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('close',event=>event.target.querySelectorAll?.('select').forEach(select=>select.tomselect?.close()),true);
}
