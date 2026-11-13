import { isIncoming } from './exploration.js';
import {statusBadge} from '../components/status-badge.js';
import {readingBadges,readingState} from './reading-state.js';
import {relationList} from './relation-list.js';

export function readingGuide({graph,item,outgoing,incoming,collect,canCollect,sourceEdge,caller,openEvidence}) {
  const {state,hint,issues}=readingState(graph,item,outgoing,incoming);
  const row=document.createElement('div');row.className='node-reading-actions';
  const badge=statusBadge(readingBadges);badge.set(state);badge.element.title=hint;badge.element.setAttribute('aria-description',hint);row.append(badge.element);
  if(canCollect) {
    const button=document.createElement('button');button.textContent='继续采集';button.className='primary';
    button.title=isIncoming(graph)?'从当前节点查找调用者，保留已有说明':'从当前节点探索下游，保留已有说明';button.onclick=collect;row.append(button);
  }
  const detail=document.createElement('div');detail.className='node-reading-guide';
  const note=document.createElement('p');note.className='reading-hint';note.textContent=hint;note.hidden=['queried','pending','provisional','unknown'].includes(state);detail.append(note);
  if(sourceEdge && caller) {
    const context=document.createElement('div');context.className='reading-origin';
    const label=document.createElement('span');label.textContent=`${isIncoming(graph)?"当前路径调用":"当前路径来自"} ${caller.label || caller.id}`;label.title=label.textContent;
    const button=document.createElement('button');button.textContent=sourceEdge.file && sourceEdge.line>0 && (!sourceEdge.callSiteStatus || sourceEdge.callSiteStatus==='exact')?'查看调用点':'查看关系依据';
    button.onclick=openEvidence;context.append(label,button);detail.append(context);
  } else if((item.sourceId||item.id)===graph.root) {
    note.textContent=`${isIncoming(graph)?"追溯起点":"图入口"}。${hint}`;
  }
  if(issues.length) {
    const records=relationList('历史采集记录',issues,text=>{const p=document.createElement('p');p.textContent=text;return p;},false);
    records.classList.add('reading-records');
    records.title='历史记录可能已经恢复，不代表当前仍然失败';detail.append(records);
  }
  return {row,detail};
}
