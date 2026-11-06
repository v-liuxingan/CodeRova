import { normalizeGraphResponse } from "./graph-format.js";
// Semantic facts are supplied by analyzers; the UI never infers Java types from paths.
export function symbolPresentation(node) {
  const info = node.symbol;
  const types = {class:['C','类'], interface:['I','接口'], 'abstract-class':['A','抽象类'], enum:['E','枚举'], record:['R','Record']};
  const [badge, type] = types[info?.ownerKind] || ['', ''];
  const modifiers = (info?.modifiers || []).filter(m => ['static','abstract','default'].includes(m));
  return { badge, type, owner: info?.ownerName || '', detail: [...modifiers, ...(info?.tags || [])].join(' · ') };
}
export function isImplementationCandidate(edge) { return edge.kind === 'trait-dispatch' && edge.callSiteStatus === 'omitted-nodes'; }
export function supportsCollection(graph) { return /^(rust-analyzer|eclipse-jdtls)(?: \/|$)/.test(graph?.analysis?.provider || ""); }
async function request(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `请求失败：${response.status}`);
    error.status = response.status;
    throw error;
  }
  return normalizeGraphResponse(body);
}
export class CodeRovaApi {
  library() { return request('/api/library'); }
  changeLibrary(change) { return request('/api/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(change)}); }
  storage() { return request('/api/storage'); }
  configureStorage(selectionId) { return request('/api/storage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selectionId})}); }
  renameGraph(slug,title) { return request(`/api/graphs/${encodeURIComponent(slug)}/title`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})}); }
  describeGraph(slug, edits) { return this.draftOperation(slug, {action:'describe', edits}); }
  selectProjectDirectory() { return request('/api/projects/select-directory', {method:'POST'}); }
  selectProjectFile(project) { return request(`/api/projects/${encodeURIComponent(project)}/select-file`, {method:'POST'}); }
  selectEntryFile(slug) { return request(`/api/graphs/${encodeURIComponent(slug)}/select-file`, {method:'POST'}); }
  registerProject(selectionId, name) { return request('/api/projects', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selectionId,name})}); }
  lspStatus(project, language, signal) { return request(`/api/projects/${encodeURIComponent(project)}/lsp/${encodeURIComponent(language)}`, {signal}); }
  controlLsp(project, language, action) { return request(`/api/projects/${encodeURIComponent(project)}/lsp/${encodeURIComponent(language)}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})}); }
  projectFiles(project) { return request(`/api/projects/${encodeURIComponent(project)}/source-files`); }
  projectSource(project, file) { return request(`/api/projects/${encodeURIComponent(project)}/source-files/${encodeURIComponent(file)}`); }
  checkProjectEntry(project, fileId, line, signal) { return request(`/api/projects/${encodeURIComponent(project)}/entry-check`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileId,line}),signal}); }
  // direction is a graph-level exploration policy; omitted values remain outgoing.
  createGraph(data) { return request('/api/graphs', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); }

  constructor({ drafts = false } = {}) {
    this.useDrafts = drafts;
    this.drafts = new Map();
    this.queues = new Map();
    this.editBusy = 0;
  }
  hasUnsaved(slug) { return Boolean(this.drafts.get(slug)?.dirty); }
  rememberDraft(slug, result) {
    if (result.draftId) {
      const { draftId, dirty, changes } = result;
      this.drafts.set(slug, { draftId, dirty, changes });
    } else this.drafts.delete(slug);
  }
  draftOperation(slug, operation, signal) {
    const mutating = !['read', 'preview', 'open', 'analysisStatus'].includes(operation.action)
      && !(operation.action === 'prune' && !operation.request.apply);
    if (mutating) { this.editBusy++; this.onDraftChange?.(); }
    const job = (this.queues.get(slug) || Promise.resolve()).then(async () => {
      if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
      const send = (draftId, op, requestSignal) => request(`/api/graphs/${encodeURIComponent(slug)}/draft`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(draftId ? { draftId } : {}), operation: op }), signal: requestSignal,
      });
      let session = this.drafts.get(slug);
      if (!session) {
        if (['save', 'discard'].includes(operation.action)) return null;
        // Receive the session ID even if a source preview is cancelled meanwhile.
        const opened = await send(null, { action: 'read' });
        this.rememberDraft(slug, opened);
        session = this.drafts.get(slug);
        if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
        if (operation.action === 'read') return opened;
      }
      try {
        const result = await send(session.draftId, operation, signal);
        this.rememberDraft(slug, result);
        return result;
      } catch (error) {
        // A lost response cannot prove that a mutation did not reach the server.
        if (mutating && (!error.status || error.status >= 500)) this.drafts.set(slug, { ...session, dirty: true });
        throw error;
      }
    });
    // Queue only completion, never retain a large graph response or a rejected promise.
    const tail = job.then(() => undefined, () => undefined);
    this.queues.set(slug, tail);
    return job.finally(() => {
      if (this.queues.get(slug) === tail) this.queues.delete(slug);
      if (mutating) this.editBusy--;
      this.onDraftChange?.();
    });
  }
  async saveDraft(slug) { const result=await this.draftOperation(slug,{action:'save'});this.onCollectionChange?.(slug);return result; }
  async discardDraft(slug) { const result=await this.draftOperation(slug,{action:'discard'});this.onCollectionChange?.(slug);return result; }
  abandonDrafts() { for(const [slug,d] of this.drafts)navigator.sendBeacon(`/api/graphs/${encodeURIComponent(slug)}/draft`,new Blob([JSON.stringify({draftId:d.draftId,operation:{action:'discard'}})],{type:'application/json'})); }

  // Optional V2 metadata; older authored graphs intentionally have no analysis report.
  analysisCoverage(graph) {
    const report = graph.analysis;
    if (!report) return null;
    return { ...report, queriedCount: report.queriedNodes.length, pendingCount: report.pendingNodes.length };
  }
  listSceneCatalog(signal) {
    return request("/scenes/catalog.json", { signal, cache: "no-cache" });
  }

  listGraphs() {
    return request("/api/graphs");
  }

  // Status includes addedNodes/addedEdges for this task, updated after each checkpoint.
  async analysisTask(slug, method = 'GET', requestBudget, nodeId, limits = {}) {
    if(this.useDrafts) {
      if(method==='GET'&&!this.drafts.has(slug))return {status:'idle',completed:0,pending:0,message:''};
      const operation=method==='POST'?{action:'analyze',request:{requestBudget,nodeId,...limits}}:{action:method==='DELETE'?'stopAnalysis':'analysisStatus'};
      return this.draftOperation(slug,operation).then(r=>r.result);
    }
    return request(`/api/graphs/${encodeURIComponent(slug)}/analysis`, {
      method, ...(method === 'POST' ? { headers: {'Content-Type':'application/json'}, body: JSON.stringify({requestBudget, ...limits, ...(nodeId ? {nodeId} : {})}) } : {}),
    });
  }

  addManualLink(slug, link) {
    if(this.useDrafts)return this.draftOperation(slug,{action:"link",request:link}).then(r=>r.result);
    return request(`/api/graphs/${encodeURIComponent(slug)}/links`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(link)});
  }
  removeManualLink(slug, edgeId) {
    if(this.useDrafts)return this.draftOperation(slug,{action:"removeLink",edgeId}).then(r=>r.result);
    return request(`/api/graphs/${encodeURIComponent(slug)}/links/${encodeURIComponent(edgeId)}`, {method:'DELETE'});
  }
  entryFiles(slug) { return request(`/api/graphs/${encodeURIComponent(slug)}/source-files`); }
  entrySource(slug, id) { return request(`/api/graphs/${encodeURIComponent(slug)}/source-files/${encodeURIComponent(id)}`); }
  checkEntry(slug, fileId, line, signal) { return request(`/api/graphs/${encodeURIComponent(slug)}/entry-check`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileId,line}),signal}); }
  createEntry(slug, data) { if(this.useDrafts)return this.draftOperation(slug,{action:"entry",request:data}).then(r=>r.result); return request(`/api/graphs/${encodeURIComponent(slug)}/entries`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); }
  pruneNode(slug, nodeId, revision) { if(this.useDrafts)return this.draftOperation(slug,{action:"prune",request:{nodeId,apply:Boolean(revision),...(revision?{revision}:{})}}).then(r=>r.result); return request(`/api/graphs/${encodeURIComponent(slug)}/prune`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nodeId,apply:Boolean(revision),...(revision?{revision}:{})})}); }
  pruneNodes(slug, nodeIds, revision) { const body={nodeIds:[...new Set(nodeIds)],apply:Boolean(revision),...(revision?{revision}:{})}; if(this.useDrafts)return this.draftOperation(slug,{action:'prune',request:body}).then(r=>r.result); return request(`/api/graphs/${encodeURIComponent(slug)}/prune`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); }
  loadGraph(slug) {
    if(this.useDrafts && this.drafts.has(slug))return this.draftOperation(slug,{action:"read"}).then(r=>r.graph);
    return request(`/api/graphs/${encodeURIComponent(slug)}`);
  }

  listScenarios() {
    return request("/api/scenarios");
  }

  loadScenario(slug) {
    return request(`/api/scenarios/${encodeURIComponent(slug)}`);
  }

  updateGraphCategory(slug, categoryId, category) {
    if(this.hasUnsaved(slug)||this.editBusy)return Promise.reject(new Error('请先保存或放弃图修改，再调整分类。'));
    return request(`/api/graphs/${encodeURIComponent(slug)}/category`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ categoryId, category }),
    });
  }

  loadLayout(slug) {
    return request(`/api/graphs/${encodeURIComponent(slug)}/layout`);
  }

  saveLayout(slug, layout) {
    return request(`/api/graphs/${encodeURIComponent(slug)}/layout`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(layout),
    });
  }

  validateGraph(slug) {
    return request(`/api/graphs/${encodeURIComponent(slug)}/validation`);
  }

  health() {
    return request("/api/health");
  }

  buildSourceLink(graph, targetType, id) {
    if(this.useDrafts && this.hasUnsaved(graph))return this.draftOperation(graph,{action:'open',request:{graph,targetType,id}}).then(r=>r.result);
    return request("/api/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graph, targetType, id }),
    });
  }

  previewSource(graph, targetType, id, contextLines, scope, signal) {
    if(this.useDrafts && this.drafts.has(graph))return this.draftOperation(graph,{action:"preview",request:{graph,targetType,id,contextLines,scope}},signal).then(r=>r.result);
    return request("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graph, targetType, id, contextLines, scope }),
      signal,
    });
  }
  listArchivedGraphs() {
    return request('/api/graph-trash');
  }

  archiveGraph(slug) {
    if(this.hasUnsaved(slug)||this.editBusy)return Promise.reject(new Error('请先保存或放弃图修改，再移入回收站。'));
    return request(`/api/graphs/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  }

  restoreGraph(slug) {
    return request(`/api/graph-trash/${encodeURIComponent(slug)}/restore`, { method: 'POST' });
  }
  deleteArchivedGraph(slug) {
    return request(`/api/graph-trash/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  }
}
