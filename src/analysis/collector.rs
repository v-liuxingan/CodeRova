//! Shared bounded breadth-first collection. Workers only return facts;
//! graph mutation/checkpointing has exactly one owner.
use super::{
    Direction,
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
use lsp_types::{CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall};
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
    pub max_nodes: Option<usize>,
    pub exclusions: Vec<String>,
}
pub struct Seed {
    pub id: String,
    pub item: Option<CallHierarchyItem>,
    pub depth: u32,
}
struct Work {
    direction: Direction,
    subject: GraphNode,
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
    subject: GraphNode,
    depth: u32,
    calls: Vec<Call>,
    candidates: Vec<ImplementationCandidate>,
    issues: Vec<String>,
    complete: bool,
}
impl Facts {
    fn new(subject: GraphNode, depth: u32) -> Self {
        Self {
            subject,
            depth,
            calls: vec![],
            candidates: vec![],
            issues: vec![],
            complete: false,
        }
    }
    fn issue(&mut self, message: impl AsRef<str>) {
        self.issues
            .push(format!("{}: {}", self.subject.id, message.as_ref()));
    }
}
async fn query(
    client: &Client,
    language: Language,
    root: &Path,
    work: Work,
    semantics: &mut Semantics,
) -> Facts {
    let mut facts = Facts::new(work.subject.clone(), work.depth);
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
            .nth(facts.subject.line.saturating_sub(1) as usize)
            .ok_or("符号行已变化，请重新分析")?;
        let name = facts
            .subject
            .label
            .split("::")
            .last()
            .unwrap_or(&facts.subject.label)
            .split('(')
            .next()
            .unwrap_or(&facts.subject.label);
        for (column, _) in line.match_indices(name) {
            let value=client.request("textDocument/prepareCallHierarchy",json!({"textDocument":{"uri":uri},"position":{"line":facts.subject.line-1,"character":line[..column].encode_utf16().count()}}),language.query_timeout()).await?;
            let items: Vec<CallHierarchyItem> =
                super::decode_hierarchy(value).map_err(|e| format!("无法解析函数身份：{e}"))?;
            for item in items {
                if node(root, &item, &mut paths)?.id == facts.subject.id {
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
        .describe(client, root, &item, &mut facts.subject)
        .await
    {
        facts.issue(e);
    }
    if work.direction == Direction::Incoming {
        let value = language.incoming(client, &item).await?;
        if value.is_null() {
            return Err("服务器返回 null，不能确认调用者".into());
        }
        let calls: Vec<CallHierarchyIncomingCall> =
            super::decode_hierarchy(value).map_err(|e| format!("无效反向调用层级：{e}"))?;
        facts.complete = true;
        for call in calls {
            // incoming ranges belong to the returned caller, never to the query item.
            if let Err(error) = super::validate_ranges(&call.from, &call.from_ranges) {
                facts.complete = false;
                facts.issue(error);
                continue;
            }
            if call.from_ranges.is_empty() {
                facts.complete = false;
                facts.issue(format!("{} 缺少调用点", call.from.name));
                continue;
            }
            let mut caller = match node(root, &call.from, &mut paths) {
                Ok(node) => node,
                Err(error) => {
                    facts.issue(format!("{}：{error}", call.from.name));
                    continue;
                }
            };
            if let Err(error) = semantics
                .describe(client, root, &call.from, &mut caller)
                .await
            {
                facts.issue(error);
            }
            facts.calls.push(Call {
                node: caller,
                item: call.from,
                ranges: call.from_ranges,
            });
        }
        return Ok(());
    }
    let value = language.outgoing(client, &item).await?;
    if value.is_null() {
        return Err("服务器返回 null，不能确认下游".into());
    }
    let calls: Vec<CallHierarchyOutgoingCall> =
        super::decode_hierarchy(value).map_err(|e| format!("无效调用层级：{e}"))?;
    super::validate_call_ranges(&item, &calls)?;
    facts.complete = true;
    // A failed optional implementation query must not erase successful direct calls.
    match semantics
        .candidates(client, root, &item, &facts.subject)
        .await
    {
        Ok((candidates, issues)) => {
            facts.candidates = candidates;
            if !issues.is_empty() {
                facts.complete = false;
            }
            for issue in issues {
                facts.issue(format!("实现查询未完成：{issue}"));
            }
        }
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
    direction: Direction,
    subject: GraphNode,
    seed: Seed,
) -> Result<Work, String> {
    let file = resolve_source_path(root, &subject.file)?;
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let uri = Url::from_file_path(crate::project_catalog::tool_path(&file))
        .map_err(|_| "符号 URI 无效")?
        .to_string();
    warm.open(&uri, language, &text).await?;
    Ok(Work {
        direction,
        subject,
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
    let node_limit = options
        .max_nodes
        .map(|n| graph.nodes.len().saturating_add(n));
    let direction = graph.analysis.as_ref().ok_or("图缺少分析报告")?.direction;
    let concurrency = warm.transport.policy().concurrency;
    let semantics = Semantics::new(language);
    let mut workers = vec![semantics; concurrency];
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
    let mut result_batches = 0;
    let mut largest_batch = 0;
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
                let subject = graph.nodes[*known.get(&seed.id).ok_or("待采符号不存在")?].clone();
                let reason = if let Some(rule) = options
                    .exclusions
                    .iter()
                    .find(|rule| super::excluded(&subject.file, rule))
                {
                    Some(format!("主动排除（路径规则 {rule}）"))
                } else if options.max_depth.is_some_and(|max| seed.depth >= max) {
                    Some("达到深度边界".into())
                } else if node_limit.is_some_and(|n| graph.nodes.len() >= n) {
                    Some("达到本轮新增节点上限".into())
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
                let work = prepare(root, warm, language, direction, subject.clone(), seed).await;
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
                            let mut facts = Facts::new(subject, depth);
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
            // Drain only results already available. Never wait for a slow sibling
            // to form a batch; the synchronous merge and checkpoint remain atomic
            // with respect to cancellation of this collection future.
            let before = graph.clone();
            let mut batch = 0;
            for finished in ready_results(result, &mut active) {
                let (semantics, facts) = finished.map_err(|e| format!("采集工作任务失败：{e}"))?;
                workers.push(semantics);
                completed += 1;
                batch += 1;
                let mut facts = facts;
                if let Some(limit) = node_limit {
                    let mut accepted: HashSet<_> = known.keys().cloned().collect();
                    let mut keep = |id: &String| {
                        accepted.contains(id)
                            || (accepted.len() < limit && accepted.insert(id.clone()))
                    };
                    let before_count = facts.calls.len() + facts.candidates.len();
                    facts.calls.retain(|call| keep(&call.node.id));
                    facts
                        .candidates
                        .retain(|candidate| keep(&candidate.node.id));
                    if before_count != facts.calls.len() + facts.candidates.len() {
                        facts.complete = false;
                        facts.issue("达到本轮新增节点上限，仍有关系待采集");
                    }
                }
                merge(graph, facts, &mut known, &mut edges, &pruned, &mut next);
            }
            result_batches += 1;
            largest_batch = largest_batch.max(batch);
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
    tracing::info!(
        completed,
        result_batches,
        largest_batch,
        "LSP collector result batches"
    );
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
    let direction = graph.analysis.as_ref().unwrap().direction;
    let id = &facts.subject.id;
    if let Some(index) = known.get(id)
        && facts.subject.symbol.is_some()
    {
        graph.nodes[*index].symbol = facts.subject.symbol.clone();
    }
    let follow = facts.complete && facts.candidates.len() == 1;
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
        let (from, to, file, method) = match direction {
            Direction::Outgoing => (
                id.clone(),
                target.clone(),
                facts.subject.file.clone(),
                "outgoingCalls",
            ),
            Direction::Incoming => (
                target.clone(),
                id.clone(),
                call.node.file.clone(),
                "incomingCalls",
            ),
        };
        add_node(graph, call.node, known);
        next.entry(target.clone()).or_insert(Seed {
            id: target.clone(),
            item: Some(call.item),
            depth: facts.depth + 1,
        });
        for range in call.ranges {
            let edge_id = stable_id(&format!(
                "{from}:{to}:{}:{}",
                range.start.line, range.start.character
            ));
            if !edges.insert(edge_id.clone()) {
                continue;
            }
            graph.edges.push(GraphEdge {
                id: edge_id,
                from: from.clone(),
                to: to.clone(),
                kind: "static-call".into(),
                flow_kind: "normal".into(),
                condition: String::new(),
                order: None,
                label: "静态调用".into(),
                call_site_status: "exact".into(),
                call_site_note: String::new(),
                file: file.clone(),
                line: range.start.line + 1,
                description: "语言服务器报告的调用关系；控制流程尚未分析。".into(),
                evidence: format!(
                    "LSP {method}; UTF-16 call site {}:{}",
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
        if !report.queried_nodes.contains(id) {
            report.queried_nodes.push(id.clone());
        }
    } else {
        report.queried_nodes.retain(|node| node != id);
        if !report.pending_nodes.contains(id) {
            report.pending_nodes.push(id.clone());
        }
    }
}
fn add_node(graph: &mut CallGraph, node: GraphNode, known: &mut HashMap<String, usize>) {
    if let Some(index) = known.get(&node.id) {
        if node.symbol.is_some() {
            graph.nodes[*index].symbol = node.symbol;
        }
    } else {
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

/// Take completed work without introducing a synchronization barrier.
fn ready_results<T: 'static>(
    first: Result<T, tokio::task::JoinError>,
    active: &mut JoinSet<T>,
) -> Vec<Result<T, tokio::task::JoinError>> {
    let mut results = vec![first];
    while let Some(result) = active.try_join_next() {
        results.push(result);
    }
    results
}

#[cfg(test)]
mod batching_tests {
    use super::*;
    #[test]
    fn overlapping_results_preserve_notes_and_distinct_call_sites() {
        let mut graph: CallGraph = serde_json::from_value(json!({
            "schemaVersion":"0.4", "projectId":"fixture", "title":"merge", "root":"caller",
            "nodes":[
                {"id":"caller","kind":"function","label":"caller","file":"main.rs","line":1,"role":"entry"},
                {"id":"target","kind":"function","label":"target","file":"main.rs","line":2,"description":"人工说明","role":"业务职责","state":"collapsed"}
            ], "edges":[],
            "analysis":{"provider":"rust-analyzer","scope":"project","maxDepth":3,"requestBudget":100,"issues":[],"queriedNodes":["caller","target"],"pendingNodes":[]}
        })).unwrap();
        let mut known = HashMap::from([("caller".into(), 0), ("target".into(), 1)]);
        let mut edges = HashSet::new();
        let mut next = BTreeMap::new();
        let item: CallHierarchyItem =
            serde_json::from_value(json!({"name":"target","kind":12,"uri":"file:///main.rs",
                "range":{"start":{"line":1,"character":0},"end":{"line":1,"character":20}},
                "selectionRange":{"start":{"line":1,"character":3},"end":{"line":1,"character":9}}
            }))
            .unwrap();
        for _ in 0..2 {
            let mut facts = Facts::new(graph.nodes[0].clone(), 0);
            facts.complete = true;
            let mut target = graph.nodes[1].clone();
            target.description = "自动说明".into();
            for _ in 0..2 {
                facts.calls.push(Call {
                    node: target.clone(),
                    item: item.clone(),
                    ranges: vec![
                        lsp_types::Range::new(
                            lsp_types::Position::new(0, 4),
                            lsp_types::Position::new(0, 10),
                        ),
                        lsp_types::Range::new(
                            lsp_types::Position::new(0, 14),
                            lsp_types::Position::new(0, 20),
                        ),
                    ],
                });
            }
            merge(
                &mut graph,
                facts,
                &mut known,
                &mut edges,
                &HashSet::new(),
                &mut next,
            );
            assert_eq!(graph.nodes.len(), 2);
            assert_eq!(graph.edges.len(), 2);
            assert_eq!(next.len(), 1);
            assert_eq!(graph.nodes[1].description, "人工说明");
            assert_eq!(graph.nodes[1].role, "业务职责");
            assert_eq!(graph.nodes[1].state, "collapsed");
            graph.edges[0].description = "人工边说明".into();
        }
        assert_eq!(graph.edges[0].description, "人工边说明");
        // An incomplete retry must not leave the caller falsely marked complete.
        let failed = Facts::new(graph.nodes[0].clone(), 0);
        merge(
            &mut graph,
            failed,
            &mut known,
            &mut edges,
            &HashSet::new(),
            &mut next,
        );
        let report = graph.analysis.unwrap();
        assert!(report.pending_nodes.contains(&"caller".into()));
        assert!(!report.queried_nodes.contains(&"caller".into()));
        assert_eq!(graph.edges.len(), 2);
    }
    #[tokio::test]
    async fn completed_results_share_a_checkpoint_without_waiting_for_slow_work() {
        let mut active = JoinSet::new();
        let (tx, mut rx) = tokio::sync::mpsc::channel(2);
        for id in [1, 2] {
            let tx = tx.clone();
            active.spawn(async move {
                tx.send(()).await.unwrap();
                id
            });
        }
        active.spawn(std::future::pending::<i32>());
        rx.recv().await.unwrap();
        rx.recv().await.unwrap();
        tokio::task::yield_now().await;
        let first = active.join_next().await.unwrap();
        let mut batch: Vec<_> = ready_results(first, &mut active)
            .into_iter()
            .map(Result::unwrap)
            .collect();
        batch.sort();
        assert_eq!(batch, vec![1, 2]);
        assert_eq!(active.len(), 1);
        assert!(active.try_join_next().is_none());
    }
}
