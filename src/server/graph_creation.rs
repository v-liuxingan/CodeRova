//! Project-scoped entry selection for creating a root-only graph.
use super::*;

pub(super) async fn files(
    State(state): State<AppState>,
    AxumPath(project): AxumPath<String>,
) -> Result<Json<Vec<crate::analysis::entry::SourceFile>>, AppError> {
    let root = state
        .project_catalog
        .resolve_root(&project)
        .map_err(AppError::BadRequest)?;
    Ok(Json(
        crate::analysis::entry::files(&root).map_err(AppError::BadRequest)?,
    ))
}
pub(super) async fn source(
    State(state): State<AppState>,
    AxumPath((project, file)): AxumPath<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let root = state
        .project_catalog
        .resolve_root(&project)
        .map_err(AppError::BadRequest)?;
    let (name, text) =
        crate::analysis::entry::source(&root, &file).map_err(AppError::BadRequest)?;
    Ok(Json(serde_json::json!({"name":name,"text":text})))
}
pub(super) async fn check(
    State(state): State<AppState>,
    AxumPath(project): AxumPath<String>,
    headers: axum::http::HeaderMap,
    Json(input): Json<EntryCheck>,
) -> Result<Json<serde_json::Value>, AppError> {
    same_origin(&headers)?;
    check_project_entry(&state, format!("project:{project}"), &project, input).await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CreateGraph {
    project_id: String,
    candidate_id: String,
    title: String,
}
pub(super) async fn create(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(input): Json<CreateGraph>,
) -> Result<Json<serde_json::Value>, AppError> {
    same_origin(&headers)?;
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 160 {
        return Err(AppError::BadRequest("图名称应为 1–160 个字符".into()));
    }
    let root = state
        .project_catalog
        .resolve_root(&input.project_id)
        .map_err(AppError::BadRequest)?;
    let mut candidates = state
        .entry_candidates
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let candidate = candidates
        .get(&input.candidate_id)
        .filter(|c| c.slug == format!("project:{}", input.project_id))
        .ok_or_else(|| AppError::BadRequest("入口校验已失效，请重新校验".into()))?;
    let path = resolve_source_path(&root, &candidate.node.file).map_err(AppError::BadRequest)?;
    if std::fs::read_to_string(path).map_err(|e| AppError::BadRequest(e.to_string()))?
        != candidate.text
    {
        return Err(AppError::BadRequest("源码已变化，请重新校验".into()));
    }
    let language = crate::analysis::provider::Language::for_file(&candidate.node.file)
        .map_err(AppError::BadRequest)?;
    let graph = CallGraph {
        schema_version: "0.4".into(),
        project_id: input.project_id,
        title: title.into(),
        category_id: "analysis".into(),
        category: "源码分析".into(),
        root: candidate.node.id.clone(),
        description: "项目内静态调用；不代表运行时执行轨迹。".into(),
        source_revision: None,
        phases: vec![],
        nodes: vec![candidate.node.clone()],
        edges: vec![],
        analysis: Some(crate::analysis::AnalysisReport {
            provider: language.provider().into(),
            scope: language.scope().into(),
            max_depth: 50,
            request_budget: 100,
            queried_nodes: vec![],
            pending_nodes: vec![candidate.node.id.clone()],
            issues: vec![],
            pruned_node_ids: vec![],
        }),
    };
    let report = validate_graph(&graph, Some(&root));
    if !report.errors.is_empty() {
        return Err(AppError::BadRequest(report.errors.join("; ")));
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| AppError::Internal(e.to_string()))?
        .as_nanos();
    let slug = format!("graph-{now:x}");
    state
        .graph_store
        .create(&slug, &graph)
        .map_err(AppError::BadRequest)?;
    candidates.remove(&input.candidate_id);
    Ok(Json(serde_json::json!({"slug":slug,"nodeId":graph.root})))
}
