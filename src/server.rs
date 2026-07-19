use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::extract::{Path as AxumPath, State};
use axum::http::{HeaderName, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::Serialize;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use crate::graph_store::{FileGraphStore, GraphStore};
use crate::model::{
    CallGraph, GraphSummary, OpenRequest, OpenResponse, PreviewRequest, SourcePreview,
    ValidationReport,
};
use crate::navigation::{SourceLinkBuilder, VscodeUriLinkBuilder};
use crate::project_catalog::{FileProjectCatalog, ProjectCatalog, ResolvedProject};
use crate::source_preview::{DEFAULT_CONTEXT_LINES, FileSourcePreviewer, SourcePreviewer};
use crate::validation::{resolve_source_path, validate_graph};

#[derive(Clone)]
pub struct AppState {
    graph_store: Arc<dyn GraphStore>,
    project_catalog: Arc<dyn ProjectCatalog>,
    source_link_builder: Arc<dyn SourceLinkBuilder>,
    source_previewer: Arc<dyn SourcePreviewer>,
}

impl AppState {
    pub fn new(
        graph_store: Arc<dyn GraphStore>,
        project_catalog: Arc<dyn ProjectCatalog>,
        source_link_builder: Arc<dyn SourceLinkBuilder>,
        source_previewer: Arc<dyn SourcePreviewer>,
    ) -> Self {
        Self {
            graph_store,
            project_catalog,
            source_link_builder,
            source_previewer,
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
    projects_config: PathBuf,
) -> Result<(), String> {
    let project_catalog = FileProjectCatalog::from_file(&projects_config)?;
    let state = AppState::new(
        Arc::new(FileGraphStore::new(graphs_dir)),
        Arc::new(project_catalog),
        Arc::new(VscodeUriLinkBuilder),
        Arc::new(FileSourcePreviewer::default()),
    );
    let index = public_dir.join("index.html");
    let static_files = ServeDir::new(public_dir).not_found_service(ServeFile::new(index));
    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/graphs", get(list_graphs))
        .route("/api/graphs/{slug}", get(get_graph))
        .route("/api/graphs/{slug}/validation", get(validate_graph_source))
        .route("/api/open", post(build_source_link))
        .route("/api/preview", post(preview_source))
        .fallback_service(static_files)
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("content-security-policy"),
            HeaderValue::from_static(
                "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; \
                 connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; \
                 form-action 'none'",
            ),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
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
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|error| format!("无法监听 {address}：{error}"))?;
    tracing::info!("visualizer running at http://{address}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(|error| format!("服务异常退出：{error}"))
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
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
    state.graph_store.load(slug).map_err(|error| {
        if error.starts_with("调用图不存在") {
            AppError::NotFound(error)
        } else if error == "调用图名称不合法" {
            AppError::BadRequest(error)
        } else {
            AppError::Internal(error)
        }
    })
}
