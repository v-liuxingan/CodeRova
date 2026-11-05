import {supportsCollection, isImplementationCandidate} from '../../public/js/api.js';

// Reports retain historical issues. Never infer a current failure from their text,
// or mistake a view's collapsed children for an empty source call hierarchy.
const cache = new WeakMap();
function reportIndex(graph) {
  if(cache.has(graph))return cache.get(graph);
  const report=graph.analysis, ids=new Set(graph.nodes.map(n=>n.id)), issues=new Map();
  for(const issue of report?.issues || []) {
    const split=issue.indexOf(': '), id=issue.slice(0,split);
    if(split<0 || !ids.has(id))continue;
    if(!issues.has(id))issues.set(id,[]);
    issues.get(id).push(issue.slice(split+2));
  }
  const index={pending:new Set(report?.pendingNodes),queried:new Set(report?.queriedNodes),issues};
  cache.set(graph,index);return index;
}
export const readingBadges={
  provisional:['primary','待确认函数'], pending:['warning','待继续'], queried:['secondary','已查询'],
  leaf:['secondary','未记录下游'], unknown:['secondary','状态未记录'], imported:['secondary','导入记录'],
  candidate:['warning','候选实现'],
};
export function readingState(graph,node,outgoing=[],incoming=[]) {
  const id=node.sourceId||node.id, index=reportIndex(graph), issues=index.issues.get(id)||[];
  let state, hint;
  if(id.startsWith('entry-position-')) {
    state='provisional';hint='开始采集后确认函数，再探索下游。';
  } else if(!graph.analysis) {
    state='unknown';hint='点击连线看调用处，点击节点看定义。';
  } else if(!supportsCollection(graph)) {
    state='imported';hint='先核对源码；导入关系不代表实际执行。';
  } else if(index.pending.has(id)) {
    const candidate=incoming.length>0 && incoming.every(isImplementationCandidate);
    state=candidate?'candidate':'pending';
    hint=candidate?'这是候选实现，可从这里继续探索；不代表实际执行目标。':'下游尚未确认完整，可继续采集；没有连线不代表流程结束。';
  } else if(index.queried.has(id)) {
    state=outgoing.length?'queried':'leaf';
    hint=outgoing.length?'点击连线核对调用处；连线排列不代表执行顺序。':'当前记录没有下游调用，不等于业务流程结束。';
  } else {
    state='unknown';hint='当前记录无法确认采集状态，可查看源码或继续采集。';
  }
  return {state,hint,issues};
}
