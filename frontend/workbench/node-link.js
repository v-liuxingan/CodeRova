// Links identify persisted symbols, never transient path occurrences or source paths.
export function nodeLink(base, graph, node) {
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('graph', graph);
  url.searchParams.set('node', node);
  return url.href;
}
