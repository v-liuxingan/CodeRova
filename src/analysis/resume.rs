use super::provider::Language;
use crate::{graph_store::GraphStore, model::CallGraph};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

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
    let exclusions = graph
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
    let seeds = if let Some(seed) = seed {
        vec![super::collector::Seed {
            id: seed,
            item: None,
            depth: 0,
        }]
    } else {
        graph
            .analysis
            .as_ref()
            .unwrap()
            .pending_nodes
            .iter()
            .filter(|id| !super::semantics::selection_required(&graph, id))
            .map(|id| super::collector::Seed {
                id: id.clone(),
                item: None,
                depth: 0,
            })
            .collect()
    };
    let mut validation_time = std::time::Duration::ZERO;
    let mut checkpoint_time = std::time::Duration::ZERO;
    let attempted = super::collector::collect(
        &mut graph,
        &root,
        &mut lease.session,
        language,
        seeds,
        super::collector::Options {
            budget,
            max_depth: None,
            exclusions,
        },
        |before, after, completed| {
            let started = std::time::Instant::now();
            let validation = crate::validation::validate_graph(after, Some(&root));
            validation_time += started.elapsed();
            if !validation.valid {
                return Err(validation.errors.join("\n"));
            }
            let started = std::time::Instant::now();
            store.checkpoint(&slug, before, after)?;
            checkpoint_time += started.elapsed();
            let mut state = jobs.state.lock().map_err(|e| e.to_string())?;
            state.1.completed = completed;
            state.1.added_nodes = after.nodes.len().saturating_sub(initial_nodes);
            state.1.added_edges = after.edges.len().saturating_sub(initial_edges);
            state.1.pending = after.analysis.as_ref().unwrap().pending_nodes.len();
            state.1.message = format!("正在采集 · 已新增 {} 个节点", state.1.added_nodes);
            Ok(())
        },
    )
    .await?;
    tracing::info!(
        elapsed_ms = started.elapsed().as_millis(),
        warm_session = reused,
        validation_ms = validation_time.as_millis(),
        checkpoint_ms = checkpoint_time.as_millis(),
        completed = attempted,
        "LSP collection finished"
    );
    lease.release().await;
    Ok(())
}
