// Presentation comes from Bootstrap Badge and Spinner; only domain mapping lives here.
const states = {
  checking:['secondary','检查中',true], starting:['primary','正在准备…',true],
  running:['success','已启动'], busy:['warning','使用中',true],
  stopped:['secondary','未启动'], failed:['danger','启动失败'], unavailable:['danger','状态不可用'],
};
export function statusBadge() {
  const element=document.createElement('span');element.className='ui-status';
  element.setAttribute('role','status');element.setAttribute('aria-atomic','true');
  let previous;
  return {element,set(state) {
    if(previous===state)return;previous=state;
    const [variant,text,loading]=states[state] || ['secondary','未知状态'];
    const badge=document.createElement('span');badge.className=`badge text-bg-${variant}`;
    if(loading){const spinner=document.createElement('span');spinner.className='spinner-border spinner-border-sm';spinner.setAttribute('aria-hidden','true');badge.append(spinner);}
    badge.append(document.createTextNode(text));element.replaceChildren(badge);
  }};
}
