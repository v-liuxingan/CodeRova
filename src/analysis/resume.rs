use super::provider::Language;
use crate::{graph_store::GraphStore, model::CallGraph};
use serde::Serialize;
use std::{
    collections::HashSet,
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
    pub total_nodes: usize,
    pub total_edges: usize,
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
            total_nodes: 0,
            total_edges: 0,
            pending: 0,
            message: String::new(),
        }
    }
}
impl Status {
    fn record(
        &mut self,
        graph: &CallGraph,
        nodes: &HashSet<String>,
        edges: &HashSet<String>,
        completed: usize,
    ) {
        self.completed = completed;
        self.added_nodes = graph
            .nodes
            .iter()
            .filter(|n| !nodes.contains(&n.id))
            .count();
        self.added_edges = graph
            .edges
            .iter()
            .filter(|e| !edges.contains(&e.id))
            .count();
        self.total_nodes = graph.nodes.len();
        self.total_edges = graph.edges.len();
        self.pending = graph.analysis.as_ref().map_or(0, |r| r.pending_nodes.len());
    }
}
#[derive(Default)]
pub struct Jobs {
    pub(crate) sessions: Arc<super::session_cache::SessionCache>,
    pub state: Mutex<(String, Status)>,
    pub cancel: AtomicBool,
}

pub struct Limits {
    pub budget: usize,
    pub depth: Option<u32>,
    pub nodes: Option<usize>,
}

pub async fn run(
    store: Arc<dyn GraphStore>,
    slug: String,
    root: PathBuf,
    graph: CallGraph,
    limits: Limits,
    seed: Option<String>,
    jobs: Arc<Jobs>,
) -> Result<(), String> {
    tokio::select! {
        result = run_inner(store, slug, root, graph, limits, seed, jobs.clone()) => result,
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
    limits: Limits,
    seed: Option<String>,
    jobs: Arc<Jobs>,
) -> Result<(), String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let language =
        Language::from_provider(&graph.analysis.as_ref().ok_or("图缺少分析报告")?.provider)?;
    let mut initial_nodes: HashSet<_> = graph.nodes.iter().map(|n| n.id.clone()).collect();
    let initial_edges: HashSet<_> = graph.edges.iter().map(|e| e.id.clone()).collect();
    let started = std::time::Instant::now();
    jobs.state.lock().map_err(|e| e.to_string())?.1.message = "检查源码并准备语言服务器…".into();
    let wait_started = std::time::Instant::now();
    while jobs.sessions.status(&root, language).await? == "busy" {
        if wait_started.elapsed() > std::time::Duration::from_secs(600) {
            return Err("语言服务器仍在准备，请在项目设置查看状态后重试".into());
        }
        jobs.state.lock().map_err(|e| e.to_string())?.1.message =
            "等待项目语言服务器准备完成，可随时停止…".into();
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    // Resolve provisional source positions only when collection is explicitly requested.
    let mut seed = seed;
    let anchors: Vec<_> = graph
        .nodes
        .iter()
        .filter(|n| {
            n.id.starts_with("entry-position-") && seed.as_ref().is_none_or(|id| id == &n.id)
        })
        .cloned()
        .collect();
    for anchor in anchors {
        let path = crate::validation::resolve_source_path(&root, &anchor.file)?;
        let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        if super::entry::position(&anchor.file, &text, anchor.line)?.id != anchor.id {
            return Err("入口源码已变化，请重新选择入口创建图".into());
        }
        let mut resolved = super::entry::check(
            jobs.sessions.clone(),
            root.clone(),
            anchor.file.clone(),
            text,
            anchor.line,
        )
        .await?;
        let before = graph.clone();
        let id = resolved.id.clone();
        // Re-identification changes identity, not the number of newly discovered symbols.
        initial_nodes.remove(&anchor.id);
        initial_nodes.insert(id.clone());
        resolved.description.clone_from(&anchor.description);
        resolved.role.clone_from(&anchor.role);
        resolved.phase_id.clone_from(&anchor.phase_id);
        resolved.state.clone_from(&anchor.state);
        if graph.root == anchor.id {
            graph.root = id.clone();
        }
        for edge in &mut graph.edges {
            if edge.from == anchor.id {
                edge.from = id.clone();
            }
            if edge.to == anchor.id {
                edge.to = id.clone();
            }
        }
        graph.nodes.retain(|n| n.id != anchor.id);
        if !graph.nodes.iter().any(|n| n.id == id) {
            graph.nodes.push(resolved);
        }
        let report = graph.analysis.as_mut().unwrap();
        for ids in [
            &mut report.pending_nodes,
            &mut report.queried_nodes,
            &mut report.pruned_node_ids,
        ] {
            for item in ids.iter_mut() {
                if *item == anchor.id {
                    *item = id.clone();
                }
            }
            let mut seen = std::collections::HashSet::new();
            ids.retain(|item| seen.insert(item.clone()));
        }
        if seed.as_ref() == Some(&anchor.id) {
            seed = Some(id);
        }
        let validation = crate::validation::validate_graph(&graph, Some(&root));
        if !validation.valid {
            return Err(validation.errors.join("\n"));
        }
        store.checkpoint(&slug, &before, &graph)?;
        jobs.state.lock().map_err(|e| e.to_string())?.1.record(
            &graph,
            &initial_nodes,
            &initial_edges,
            0,
        );
    }
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
            budget: limits.budget,
            max_depth: limits.depth,
            max_nodes: limits.nodes,
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
            state
                .1
                .record(after, &initial_nodes, &initial_edges, completed);
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn additions_are_identity_differences_not_net_length_changes() {
        let graph: CallGraph=serde_json::from_value(serde_json::json!({
            "schemaVersion":"0.4","projectId":"fixture","title":"counts","root":"old",
            "nodes":[{"id":"old","kind":"function","label":"old","file":"a.rs","line":1,"role":"entry"},
                     {"id":"new","kind":"function","label":"new","file":"a.rs","line":2,"role":"work"}],
            "edges":[]
        })).unwrap();
        let mut status = Status::default();
        status.record(
            &graph,
            &HashSet::from(["old".into(), "merged-away".into()]),
            &HashSet::new(),
            2,
        );
        assert_eq!(
            (status.added_nodes, status.total_nodes, status.completed),
            (1, 2, 2)
        );
        status.record(
            &graph,
            &HashSet::from(["old".into(), "new".into()]),
            &HashSet::new(),
            2,
        );
        assert_eq!(status.added_nodes, 0);
    }
}
