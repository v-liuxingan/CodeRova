// Ordering is a reading aid, never an inferred runtime trace.
export function callReading(edges) {
  const calls = [...edges];
  const ordered = calls.length > 0 && calls.every(e => Number.isInteger(e.order));
  const located = calls.length > 0 && calls.every(e => e.file && e.file === calls[0].file && e.line > 0);
  if (ordered) calls.sort((a,b) => a.order-b.order);
  else if (located) calls.sort((a,b) => a.line-b.line);
  return { calls, note: !calls.length ? '' : ordered ? '按已标注的调用顺序排列；条件与循环仍以各调用点为准。' : located ? '按源码行排列，不代表运行时执行顺序；同行调用的先后尚未确定。' : '顺序尚未确定，保留原始记录顺序。' };
}
export function callMeaning(edge) {
  const roles = {branch:'条件分支',fallback:'降级路径',merge:'汇合', 'loop-back':'回环', 'loop-exit':'退出循环'};
  return [roles[edge.flowKind] || (edge.kind === 'static-call' ? '静态调用关系，控制流程尚未分析' : '调用关系'),
    edge.condition ? `条件：${edge.condition}` : roles[edge.flowKind] && ['branch','fallback','loop-exit'].includes(edge.flowKind) ? '条件尚未提供' : '',
    Number.isInteger(edge.order) ? `已标注顺序：${edge.order}` : '执行顺序尚未确定'].filter(Boolean).join(' · ');
}
