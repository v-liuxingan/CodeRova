// Shared project membership for the home catalog and workbench tree.
export function libraryPreferences() {
  try { const value=JSON.parse(localStorage.getItem('callgraph-v2-library')) || {}; return {removedProjects:Array.isArray(value.removedProjects)?value.removedProjects:[],groups:Array.isArray(value.groups)?value.groups:[]}; }
  catch { return {removedProjects:[],groups:[]}; }
}
export function libraryProjects(names, graphs, groups=[], removed=[]) {
  const projects=new Map(names);
  for(const graph of graphs)if(!projects.has(graph.projectId))projects.set(graph.projectId,graph.projectId);
  return new Map([...projects].filter(([id])=>!removed.includes(id)||graphs.some(g=>g.projectId===id)||groups.some(g=>g.project===id)));
}
