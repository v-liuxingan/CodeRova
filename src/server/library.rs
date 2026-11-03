use super::*;
use crate::library_storage::{Change, Library, LibraryStorage, valid_name};
fn storage(state: &AppState) -> Result<&LibraryStorage, AppError> {
    state
        .library
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("此服务未配置资料库存储".into()))
}
pub(super) async fn get(State(state): State<AppState>) -> Result<Json<Library>, AppError> {
    Ok(Json(storage(&state)?.read().map_err(AppError::Internal)?))
}
pub(super) async fn change(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(change): Json<Change>,
) -> Result<Json<Library>, AppError> {
    same_origin(&headers)?;
    let project = match &change {
        Change::RenameDirectory { project_id, .. }
        | Change::UpsertGroup { project_id, .. }
        | Change::DeleteGroup { project_id, .. } => project_id,
    };
    state
        .project_catalog
        .resolve_root(project)
        .map_err(AppError::BadRequest)?;
    Ok(Json(
        storage(&state)?
            .change(change)
            .map_err(AppError::BadRequest)?,
    ))
}
pub(super) async fn info(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(storage(&state)?.info().map_err(AppError::Internal)?))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Selection {
    selection_id: String,
}
pub(super) async fn configure(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(input): Json<Selection>,
) -> Result<Json<serde_json::Value>, AppError> {
    same_origin(&headers)?;
    let path = project_setup::take_directory(&state, &input.selection_id)?;
    storage(&state)?
        .configure(&path)
        .map_err(AppError::BadRequest)?;
    info(State(state)).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Title {
    title: String,
}
pub(super) async fn rename(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    headers: axum::http::HeaderMap,
    Json(input): Json<Title>,
) -> Result<Json<CallGraph>, AppError> {
    same_origin(&headers)?;
    valid_name(&input.title, 160).map_err(AppError::BadRequest)?;
    let before = state
        .graph_store
        .load(&slug)
        .map_err(AppError::BadRequest)?;
    let mut after = before.clone();
    after.title = input.title.trim().into();
    state
        .graph_store
        .checkpoint(&slug, &before, &after)
        .map_err(AppError::BadRequest)?;
    Ok(Json(after))
}
