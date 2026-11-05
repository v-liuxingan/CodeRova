// Analyzer facts take precedence over collection state; never infer Java types from names.
const ownerTones = new Set(['class','interface','abstract-class','enum','record']);
export function nodeTone(node, root, pending) {
  if (ownerTones.has(node.symbol?.ownerKind)) return node.symbol.ownerKind;
  return node.role?.startsWith('人工采集入口') ? 'manual' : pending ? 'pending' : node.id === root ? 'entry' : node.kind === 'method' ? 'method' : 'function';
}
