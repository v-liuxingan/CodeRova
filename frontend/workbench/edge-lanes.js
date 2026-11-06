// Compute parallel lanes only when topology changes; keep original call-site IDs.
export function edgeLanes(edges, states = new Map(), direction = 'TB', callSiteAtSource = false) {
  const groups = new Map();
  for (const edge of edges) {
    const key = JSON.stringify([edge.from, edge.to, edge.kind || '', edge.flowKind || '', edge.label || '', edge.order ?? null, edge.condition || '']);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  }
  const result = [];
  for (const group of groups.values()) {
    const edge = group[0], memberIds = group.map(e => e.id);
    result.push({ id: edge.id, source: edge.from, target: edge.to,
      type: direction === 'LR' ? 'adaptive-horizontal' : 'adaptive-vertical',
      data: { laneFraction: .5, memberIds }, states: states.get(edge.id) || [],
      style: { callSiteAtSource, sourcePort: `out:${edge.id}`, targetPort: `in:${edge.id}`,
        increasedLineWidthForHitTesting: 12,
        lineDash: (edge.kind === 'async-boundary' || edge.kind === 'trait-dispatch') ? [5,4] : undefined,
        labelText: edge.kind === 'trait-dispatch' ? '' : edge.id.startsWith('manual-async-') || edge.sourceId?.startsWith('manual-async-') ? '人工异步关联' : group.length > 1 ? `${group.length} 条关系` : Number.isInteger(edge.order) ? `顺序 ${edge.order}` : edge.sourceId && edge.line > 0 ? `L${edge.line}` : '',
        curvePosition: [.5,.5], curveOffset: [0,0], loopDist: 40 },
    });
  }
  const lanes = new Map();
  for (const edge of result) {
    const key = JSON.stringify([edge.source, edge.target].sort());
    if (!lanes.has(key)) lanes.set(key, []);
    lanes.get(key).push(edge);
  }
  for (const group of lanes.values()) group.forEach((edge,i) => {
    edge.data.laneFraction = .5 + (i - (group.length - 1) / 2) * Math.min(.12, .8 / group.length);
    edge.style.loopDist = 40 + i * 24;
  });
  return result;
}
export function edgePorts(edges, direction = 'TB', positions) {
  const ports = new Map();
  // Different callers must not share the same incoming stem. Order attachment
  // points by the remote node's position to avoid introducing new crossings.
  if (positions) {
    const cross = direction === 'LR' ? 'y' : 'x';
    for (const [endpoint, remote, field] of [['target','source','targetFraction']]) {
      const groups = new Map();
      for (const edge of edges) {
        if (!groups.has(edge[endpoint])) groups.set(edge[endpoint], []);
        groups.get(edge[endpoint]).push(edge);
      }
      for (const group of groups.values()) {
        group.sort((a,b)=>positions.get(a[remote])[cross]-positions.get(b[remote])[cross] || a.id.localeCompare(b.id));
        group.forEach((edge,i)=>{ edge.data[field] = group.length===1 ? .5 : .2+.6*i/(group.length-1); });
      }
    }
  }
  for (const edge of edges) {
    // All outgoing calls share the center; only incoming callers fan into ports.
    const sourceFraction = .5;
    edge.data.sourceFraction = sourceFraction;
    const targetFraction = edge.data.targetFraction ?? edge.data.laneFraction;
    for (const [id, key, placement] of [
      [edge.source, edge.style.sourcePort, direction === 'LR' ? [1, sourceFraction] : [sourceFraction, 1]],
      [edge.target, edge.style.targetPort, direction === 'LR' ? [0, targetFraction] : [targetFraction, 0]],
    ]) {
      if (!ports.has(id)) ports.set(id, []);
      ports.get(id).push({ key, placement });
    }
  }
  return ports;
}
