//! Shared bounded breadth-first collection. Workers only return facts;
//! graph mutation/checkpointing has exactly one owner.
use super::{
    lsp::Client,
    node,
    provider::Language,
    semantics::{ImplementationCandidate, Semantics},
    session_cache::WarmSession,
    stable_id,
};
use crate::{
    model::{CallGraph, GraphEdge, GraphNode},
    validation::resolve_source_path,
};
use lsp_types::{CallHierarchyItem, CallHierarchyOutgoingCall};
use serde_json::json;
use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    path::Path,
};
use tokio::task::JoinSet;
use url::Url;

pub struct Options {
    pub budget: usize,
    pub max_depth: Option<u32>,
    pub exclusions: Vec<String>,
}
pub struct Seed {
    pub id: String,
    pub item: Option<CallHierarchyItem>,
    pub depth: u32,
}
struct Work {
    caller: GraphNode,
    item: Option<CallHierarchyItem>,
    uri: String,
    text: String,
    depth: u32,
}
struct Call {
    node: GraphNode,
    item: CallHierarchyItem,
    ranges: Vec<lsp_types::Range>,
}
struct Facts {
    caller: GraphNode,
    depth: u32,
    calls: Vec<Call>,
    candidates: Vec<ImplementationCandidate>,
    issues: Vec<String>,
    complete: bool,
}
impl Facts {
    fn new(caller: GraphNode, depth: u32) -> Self {
        Self {
            caller,
            depth,
            calls: vec![],
            candidates: vec![],
            issues: vec![],
            complete: false,
        }
    }
    fn issue(&mut self, message: impl AsRef<str>) {
        self.issues
            .push(format!("{}: {}", self.caller.id, message.as_ref()));
    }
}
async fn query(
    client: &Client,
    language: Language,
    root: &Path,
    work: Work,
    semantics: &mut Semantics,
) -> Facts {
    let mut facts = Facts::new(work.caller.clone(), work.depth);
    let result = query_inner(client, language, root, &work, semantics, &mut facts).await;
    if let Err(error) = result {
        facts.issue(error);
    }
    facts
}
async fn query_inner(
    client: &Client,
    language: Language,
    root: &Path,
    work: &Work,
    semantics: &mut Semantics,
    facts: &mut Facts,
) -> Result<(), String> {
    let mut paths = HashMap::new();
    let mut selected = work.item.clone();
    let uri = &work.uri;
    let text = &work.text;
    if selected.is_none() {
        let line = text
            .lines()
            .nth(facts.caller.line.saturating_sub(1) as usize)
            .ok_or("符号行已变化，请重新分析")?;
        let name = facts
            .caller
            .label
            .split("::")
            .last()
            .unwrap_or(&facts.caller.label)
            .split('(')
            .next()
            .unwrap_or(&facts.caller.label);
        for (column, _) in line.match_indices(name) {
            let value=client.request("textDocument/prepareCallHierarchy",json!({"textDocument":{"uri":uri},"position":{"line":facts.caller.line-1,"character":line[..column].encode_utf16().count()}}),language.query_timeout()).await?;
            let items: Vec<CallHierarchyItem> =
                serde_json::from_value(value).map_err(|e| format!("无法解析函数身份：{e}"))?;
            for item in items {
                if node(root, &item, &mut paths)?.id == facts.caller.id {
                    selected = Some(item);
                    break;
                }
            }
            if selected.is_some() {
                break;
            }
        }
    }
    let item = selected.ok_or("无法重新确认原符号身份，请检查源码版本")?;
    if let Err(e) = semantics
        .describe(client, root, &item, &mut facts.caller)
        .await
    {
        facts.issue(e);
    }
    let value = language.outgoing(client, &item).await?;
    if value.is_null() {
        return Err("服务器返回 null，不能确认下游".into());
    }
    let calls: Vec<CallHierarchyOutgoingCall> =
        serde_json::from_value(value).map_err(|e| format!("无效调用层级：{e}"))?;
    super::validate_call_ranges(&item, &calls)?;
    facts.complete = true;
    // A failed optional implementation query must not erase successful direct calls.
    match semantics
        .candidates(client, root, &item, &facts.caller)
        .await
    {
        Ok(candidates) => facts.candidates = candidates,
        Err(e) => {
            facts.complete = false;
            facts.issue(format!("候选实现查询失败：{e}"));
        }
    }
    for call in calls {
        if call.from_ranges.is_empty() {
            facts.complete = false;
            facts.issue(format!("{} 缺少调用点", call.to.name));
            continue;
        }
        let mut target = match node(root, &call.to, &mut paths) {
            Ok(n) => n,
            Err(e) => {
                facts.issue(format!("{}：{e}", call.to.name));
                continue;
            }
        };
        if let Err(e) = semantics
            .describe(client, root, &call.to, &mut target)
            .await
        {
            facts.issues.push(format!("{}: {e}", target.id));
        }
        facts.calls.push(Call {
            node: target,
            item: call.to,
            ranges: call.from_ranges,
        });
    }
    Ok(())
}
async fn prepare(
    root: &Path,
    warm: &mut WarmSession,
    language: Language,
    caller: GraphNode,
    seed: Seed,
) -> Result<Work, String> {
    let file = resolve_source_path(root, &caller.file)?;
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let uri = Url::from_file_path(file)
        .map_err(|_| "符号 URI 无效")?
        .to_string();
    warm.open(&uri, language, &text).await?;
    Ok(Work {
        caller,
        item: seed.item,
        uri,
        text,
        depth: seed.depth,
    })
}
pub async fn collect(
    graph: &mut CallGraph,
    root: &Path,
    warm: &mut WarmSession,
    language: Language,
    seeds: Vec<Seed>,
    options: Options,
    mut checkpoint: impl FnMut(&CallGraph, &CallGraph, usize) -> Result<(), String>,
) -> Result<usize, String> {
    let concurrency = warm.transport.policy().concurrency;
    let mut workers: Vec<_> = (0..concurrency).map(|_| Semantics::new(language)).collect();
    let mut frontier = seeds;
    let mut scheduled = HashSet::new();
    let mut known: HashMap<_, _> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.clone(), i))
        .collect();
    let mut edges: HashSet<_> = graph.edges.iter().map(|e| e.id.clone()).collect();
    let pruned: HashSet<_> = graph
        .analysis
        .as_ref()
        .ok_or("图缺少分析报告")?
        .pruned_node_ids
        .iter()
        .cloned()
        .collect();
    let mut ready = false;
    let mut attempts = 0;
    let mut completed = 0;
    while !frontier.is_empty() && warm.transport.usable() {
        // Fix frontier order before dispatch: response timing cannot change which
        // same-depth nodes consume a limited budget. Descendants form the next wave.
        frontier.sort_by(|a, b| a.id.cmp(&b.id));
        let mut waiting: VecDeque<_> = frontier.into();
        let mut next = BTreeMap::new();
        let mut active = JoinSet::new();
        loop {
            let mut boundaries = Vec::new();
            while active.len() < concurrency && !waiting.is_empty() && warm.transport.usable() {
                let seed = waiting.pop_front().unwrap();
                if !scheduled.insert(seed.id.clone()) {
                    continue;
                }
                let report = graph.analysis.as_ref().unwrap();
                if report.queried_nodes.contains(&seed.id) {
                    continue;
                }
                let caller = graph.nodes[*known.get(&seed.id).ok_or("待采符号不存在")?].clone();
                let reason = if let Some(rule) = options
                    .exclusions
                    .iter()
                    .find(|rule| super::excluded(&caller.file, rule))
                {
                    Some(format!("主动排除（路径规则 {rule}）"))
                } else if options.max_depth.is_some_and(|max| seed.depth >= max) {
                    Some("达到深度边界".into())
                } else if attempts >= options.budget {
                    Some("请求预算耗尽".into())
                } else {
                    None
                };
                if let Some(reason) = reason {
                    boundaries.push(format!("{}: {reason}", seed.id));
                    continue;
                }
                attempts += 1;
                let depth = seed.depth;
                let work = prepare(root, warm, language, caller.clone(), seed).await;
                if !ready && work.is_ok() {
                    warm.transport.wait_ready(600).await?;
                    ready = true;
                }
                let mut semantics = workers.pop().unwrap();
                let client = warm.transport.client();
                let root = root.to_path_buf();
                active.spawn(async move {
                    let facts = match work {
                        Ok(work) => query(&client, language, &root, work, &mut semantics).await,
                        Err(e) => {
                            let mut facts = Facts::new(caller, depth);
                            facts.issue(e);
                            facts
                        }
                    };
                    (semantics, facts)
                });
            }
            // Boundary annotations contain no new source facts. Persist this batch
            // before waiting, rather than revalidating the entire graph per skipped node.
            if !boundaries.is_empty() {
                let before = graph.clone();
                graph.analysis.as_mut().unwrap().issues.extend(boundaries);
                checkpoint(&before, graph, completed)?;
            }
            let Some(result) = active.join_next().await else {
                break;
            };
            let (semantics, facts) = result.map_err(|e| format!("采集工作任务失败：{e}"))?;
            workers.push(semantics);
            completed += 1;
            let before = graph.clone();
            merge(graph, facts, &mut known, &mut edges, &pruned, &mut next);
            checkpoint(&before, graph, completed)?;
        }
        if !warm.transport.usable() {
            let before = graph.clone();
            graph
                .analysis
                .as_mut()
                .unwrap()
                .issues
                .push("语言服务器连接中断，剩余节点尚未采集；已保留成功结果".into());
            checkpoint(&before, graph, completed)?;
            break;
        }
        frontier = next.into_values().collect();
    }
    // Canonical output order, independent of worker completion order.
    let before = graph.clone();
    graph.nodes.sort_by(|a, b| a.id.cmp(&b.id));
    graph.edges.sort_by(|a, b| a.id.cmp(&b.id));
    let report = graph.analysis.as_mut().unwrap();
    report.pending_nodes.sort();
    report.pending_nodes.dedup();
    report.queried_nodes.sort();
    report.queried_nodes.dedup();
    report.issues.sort();
    report.issues.dedup();
    checkpoint(&before, graph, completed)?;
    Ok(completed)
}
fn merge(
    graph: &mut CallGraph,
    facts: Facts,
    known: &mut HashMap<String, usize>,
    edges: &mut HashSet<String>,
    pruned: &HashSet<String>,
    next: &mut BTreeMap<String, Seed>,
) {
    let id = &facts.caller.id;
    if let Some(index) = known.get(id) {
        graph.nodes[*index].symbol = facts.caller.symbol.clone();
    }
    let follow = facts.candidates.len() == 1;
    for candidate in facts.candidates {
        if pruned.contains(&candidate.node.id) {
            continue;
        }
        if follow {
            next.entry(candidate.node.id.clone()).or_insert(Seed {
                id: candidate.node.id.clone(),
                item: Some(candidate.item),
                depth: facts.depth + 1,
            });
        }
        add_node(graph, candidate.node, known);
        if edges.insert(candidate.edge.id.clone()) {
            graph.edges.push(candidate.edge);
        }
    }
    for call in facts.calls {
        if pruned.contains(&call.node.id) {
            continue;
        }
        let target = call.node.id.clone();
        add_node(graph, call.node, known);
        next.entry(target.clone()).or_insert(Seed {
            id: target.clone(),
            item: Some(call.item),
            depth: facts.depth + 1,
        });
        for range in call.ranges {
            let edge_id = stable_id(&format!(
                "{id}:{target}:{}:{}",
                range.start.line, range.start.character
            ));
            if !edges.insert(edge_id.clone()) {
                continue;
            }
            graph.edges.push(GraphEdge {
                id: edge_id,
                from: id.clone(),
                to: target.clone(),
                kind: "static-call".into(),
                flow_kind: "normal".into(),
                condition: String::new(),
                order: None,
                label: "静态调用".into(),
                call_site_status: "exact".into(),
                call_site_note: String::new(),
                file: facts.caller.file.clone(),
                line: range.start.line + 1,
                description: "语言服务器报告的调用关系；控制流程尚未分析。".into(),
                evidence: format!(
                    "LSP outgoingCalls; UTF-16 call site {}:{}",
                    range.start.line + 1,
                    range.start.character + 1
                ),
                confidence: 1.0,
            });
        }
    }
    let report = graph.analysis.as_mut().unwrap();
    report.issues.extend(facts.issues);
    if facts.complete {
        report.pending_nodes.retain(|n| n != id);
        report.queried_nodes.push(id.clone());
    }
}
fn add_node(graph: &mut CallGraph, node: GraphNode, known: &mut HashMap<String, usize>) {
    if !known.contains_key(&node.id) {
        known.insert(node.id.clone(), graph.nodes.len());
        graph
            .analysis
            .as_mut()
            .unwrap()
            .pending_nodes
            .push(node.id.clone());
        graph.nodes.push(node);
    }
}
