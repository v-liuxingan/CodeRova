use super::{node, provider::Language, stable_id};
use crate::{
    graph_store::GraphStore,
    model::{CallGraph, GraphEdge},
    validation::resolve_source_path,
};
use lsp_types::{CallHierarchyItem, CallHierarchyOutgoingCall};
use serde::Serialize;
use serde_json::json;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use url::Url;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft_id: Option<String>,
    pub status: String,
    pub completed: usize,
    pub added_nodes: usize,
    pub added_edges: usize,
    pub pending: usize,
    pub message: String,
}
impl Default for Status {
    fn default() -> Self {
        Self {
            draft_id: None,
            status: "idle".into(),
            completed: 0,
            added_nodes: 0,
            added_edges: 0,
            pending: 0,
            message: String::new(),
        }
    }
}
#[derive(Default)]
pub struct Jobs {
    pub(crate) sessions: Arc<super::session_cache::SessionCache>,
    pub state: Mutex<(String, Status)>,
    pub cancel: AtomicBool,
}

pub async fn run(
    store: Arc<dyn GraphStore>,
    slug: String,
    root: PathBuf,
    graph: CallGraph,
    budget: usize,
    seed: Option<String>,
    jobs: Arc<Jobs>,
) -> Result<(), String> {
    tokio::select! {
        result = run_inner(store, slug, root, graph, budget, seed, jobs.clone()) => result,
        _ = async {
            while !jobs.cancel.load(Ordering::Relaxed) {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        } => Ok(()),
    }
}

async fn run_inner(
    store: Arc<dyn GraphStore>,
    slug: String,
    root: PathBuf,
    mut graph: CallGraph,
    budget: usize,
    seed: Option<String>,
    jobs: Arc<Jobs>,
) -> Result<(), String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let language =
        Language::from_provider(&graph.analysis.as_ref().ok_or("图缺少分析报告")?.provider)?;
    let initial_nodes = graph.nodes.len();
    let initial_edges = graph.edges.len();
    let started = std::time::Instant::now();
    jobs.state.lock().map_err(|e| e.to_string())?.1.message = "检查源码并准备语言服务器…".into();
    let mut lease =
        super::session_cache::Lease::acquire(jobs.sessions.clone(), &root, language).await?;
    let reused = lease.reused;
    jobs.state.lock().map_err(|e| e.to_string())?.1.message = if reused {
        "复用语言服务器，准备查询…"
    } else {
        "语言服务器已启动，等待项目索引…"
    }
    .into();
    let mut items = HashMap::<String, CallHierarchyItem>::new();
    let pruned: HashSet<_> = graph
        .analysis
        .as_ref()
        .ok_or("图缺少分析报告")?
        .pruned_node_ids
        .iter()
        .cloned()
        .collect();
    let mut paths = HashMap::new();
    let mut opened = HashMap::new();
    let mut queue: VecDeque<_> = graph
        .analysis
        .as_ref()
        .ok_or("图缺少分析报告")?
        .pending_nodes
        .clone()
        .into();
    queue.retain(|id| !super::semantics::selection_required(&graph, id));
    if let Some(seed) = seed {
        queue = VecDeque::from([seed]);
    }
    let mut queued: HashSet<_> = queue.iter().cloned().collect();
    let mut known: HashSet<_> = graph.nodes.iter().map(|n| n.id.clone()).collect();
    let mut edge_ids: HashSet<_> = graph.edges.iter().map(|e| e.id.clone()).collect();
    // CLI exclusion rules are retained in the existing report; apply them to
    // newly discovered boundaries too, not only previously excluded node IDs.
    let exclusions: Vec<String> = graph
        .analysis
        .as_ref()
        .unwrap()
        .issues
        .iter()
        .filter_map(|issue| {
            issue
                .split_once("路径规则 ")
                .and_then(|(_, tail)| tail.split_once('）'))
                .map(|(rule, _)| rule)
        })
        .filter_map(|rule| super::normalize_exclusion(rule).ok())
        .collect();
    let mut semantics = super::semantics::Semantics::new(language);
    let mut ready = false;
    let mut attempted = 0;
    while let Some(id) = queue.pop_front() {
        if jobs.cancel.load(Ordering::Relaxed) || attempted >= budget {
            break;
        }
        let report = graph.analysis.as_ref().unwrap();
        if report.queried_nodes.contains(&id)
            || report
                .issues
                .iter()
                .any(|i| i.starts_with(&format!("{id}:")) && i.contains("主动排除"))
        {
            continue;
        }
        let mut caller = graph
            .nodes
            .iter()
            .find(|n| n.id == id)
            .ok_or("待采符号不存在")?
            .clone();
        if exclusions
            .iter()
            .any(|rule| super::excluded(&caller.file, rule))
        {
            continue;
        }
        let file = resolve_source_path(&root, &caller.file)?;
        let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
        let uri = Url::from_file_path(&file)
            .map_err(|_| "符号 URI 无效")?
            .to_string();
        if let Some(previous) = opened.get(&uri) {
            if previous != &text {
                return Err("采集期间源码发生变化，请重新分析".into());
            }
        } else {
            lease.session.open(&uri, language, &text).await?;
            opened.insert(uri.clone(), text.clone());
        }
        let session = &mut lease.session.transport;
        if !ready {
            session.wait_ready(600).await?;
            ready = true;
        }
        let line = text
            .lines()
            .nth(caller.line.saturating_sub(1) as usize)
            .ok_or("符号行已变化，请重新分析")?;
        let name = caller
            .label
            .split("::")
            .last()
            .unwrap_or(&caller.label)
            .split('(')
            .next()
            .unwrap_or(&caller.label);
        let mut selected = items.remove(&id);
        for (column, _) in line.match_indices(name) {
            if selected.is_some() {
                break;
            }
            let result=session.request("textDocument/prepareCallHierarchy",json!({"textDocument":{"uri":uri},"position":{"line":caller.line-1,"character":line[..column].encode_utf16().count()}}),language.query_timeout()).await?;
            let items: Vec<CallHierarchyItem> = serde_json::from_value(result).unwrap_or_default();
            for item in items {
                if node(&root, &item, &mut paths)?.id == id {
                    selected = Some(item);
                    break;
                }
            }
            if selected.is_some() {
                break;
            }
        }
        let Some(item) = selected else {
            return Err(format!(
                "{}：无法重新确认原符号身份，请检查源码版本",
                caller.label
            ));
        };
        if let Err(e) = semantics.describe(session, &root, &item, &mut caller).await {
            graph
                .analysis
                .as_mut()
                .unwrap()
                .issues
                .push(format!("{id}: {e}"));
        }
        attempted += 1;
        jobs.state.lock().map_err(|e| e.to_string())?.1.message =
            format!("正在采集 {} · 本轮请求 {attempted}/{budget}", caller.label);
        let result = language.outgoing(session, &item).await;
        let before = graph.clone();
        let calls: Result<Vec<CallHierarchyOutgoingCall>, String> = match result {
            Ok(v) if v.is_null() => Err("返回 null，仍待采集".into()),
            Ok(v) => serde_json::from_value(v).map_err(|e| e.to_string()),
            Err(e) => Err(e),
        };
        let calls = calls.and_then(|calls| {
            super::validate_call_ranges(&item, &calls)?;
            Ok(calls)
        });
        match calls {
            Err(e) => {
                graph
                    .analysis
                    .as_mut()
                    .unwrap()
                    .issues
                    .push(format!("{id}: {e}"));
                if !session.usable {
                    return Err(e);
                }
            }
            Ok(calls) => {
                if let Some(n) = graph.nodes.iter_mut().find(|n| n.id == id) {
                    n.symbol = caller.symbol.clone();
                }
                match semantics.candidates(session, &root, &item, &caller).await {
                    Ok(candidates) => {
                        // Count before pruning: deleting alternatives is not evidence
                        // that the language server found only one implementation.
                        let follow = candidates.len() == 1;
                        for candidate in candidates {
                            let super::semantics::ImplementationCandidate {
                                node: target,
                                edge,
                                item: target_item,
                            } = candidate;
                            if pruned.contains(&target.id) {
                                continue;
                            }
                            items.insert(target.id.clone(), target_item);
                            if follow && queued.insert(target.id.clone()) {
                                queue.push_back(target.id.clone());
                            }
                            if known.insert(target.id.clone()) {
                                graph
                                    .analysis
                                    .as_mut()
                                    .unwrap()
                                    .pending_nodes
                                    .push(target.id.clone());
                                graph.nodes.push(target);
                            }
                            if edge_ids.insert(edge.id.clone()) {
                                graph.edges.push(edge);
                            }
                        }
                    }
                    Err(e) => graph
                        .analysis
                        .as_mut()
                        .unwrap()
                        .issues
                        .push(format!("{id}: 候选实现查询失败：{e}")),
                }
                for call in calls {
                    if call.from_ranges.is_empty() {
                        graph
                            .analysis
                            .as_mut()
                            .unwrap()
                            .issues
                            .push(format!("{id}: {} 缺少调用点", call.to.name));
                        continue;
                    }
                    let mut target = match node(&root, &call.to, &mut paths) {
                        Ok(n) => n,
                        Err(e) => {
                            graph
                                .analysis
                                .as_mut()
                                .unwrap()
                                .issues
                                .push(format!("{id}: {}：{e}", call.to.name));
                            continue;
                        }
                    };
                    if let Err(e) = semantics
                        .describe(session, &root, &call.to, &mut target)
                        .await
                    {
                        graph
                            .analysis
                            .as_mut()
                            .unwrap()
                            .issues
                            .push(format!("{}: {e}", target.id));
                    }
                    if pruned.contains(&target.id) {
                        continue;
                    }
                    if known.insert(target.id.clone()) {
                        // Queued below for both new and existing pending targets.
                        graph
                            .analysis
                            .as_mut()
                            .unwrap()
                            .pending_nodes
                            .push(target.id.clone());
                        graph.nodes.push(target.clone());
                    }
                    items.insert(target.id.clone(), call.to.clone());
                    if queued.insert(target.id.clone()) {
                        queue.push_back(target.id.clone());
                    }
                    for range in call.from_ranges {
                        let edge_id = stable_id(&format!(
                            "{}:{}:{}:{}",
                            id, target.id, range.start.line, range.start.character
                        ));
                        if !edge_ids.insert(edge_id.clone()) {
                            continue;
                        }
                        graph.edges.push(GraphEdge {
                            id: edge_id,
                            from: id.clone(),
                            to: target.id.clone(),
                            kind: "static-call".into(),
                            flow_kind: "normal".into(),
                            condition: String::new(),
                            order: None,
                            label: "静态调用".into(),
                            call_site_status: "exact".into(),
                            call_site_note: String::new(),
                            file: caller.file.clone(),
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
                report.pending_nodes.retain(|n| n != &id);
                report.queried_nodes.push(id.clone());
            }
        }
        let validation = crate::validation::validate_graph(&graph, Some(&root));
        if !validation.valid {
            return Err(validation.errors.join("\n"));
        }
        store.checkpoint(&slug, &before, &graph)?;
        let mut state = jobs.state.lock().map_err(|e| e.to_string())?;
        state.1.completed = attempted;
        state.1.added_nodes = graph.nodes.len().saturating_sub(initial_nodes);
        state.1.added_edges = graph.edges.len().saturating_sub(initial_edges);
        state.1.pending = graph.analysis.as_ref().unwrap().pending_nodes.len();
    }
    tracing::info!(
        elapsed_ms = started.elapsed().as_millis(),
        warm_session = reused,
        completed = attempted,
        "LSP collection finished"
    );
    lease.release().await;
    Ok(())
}
