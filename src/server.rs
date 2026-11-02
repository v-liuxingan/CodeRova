mod drafts;
mod graph_creation;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::extract::{Path as AxumPath, Request, State};
use axum::http::{HeaderName, HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::{Deserialize, Serialize};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use crate::graph_store::{FileGraphStore, GraphStore};
use crate::layout_store::{FileLayoutStore, GraphLayout, LAYOUT_SCHEMA_VERSION, LayoutStore};
use crate::model::{
    ArchitectureScenario, CallGraph, GraphSummary, OpenRequest, OpenResponse, PreviewRequest,
    ScenarioSummary, SourcePreview, ValidationReport,
};
use crate::navigation::{SourceLinkBuilder, VscodeUriLinkBuilder};
use crate::project_catalog::{FileProjectCatalog, ProjectCatalog, ResolvedProject};
use crate::scenario_store::{FileScenarioStore, ScenarioStore, validate_scenario_drilldowns};
use crate::source_preview::{DEFAULT_CONTEXT_LINES, FileSourcePreviewer, SourcePreviewer};
use crate::validation::{resolve_source_path, validate_graph};

#[derive(Clone)]
pub struct AppState {
    graph_store: Arc<dyn GraphStore>,
    scenario_store: Arc<dyn ScenarioStore>,
    project_catalog: Arc<dyn ProjectCatalog>,
    source_link_builder: Arc<dyn SourceLinkBuilder>,
    source_previewer: Arc<dyn SourcePreviewer>,
    layout_store: Arc<dyn LayoutStore>,
    analysis_jobs: Arc<crate::analysis::resume::Jobs>,
    analysis_draft_id: Option<String>,
    entry_candidates:
        Arc<std::sync::Mutex<std::collections::HashMap<String, crate::analysis::entry::Candidate>>>,
    entry_check_busy: Arc<std::sync::atomic::AtomicBool>,
    drafts: Arc<
        std::sync::Mutex<std::collections::HashMap<String, Arc<crate::draft_store::DraftStore>>>,
    >,
}

impl AppState {
    pub fn new(
        graph_store: Arc<dyn GraphStore>,
        scenario_store: Arc<dyn ScenarioStore>,
        project_catalog: Arc<dyn ProjectCatalog>,
        source_link_builder: Arc<dyn SourceLinkBuilder>,
        source_previewer: Arc<dyn SourcePreviewer>,
        layout_store: Arc<dyn LayoutStore>,
    ) -> Self {
        Self {
            graph_store,
            scenario_store,
            project_catalog,
            source_link_builder,
            source_previewer,
            layout_store,
            analysis_jobs: Arc::default(),
            analysis_draft_id: None,
            entry_candidates: Arc::default(),
            entry_check_busy: Arc::default(),
            drafts: Arc::default(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Internal(String),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PruneRequest {
    node_id: String,
    #[serde(default)]
    apply: bool,
    revision: Option<String>,
}
async fn prune_graph(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    headers: axum::http::HeaderMap,
    Json(input): Json<PruneRequest>,
) -> Result<Json<crate::pruning::Plan>, AppError> {
    same_origin(&headers)?;
    let jobs = state
        .analysis_jobs
        .state
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if jobs.1.status == "running" {
        return Err(AppError::BadRequest("请先停止采集再减枝".into()));
    }
    let before = state.graph_store.load(&slug).map_err(AppError::NotFound)?;
    let mut plan = crate::pruning::plan(&before, &input.node_id).map_err(AppError::BadRequest)?;
    if input.apply {
        if input.revision.as_deref() != Some(&plan.revision) {
            return Err(AppError::BadRequest(
                "图已变化或缺少预览版本，请重新预览减枝".into(),
            ));
        }
        let mut graph = before.clone();
        crate::pruning::apply(&mut graph, &plan);
        state
            .graph_store
            .checkpoint(&slug, &before, &graph)
            .map_err(AppError::BadRequest)?;
        plan.applied = true;
    }
    Ok(Json(plan))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResumeRequest {
    request_budget: usize,
    #[serde(default)]
    node_id: String,
}

fn same_origin(headers: &axum::http::HeaderMap) -> Result<(), AppError> {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::BadRequest("续采操作需要同源 Origin".into()))?;
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let local = url::Url::parse(origin)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .is_some_and(|h| h == "localhost" || h == "127.0.0.1" || h == "[::1]");
    if !local || origin != format!("http://{host}") {
        return Err(AppError::BadRequest("拒绝跨站续采操作".into()));
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManualLinkRequest {
    from_id: String,
    target_graph: String,
    target_id: String,
    note: String,
}

async fn add_manual_link(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    headers: axum::http::HeaderMap,
    Json(input): Json<ManualLinkRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    same_origin(&headers)?;
    let jobs = state
        .analysis_jobs
        .state
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if jobs.1.status == "running" {
        return Err(AppError::BadRequest("请先停止采集再编辑关联".into()));
    }
    let before = state.graph_store.load(&slug).map_err(AppError::NotFound)?;
    let target_graph = state
        .graph_store
        .load(&input.target_graph)
        .map_err(AppError::NotFound)?;
    if before.project_id != target_graph.project_id
        || before.analysis.is_none()
        || !target_graph
            .analysis
            .as_ref()
            .is_some_and(|r| crate::analysis::provider::Language::supported(&r.provider))
    {
        return Err(AppError::BadRequest(
            "仅支持同项目已有 LSP 图中的接收函数".into(),
        ));
    }
    let from = before
        .nodes
        .iter()
        .find(|n| n.id == input.from_id)
        .ok_or_else(|| AppError::BadRequest("发送节点不存在".into()))?;
    let target = target_graph
        .nodes
        .iter()
        .find(|n| n.id == input.target_id)
        .ok_or_else(|| AppError::BadRequest("接收节点不存在".into()))?
        .clone();
    if !matches!(target.kind.as_str(), "function" | "method") {
        return Err(AppError::BadRequest("接收入口必须是函数或方法".into()));
    }
    let note = input.note.trim();
    if note.is_empty() || note.chars().count() > 2000 || from.id == target.id {
        return Err(AppError::BadRequest(
            "请填写关联依据（1–2000 字），并选择不同的接收节点".into(),
        ));
    }
    let edge_id = format!(
        "manual-async-{}",
        crate::analysis::stable_id(&format!("{}:{}", from.id, target.id))
    );
    if before.edges.iter().any(|e| e.id == edge_id) {
        return Err(AppError::BadRequest("这两个节点已有人工异步关联".into()));
    }
    let mut graph = before.clone();
    if !graph.nodes.iter().any(|n| n.id == target.id) {
        graph.nodes.push(target.clone());
        graph
            .analysis
            .as_mut()
            .unwrap()
            .pending_nodes
            .push(target.id.clone());
    }
    if let Some(report) = &mut graph.analysis {
        report.pruned_node_ids.retain(|id| id != &target.id);
    }
    graph.edges.push(crate::model::GraphEdge {
        id: edge_id.clone(),
        from: from.id.clone(),
        to: target.id.clone(),
        kind: "async-boundary".into(),
        flow_kind: "normal".into(),
        condition: String::new(),
        order: None,
        label: "人工异步关联".into(),
        call_site_status: "omitted-nodes".into(),
        call_site_note: "人工跨越消息传递边界，非源码中的直接函数调用；请核对两端定义与关联说明。"
            .into(),
        file: String::new(),
        line: 0,
        description: note.into(),
        evidence: format!(
            "人工关联，尚未经静态分析验证。发送端 {}:{}；接收端 {}:{}。依据：{note}",
            from.file, from.line, target.file, target.line
        ),
        confidence: 0.0,
    });
    let root = state
        .project_catalog
        .resolve_root(&graph.project_id)
        .map_err(AppError::BadRequest)?;
    let validation = validate_graph(&graph, Some(&root));
    if !validation.valid {
        return Err(AppError::BadRequest(validation.errors.join("\n")));
    }
    state
        .graph_store
        .checkpoint(&slug, &before, &graph)
        .map_err(AppError::BadRequest)?;
    Ok(Json(
        serde_json::json!({"edgeId":edge_id,"nodeId":target.id}),
    ))
}
async fn remove_manual_link(
    State(state): State<AppState>,
    AxumPath((slug, edge)): AxumPath<(String, String)>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    same_origin(&headers)?;
    let jobs = state
        .analysis_jobs
        .state
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if jobs.1.status == "running" {
        return Err(AppError::BadRequest("请先停止采集再编辑关联".into()));
    }
    let before = state.graph_store.load(&slug).map_err(AppError::NotFound)?;
    if !before
        .edges
        .iter()
        .any(|e| e.id == edge && e.id.starts_with("manual-async-") && e.kind == "async-boundary")
    {
        return Err(AppError::BadRequest("只能撤销人工异步关联".into()));
    }
    let mut graph = before.clone();
    graph.edges.retain(|e| e.id != edge);
    state
        .graph_store
        .checkpoint(&slug, &before, &graph)
        .map_err(AppError::BadRequest)?;
    Ok(Json(serde_json::json!({"removed":edge})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EntryCheck {
    file_id: String,
    line: u32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EntryCreate {
    from_id: String,
    candidate_id: String,
    note: String,
}
async fn list_entry_files(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<Vec<crate::analysis::entry::SourceFile>>, AppError> {
    let graph = state.graph_store.load(&slug).map_err(AppError::NotFound)?;
    let root = state
        .project_catalog
        .resolve_root(&graph.project_id)
        .map_err(AppError::BadRequest)?;
    Ok(Json(
        crate::analysis::entry::files(&root).map_err(AppError::BadRequest)?,
    ))
}
async fn read_entry_file(
    State(state): State<AppState>,
    AxumPath((slug, id)): AxumPath<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let graph = state.graph_store.load(&slug).map_err(AppError::NotFound)?;
    let root = state
        .project_catalog
        .resolve_root(&graph.project_id)
        .map_err(AppError::BadRequest)?;
    let (name, text) = crate::analysis::entry::source(&root, &id).map_err(AppError::BadRequest)?;
    Ok(Json(serde_json::json!({"name":name,"text":text})))
}
struct CheckGuard(Arc<std::sync::atomic::AtomicBool>);
impl Drop for CheckGuard {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::Relaxed);
    }
}
async fn check_entry(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    headers: axum::http::HeaderMap,
    Json(input): Json<EntryCheck>,
) -> Result<Json<serde_json::Value>, AppError> {
    same_origin(&headers)?;
    let graph = state.graph_store.load(&slug).map_err(AppError::NotFound)?;
    if !graph
        .analysis
        .as_ref()
        .is_some_and(|report| crate::analysis::provider::Language::supported(&report.provider))
    {
        return Err(AppError::BadRequest(
            "此图不支持 LSP 采集，请从源码新建图".into(),
        ));
    }
    check_project_entry(&state, slug, &graph.project_id, input).await
}
async fn check_project_entry(
    state: &AppState,
    slug: String,
    project_id: &str,
    input: EntryCheck,
) -> Result<Json<serde_json::Value>, AppError> {
    {
        let jobs = state
            .analysis_jobs
            .state
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        if jobs.1.status == "running"
            || state
                .entry_check_busy
                .swap(true, std::sync::atomic::Ordering::Relaxed)
        {
            return Err(AppError::BadRequest(
                "已有采集或校验运行，请稍后再试".into(),
            ));
        }
    }
    let _guard = CheckGuard(state.entry_check_busy.clone());
    let root = state
        .project_catalog
        .resolve_root(project_id)
        .map_err(AppError::BadRequest)?;
    let (file, text) =
        crate::analysis::entry::source(&root, &input.file_id).map_err(AppError::BadRequest)?;
    let symbol = crate::analysis::entry::check(
        state.analysis_jobs.sessions.clone(),
        root,
        file,
        text.clone(),
        input.line,
    )
    .await
    .map_err(AppError::BadRequest)?;
    let token = crate::analysis::stable_id(&format!(
        "{slug}:{}:{}",
        symbol.id,
        crate::analysis::stable_id(&text)
    ));
    let mut entries = state
        .entry_candidates
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    entries.retain(|_, v| v.slug != slug);
    entries.insert(
        token.clone(),
        crate::analysis::entry::Candidate {
            slug,
            node: symbol.clone(),
            text,
        },
    );
    Ok(Json(
        serde_json::json!({"candidateId":token,"node":symbol,"message":"已确认函数，可配置采集。"}),
    ))
}
async fn create_entry(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    headers: axum::http::HeaderMap,
    Json(input): Json<EntryCreate>,
) -> Result<Json<serde_json::Value>, AppError> {
    same_origin(&headers)?;
    let jobs = state
        .analysis_jobs
        .state
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if jobs.1.status == "running" {
        return Err(AppError::BadRequest("请先停止采集再添加入口".into()));
    }
    let candidate = state
        .entry_candidates
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?
        .get(&input.candidate_id)
        .filter(|c| c.slug == slug)
        .cloned()
        .ok_or_else(|| AppError::BadRequest("入口校验已失效，请重新校验".into()))?;
    let before = state.graph_store.load(&slug).map_err(AppError::NotFound)?;
    let root = state
        .project_catalog
        .resolve_root(&before.project_id)
        .map_err(AppError::BadRequest)?;
    let path = resolve_source_path(&root, &candidate.node.file).map_err(AppError::BadRequest)?;
    if std::fs::read_to_string(path).map_err(|e| AppError::BadRequest(e.to_string()))?
        != candidate.text
    {
        return Err(AppError::BadRequest(
            "源码在校验后发生变化，请重新选择并校验".into(),
        ));
    }
    let parent = before
        .nodes
        .iter()
        .find(|n| n.id == input.from_id)
        .ok_or_else(|| AppError::BadRequest("父节点不存在".into()))?;
    if parent.id == candidate.node.id {
        return Err(AppError::BadRequest("后续入口不能与当前节点相同".into()));
    }
    if input.note.chars().count() > 2000 {
        return Err(AppError::BadRequest("关联说明不能超过 2000 字".into()));
    }
    let mut graph = before.clone();
    let mut target = candidate.node;
    let edge_id = format!(
        "manual-async-{}",
        crate::analysis::stable_id(&format!("{}:{}", parent.id, target.id))
    );
    if graph.edges.iter().any(|e| e.id == edge_id) {
        return Err(AppError::BadRequest("已经存在该人工关联".into()));
    }
    if !graph.nodes.iter().any(|n| n.id == target.id) {
        target.role = "人工采集入口；函数身份已由 LSP 确认".into();
        graph.nodes.push(target.clone());
        graph
            .analysis
            .as_mut()
            .ok_or_else(|| AppError::BadRequest("图缺少分析信息".into()))?
            .pending_nodes
            .push(target.id.clone());
    }
    let note = if input.note.trim().is_empty() {
        "用户选定的后续入口，关联语义待核实"
    } else {
        input.note.trim()
    };
    if let Some(report) = &mut graph.analysis {
        report.pruned_node_ids.retain(|id| id != &target.id);
    }
    graph.edges.push(crate::model::GraphEdge {
        id: edge_id.clone(),
        from: parent.id.clone(),
        to: target.id.clone(),
        kind: "async-boundary".into(),
        flow_kind: "normal".into(),
        condition: String::new(),
        order: None,
        label: "人工入口".into(),
        call_site_status: "omitted-nodes".into(),
        call_site_note: "人工添加的后续入口，不代表直接函数调用。".into(),
        file: String::new(),
        line: 0,
        description: note.into(),
        evidence: format!(
            "人工关联。父节点 {}:{}；入口定义 {}:{}。{note}",
            parent.file, parent.line, target.file, target.line
        ),
        confidence: 0.0,
    });
    let validation = validate_graph(&graph, Some(&root));
    if !validation.valid {
        return Err(AppError::BadRequest(validation.errors.join("\n")));
    }
    state
        .graph_store
        .checkpoint(&slug, &before, &graph)
        .map_err(AppError::BadRequest)?;
    Ok(Json(
        serde_json::json!({"nodeId":target.id,"edgeId":edge_id}),
    ))
}

async fn analysis_status(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<crate::analysis::resume::Status>, AppError> {
    let graph = state.graph_store.load(&slug).map_err(AppError::NotFound)?;
    let jobs = state
        .analysis_jobs
        .state
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(
        if jobs.0 == slug && jobs.1.draft_id == state.analysis_draft_id {
            jobs.1.clone()
        } else {
            crate::analysis::resume::Status {
                pending: graph
                    .analysis
                    .map_or(0, |report| report.pending_nodes.len()),
                ..Default::default()
            }
        },
    ))
}
async fn start_analysis(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    headers: axum::http::HeaderMap,
    Json(request): Json<ResumeRequest>,
) -> Result<Json<crate::analysis::resume::Status>, AppError> {
    same_origin(&headers)?;
    if !(1..=1000).contains(&request.request_budget) {
        return Err(AppError::BadRequest("本轮请求预算须在 1–1000 之间".into()));
    }
    let graph = state.graph_store.load(&slug).map_err(AppError::NotFound)?;
    let report = graph
        .analysis
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("此图未配置 LSP 分析".into()))?;
    if !crate::analysis::provider::Language::supported(&report.provider)
        || report.pending_nodes.is_empty()
    {
        return Err(AppError::BadRequest("没有可继续采集的分析边界".into()));
    }
    if !report.pending_nodes.contains(&request.node_id)
        || graph.edges.iter().any(|e| e.from == request.node_id)
    {
        return Err(AppError::BadRequest(
            "只能从尚未采集下游的叶子节点开始；收起节点不等于叶子节点".into(),
        ));
    }
    let root = state
        .project_catalog
        .resolve_root(&graph.project_id)
        .map_err(AppError::BadRequest)?;
    let status = crate::analysis::resume::Status {
        draft_id: state.analysis_draft_id.clone(),
        status: "running".into(),
        completed: 0,
        added_nodes: 0,
        added_edges: 0,
        pending: report.pending_nodes.len(),
        message: "正在初始化语言服务器…".into(),
    };
    {
        let mut jobs = state
            .analysis_jobs
            .state
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        if jobs.1.status == "running"
            || state
                .entry_check_busy
                .load(std::sync::atomic::Ordering::Relaxed)
        {
            return Err(AppError::BadRequest(
                "已有采集或校验任务运行，请等待或停止后再试".into(),
            ));
        }
        *jobs = (slug.clone(), status.clone());
        state
            .analysis_jobs
            .cancel
            .store(false, std::sync::atomic::Ordering::Relaxed);
    }
    tokio::spawn(async move {
        let temporary = state.analysis_draft_id.is_some();
        let result = crate::analysis::resume::run(
            state.graph_store,
            slug,
            root,
            graph,
            request.request_budget,
            Some(request.node_id),
            state.analysis_jobs.clone(),
        )
        .await;
        if let Ok(mut jobs) = state.analysis_jobs.state.lock() {
            jobs.1.status = if result.is_err() {
                "failed"
            } else if state
                .analysis_jobs
                .cancel
                .load(std::sync::atomic::Ordering::Relaxed)
            {
                "stopped"
            } else {
                "finished"
            }
            .into();
            jobs.1.message = match result {
                Err(e) => e,
                Ok(()) if temporary => "结果已暂存，采纳并保存后才写入图文件。".into(),
                Ok(()) => "本轮已结束；已保存检查点，可加载结果或继续下一轮。".into(),
            };
        }
    });
    Ok(Json(status))
}
async fn stop_analysis(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    headers: axum::http::HeaderMap,
) -> Result<Json<crate::analysis::resume::Status>, AppError> {
    same_origin(&headers)?;
    let mut jobs = state
        .analysis_jobs
        .state
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if jobs.0 != slug || jobs.1.status != "running" || jobs.1.draft_id != state.analysis_draft_id {
        return Err(AppError::BadRequest("此图没有运行中的任务".into()));
    }
    state
        .analysis_jobs
        .cancel
        .store(true, std::sync::atomic::Ordering::Relaxed);
    jobs.1.message = "正在停止，保留已完成的采集结果。".into();
    Ok(Json(jobs.1.clone()))
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = Json(ErrorBody {
            error: self.to_string(),
        });
        (status, body).into_response()
    }
}

pub async fn serve(
    address: SocketAddr,
    public_dir: PathBuf,
    graphs_dir: PathBuf,
    scenarios_dir: PathBuf,
    layouts_dir: PathBuf,
    projects_config: PathBuf,
) -> Result<(), String> {
    if !address.ip().is_loopback() {
        return Err("出于本地源码安全考虑，服务只能监听 loopback 地址".to_owned());
    }
    let project_catalog = FileProjectCatalog::from_file(&projects_config)?;
    let state = AppState::new(
        Arc::new(FileGraphStore::new(graphs_dir)),
        Arc::new(FileScenarioStore::new(scenarios_dir)),
        Arc::new(project_catalog),
        Arc::new(VscodeUriLinkBuilder),
        Arc::new(FileSourcePreviewer::default()),
        Arc::new(FileLayoutStore::new(layouts_dir)),
    );
    let draft_sessions = Arc::downgrade(&state.drafts);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            let Some(sessions) = draft_sessions.upgrade() else {
                break;
            };
            if let Ok(mut drafts) = sessions.lock() {
                drafts.retain(|_, draft| {
                    !draft.expired_clean(std::time::Duration::from_secs(15 * 60))
                });
            }
        }
    });
    let index = public_dir.join("index.html");
    let static_files = ServeDir::new(public_dir).not_found_service(ServeFile::new(index));
    let app = Router::new()
        .route(
            "/api/projects/{project}/source-files",
            get(graph_creation::files),
        )
        .route(
            "/api/projects/{project}/source-files/{file}",
            get(graph_creation::source),
        )
        .route(
            "/api/projects/{project}/entry-check",
            post(graph_creation::check),
        )
        .route("/api/health", get(health))
        .route("/api/graphs/{slug}/source-files", get(list_entry_files))
        .route(
            "/api/graphs/{slug}/source-files/{file}",
            get(read_entry_file),
        )
        .route("/api/graphs/{slug}/draft", post(drafts::edit))
        .route("/api/graphs/{slug}/prune", post(prune_graph))
        .route("/api/graphs/{slug}/entry-check", post(check_entry))
        .route("/api/graphs/{slug}/entries", post(create_entry))
        .route("/api/graphs/{slug}/links", post(add_manual_link))
        .route(
            "/api/graphs/{slug}/links/{edge}",
            axum::routing::delete(remove_manual_link),
        )
        .route(
            "/api/graphs/{slug}/analysis",
            get(analysis_status)
                .post(start_analysis)
                .delete(stop_analysis),
        )
        .route("/api/graphs", get(list_graphs).post(graph_creation::create))
        .route("/api/graphs/{slug}", get(get_graph).delete(archive_graph))
        .route("/api/graph-trash", get(list_archived_graphs))
        .route(
            "/api/graph-trash/{slug}",
            axum::routing::delete(delete_archived_graph),
        )
        .route("/api/graph-trash/{slug}/restore", post(restore_graph))
        .route("/api/scenarios", get(list_scenarios))
        .route("/api/scenarios/{slug}", get(get_scenario))
        .route(
            "/api/graphs/{slug}/category",
            axum::routing::put(update_graph_category),
        )
        .route(
            "/api/graphs/{slug}/layout",
            get(get_graph_layout).put(save_graph_layout),
        )
        .route("/api/graphs/{slug}/validation", get(validate_graph_source))
        .route("/api/open", post(build_source_link))
        .route("/api/preview", post(preview_source))
        .fallback_service(static_files)
        .layer(axum::middleware::from_fn(security_headers))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("permissions-policy"),
            HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|error| format!("无法监听 {address}：{error}"))?;
    tracing::info!("visualizer running at http://{address}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(state.analysis_jobs.sessions.clone()))
        .await
        .map_err(|error| format!("服务异常退出：{error}"))
}

async fn security_headers(request: Request, next: Next) -> Response {
    let isolated_monaco_frame = request.uri().path() == "/monaco-preview.html";
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    let (content_security_policy, frame_options) = if isolated_monaco_frame {
        (
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
             worker-src 'self'; font-src 'self' data:; img-src 'self' data:; \
             connect-src 'none'; object-src 'none'; base-uri 'none'; \
             frame-ancestors 'self'; form-action 'none'",
            "SAMEORIGIN",
        )
    } else {
        (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; \
             connect-src 'self'; worker-src 'self'; frame-src 'self'; object-src 'none'; \
             base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
            "DENY",
        )
    };
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static(content_security_policy),
    );
    headers.insert(
        header::X_FRAME_OPTIONS,
        HeaderValue::from_static(frame_options),
    );
    response
}

async fn shutdown_signal(sessions: Arc<crate::analysis::session_cache::SessionCache>) {
    let _ = tokio::signal::ctrl_c().await;
    sessions.shutdown().await;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    projects: Vec<ResolvedProject>,
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        projects: state.project_catalog.projects(),
    })
}

async fn list_graphs(State(state): State<AppState>) -> Result<Json<Vec<GraphSummary>>, AppError> {
    let graphs = state.graph_store.list().map_err(AppError::Internal)?;
    let mut summaries = Vec::with_capacity(graphs.len());
    for (slug, graph) in graphs {
        summaries.push(GraphSummary {
            slug,
            title: graph.title,
            category_id: graph.category_id,
            category: graph.category,
            description: graph.description,
            project_id: graph.project_id,
            node_count: graph.nodes.len(),
            edge_count: graph.edges.len(),
        });
    }
    summaries.sort_by(|left, right| left.title.cmp(&right.title));
    Ok(Json(summaries))
}

async fn get_graph(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<CallGraph>, AppError> {
    Ok(Json(read_graph(&state, &slug)?))
}

async fn list_scenarios(
    State(state): State<AppState>,
) -> Result<Json<Vec<ScenarioSummary>>, AppError> {
    let mut summaries = state
        .scenario_store
        .list()
        .map_err(scenario_store_error)?
        .into_iter()
        .map(|(slug, scenario)| ScenarioSummary {
            slug,
            title: scenario.title,
            goal: scenario.goal,
            participant_count: scenario.participants.len(),
            step_count: scenario.steps.len(),
        })
        .collect::<Vec<_>>();
    summaries.sort_by(|left, right| left.title.cmp(&right.title));
    Ok(Json(summaries))
}

async fn get_scenario(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<ArchitectureScenario>, AppError> {
    let scenario = state
        .scenario_store
        .load(&slug)
        .map_err(scenario_store_error)?;
    validate_scenario_drilldowns(&scenario, state.graph_store.as_ref())
        .map_err(AppError::Internal)?;
    Ok(Json(scenario))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CategoryUpdateRequest {
    category_id: String,
    category: String,
}

async fn update_graph_category(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(request): Json<CategoryUpdateRequest>,
) -> Result<Json<CallGraph>, AppError> {
    state
        .graph_store
        .update_category(&slug, &request.category_id, &request.category)
        .map(Json)
        .map_err(graph_store_error)
}

async fn get_graph_layout(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<GraphLayout>, AppError> {
    let graph = read_graph(&state, &slug)?;
    let layout = state
        .layout_store
        .load(&slug)
        .map_err(AppError::Internal)?
        .unwrap_or_else(|| GraphLayout::empty(&slug));
    Ok(Json(sanitize_loaded_layout(layout, &slug, &graph)?))
}

async fn save_graph_layout(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(layout): Json<GraphLayout>,
) -> Result<Json<GraphLayout>, AppError> {
    let graph = read_graph(&state, &slug)?;
    validate_layout(&layout, &slug, &graph)?;
    state
        .layout_store
        .save(&slug, &layout)
        .map_err(AppError::Internal)?;
    Ok(Json(layout))
}

fn validate_layout(layout: &GraphLayout, slug: &str, graph: &CallGraph) -> Result<(), AppError> {
    if layout.schema_version != LAYOUT_SCHEMA_VERSION {
        return Err(AppError::BadRequest(format!(
            "不支持布局 schemaVersion {:?}",
            layout.schema_version
        )));
    }
    if layout.graph != slug {
        return Err(AppError::BadRequest(format!(
            "布局 graph {:?} 与路由 {:?} 不一致",
            layout.graph, slug
        )));
    }
    let node_ids = graph
        .nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    for (orientation, positions) in &layout.positions {
        if !matches!(orientation.as_str(), "vertical" | "horizontal") {
            return Err(AppError::BadRequest(format!("布局方向无效：{orientation}")));
        }
        if positions.len() > graph.nodes.len() {
            return Err(AppError::BadRequest(
                "布局节点数量超过调用图节点数量".to_owned(),
            ));
        }
        for (node_id, position) in positions {
            if !node_ids.contains(node_id.as_str()) {
                return Err(AppError::BadRequest(format!(
                    "布局引用了不存在的节点：{node_id}"
                )));
            }
            if !position.x.is_finite()
                || !position.y.is_finite()
                || position.x.abs() > 1_000_000.0
                || position.y.abs() > 1_000_000.0
            {
                return Err(AppError::BadRequest(format!(
                    "节点 {node_id} 的布局坐标无效"
                )));
            }
        }
    }
    Ok(())
}

fn sanitize_loaded_layout(
    mut layout: GraphLayout,
    slug: &str,
    graph: &CallGraph,
) -> Result<GraphLayout, AppError> {
    if layout.schema_version != LAYOUT_SCHEMA_VERSION || layout.graph != slug {
        return Err(AppError::BadRequest(
            "布局配置的 schemaVersion 或 graph 与当前调用图不一致".to_owned(),
        ));
    }
    if layout
        .positions
        .keys()
        .any(|orientation| !matches!(orientation.as_str(), "vertical" | "horizontal"))
    {
        return Err(AppError::BadRequest("布局配置包含无效方向".to_owned()));
    }
    let node_ids = graph
        .nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    for positions in layout.positions.values_mut() {
        positions.retain(|node_id, position| {
            node_ids.contains(node_id.as_str())
                && position.x.is_finite()
                && position.y.is_finite()
                && position.x.abs() <= 1_000_000.0
                && position.y.abs() <= 1_000_000.0
        });
    }
    Ok(layout)
}

async fn validate_graph_source(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<ValidationReport>, AppError> {
    let graph = read_graph(&state, &slug)?;
    let project_root = state
        .project_catalog
        .resolve_root(&graph.project_id)
        .map_err(AppError::BadRequest)?;
    Ok(Json(validate_graph(&graph, Some(&project_root))))
}

async fn build_source_link(
    State(state): State<AppState>,
    Json(request): Json<OpenRequest>,
) -> Result<Json<OpenResponse>, AppError> {
    let graph = read_graph(&state, &request.graph)?;
    let location = resolve_target_location(&graph, &request.target_type, &request.id)?;
    let project_root = state
        .project_catalog
        .resolve_root(&graph.project_id)
        .map_err(AppError::BadRequest)?;
    let path = resolve_source_path(&project_root, location.file).map_err(AppError::BadRequest)?;
    let column = 1;
    let uri = state
        .source_link_builder
        .build(&path, location.start_line, column)
        .map_err(AppError::Internal)?;
    Ok(Json(OpenResponse {
        uri,
        path: path.display().to_string(),
        line: location.start_line,
        column,
    }))
}

async fn preview_source(
    State(state): State<AppState>,
    Json(request): Json<PreviewRequest>,
) -> Result<Json<SourcePreview>, AppError> {
    let graph = read_graph(&state, &request.graph)?;
    let location = resolve_target_location(&graph, &request.target_type, &request.id)?;
    let project_root = state
        .project_catalog
        .resolve_root(&graph.project_id)
        .map_err(AppError::BadRequest)?;
    let path = resolve_source_path(&project_root, location.file).map_err(AppError::BadRequest)?;
    let mut preview = state
        .source_previewer
        .preview(
            &path,
            location.start_line,
            location.end_line,
            request.context_lines.unwrap_or(DEFAULT_CONTEXT_LINES),
            request.scope,
        )
        .map_err(AppError::BadRequest)?;
    preview.path = location.file.to_owned();
    Ok(Json(preview))
}

struct TargetLocation<'a> {
    file: &'a str,
    start_line: u32,
    end_line: u32,
}

fn resolve_target_location<'a>(
    graph: &'a CallGraph,
    target_type: &str,
    id: &str,
) -> Result<TargetLocation<'a>, AppError> {
    match target_type {
        "node" => graph
            .nodes
            .iter()
            .find(|node| node.id == id)
            .map(|node| TargetLocation {
                file: node.file.as_str(),
                start_line: node.line,
                end_line: node.end_line.unwrap_or(node.line),
            })
            .ok_or_else(|| AppError::NotFound(format!("节点不存在：{id}"))),
        "edge" => {
            let edge = graph
                .edges
                .iter()
                .find(|edge| edge.id == id)
                .ok_or_else(|| AppError::NotFound(format!("连线不存在：{id}")))?;
            edge.exact_call_site()
                .map(|(file, line)| TargetLocation {
                    file,
                    start_line: line,
                    end_line: line,
                })
                .ok_or_else(|| {
                    AppError::BadRequest(format!(
                        "连线 {} 没有可跳转的精确调用位置：{}",
                        id,
                        edge.call_site_note.trim()
                    ))
                })
        }
        _ => Err(AppError::BadRequest(
            "targetType 必须是 node 或 edge".to_owned(),
        )),
    }
}

fn read_graph(state: &AppState, slug: &str) -> Result<CallGraph, AppError> {
    state.graph_store.load(slug).map_err(graph_store_error)
}

fn graph_store_error(error: String) -> AppError {
    if error.starts_with("调用图不存在") {
        AppError::NotFound(error)
    } else if error == "调用图名称不合法"
        || error.starts_with("categoryId")
        || error.starts_with("分类名称")
        || error.starts_with("目标分类中已存在")
    {
        AppError::BadRequest(error)
    } else {
        AppError::Internal(error)
    }
}

fn scenario_store_error(error: String) -> AppError {
    if error.starts_with("架构场景不存在") {
        AppError::NotFound(error)
    } else if error.contains("名称必须") {
        AppError::BadRequest(error)
    } else {
        AppError::Internal(error)
    }
}

async fn list_archived_graphs(
    State(state): State<AppState>,
) -> Result<Json<Vec<GraphSummary>>, AppError> {
    let graphs = state.graph_store.archived().map_err(AppError::Internal)?;
    let mut summaries = Vec::with_capacity(graphs.len());
    for (slug, graph) in graphs {
        summaries.push(GraphSummary {
            slug,
            title: graph.title,
            category_id: graph.category_id,
            category: graph.category,
            description: graph.description,
            project_id: graph.project_id,
            node_count: graph.nodes.len(),
            edge_count: graph.edges.len(),
        });
    }
    summaries.sort_by(|left, right| left.title.cmp(&right.title));
    Ok(Json(summaries))
}

async fn archive_graph(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    state
        .graph_store
        .set_archived(&slug, true)
        .map_err(graph_store_error)?;
    Ok(Json(serde_json::json!({"slug":slug,"archived":true})))
}
async fn restore_graph(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    state
        .graph_store
        .set_archived(&slug, false)
        .map_err(graph_store_error)?;
    Ok(Json(serde_json::json!({"slug":slug,"archived":false})))
}

async fn delete_archived_graph(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    state
        .graph_store
        .delete_archived(&slug)
        .map_err(graph_store_error)?;
    Ok(Json(serde_json::json!({"slug":slug,"deleted":true})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_non_loopback_http_bind_address() {
        let error = serve(
            SocketAddr::from(([0, 0, 0, 0], 4317)),
            PathBuf::from("public"),
            PathBuf::from("graphs"),
            PathBuf::from("scenarios"),
            PathBuf::from("layouts"),
            PathBuf::from("callgraph.projects.json"),
        )
        .await
        .expect_err("non-loopback address must be rejected");

        assert_eq!(error, "出于本地源码安全考虑，服务只能监听 loopback 地址");
    }
}
