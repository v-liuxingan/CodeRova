use super::*;
use crate::draft_store::DraftStore;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Request {
    draft_id: Option<String>,
    operation: Operation,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
enum Operation {
    Read {},
    Describe {
        edits: Vec<crate::draft_store::DescriptionEdit>,
    },
    Analyze {
        request: ResumeRequest,
    },
    AnalysisStatus {},
    StopAnalysis {},
    Entry {
        request: EntryCreate,
    },
    Link {
        request: ManualLinkRequest,
    },
    RemoveLink {
        #[serde(rename = "edgeId")]
        edge_id: String,
    },
    Prune {
        request: PruneRequest,
    },
    Open {
        request: OpenRequest,
    },
    Preview {
        request: PreviewRequest,
    },
    Save {},
    Discard {},
}
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) async fn edit(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    headers: axum::http::HeaderMap,
    Json(input): Json<Request>,
) -> Result<Json<serde_json::Value>, AppError> {
    same_origin(&headers)?;
    let (id, draft) = {
        let mut drafts = state
            .drafts
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        match input.draft_id {
            Some(id) => {
                if !drafts.contains_key(&id) && matches!(input.operation, Operation::Discard {}) {
                    return Ok(Json(
                        serde_json::json!({"draftId":null,"dirty":false,"graph":null,"result":{"discarded":true}}),
                    ));
                }
                let draft = drafts
                    .get(&id)
                    .filter(|d| d.slug == slug)
                    .cloned()
                    .ok_or_else(|| {
                        AppError::BadRequest("草稿已失效，请重新加载；未保存修改不在磁盘中".into())
                    })?;
                (id, draft)
            }
            None => {
                if !matches!(input.operation, Operation::Read {}) {
                    return Err(AppError::BadRequest(
                        "请先 read 创建草稿，再携带草稿 ID 操作".into(),
                    ));
                }
                drafts.retain(|_, draft| {
                    !draft.expired_clean(std::time::Duration::from_secs(15 * 60))
                });
                if drafts.len() >= 128 {
                    return Err(AppError::BadRequest(
                        "草稿会话过多，请保存或放弃已有草稿".into(),
                    ));
                }
                let id = crate::analysis::stable_id(&format!(
                    "{:?}-{}",
                    std::time::SystemTime::now(),
                    SEQUENCE.fetch_add(1, Ordering::Relaxed)
                ));
                let draft = Arc::new(
                    DraftStore::new(slug.clone(), state.graph_store.clone())
                        .map_err(AppError::BadRequest)?,
                );
                drafts.insert(id.clone(), draft.clone());
                (id, draft)
            }
        }
    };
    let _operation = draft.operation.lock().await;
    if !state
        .drafts
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?
        .contains_key(&id)
    {
        return Err(AppError::BadRequest("草稿已关闭".into()));
    }
    let mut local = state.clone();
    local.graph_store = draft.clone();
    local.analysis_draft_id = Some(id.clone());
    let include_graph = matches!(
        input.operation,
        Operation::Read {} | Operation::Save {} | Operation::Discard {}
    );
    let closing = matches!(input.operation, Operation::Discard {});
    let result = match input.operation {
        Operation::Read {} => serde_json::Value::Null,
        Operation::Describe { edits } => {
            let jobs = state
                .analysis_jobs
                .state
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            if jobs.1.status == "running" && jobs.1.draft_id.as_deref() == Some(&id) {
                return Err(AppError::BadRequest(
                    "请等待采集结束或停止后编辑描述".into(),
                ));
            }
            drop(jobs);
            serde_json::json!({"updated":draft.describe(edits).map_err(AppError::BadRequest)?})
        }
        Operation::Analyze { request } => {
            let result =
                start_analysis(State(local), AxumPath(slug.clone()), headers, Json(request))
                    .await?
                    .0;
            draft.collection.store(true, Ordering::Relaxed);
            serde_json::to_value(result).map_err(|e| AppError::Internal(e.to_string()))?
        }
        Operation::AnalysisStatus {} => serde_json::to_value(
            analysis_status(State(local), AxumPath(slug.clone()))
                .await?
                .0,
        )
        .map_err(|e| AppError::Internal(e.to_string()))?,
        Operation::StopAnalysis {} => serde_json::to_value(
            stop_analysis(State(local), AxumPath(slug.clone()), headers)
                .await?
                .0,
        )
        .map_err(|e| AppError::Internal(e.to_string()))?,
        Operation::Entry { request } => {
            create_entry(State(local), AxumPath(slug.clone()), headers, Json(request))
                .await?
                .0
        }
        Operation::Link { request } => {
            add_manual_link(State(local), AxumPath(slug.clone()), headers, Json(request))
                .await?
                .0
        }
        Operation::RemoveLink { edge_id } => {
            remove_manual_link(State(local), AxumPath((slug.clone(), edge_id)), headers)
                .await?
                .0
        }
        Operation::Prune { request } => serde_json::to_value(
            prune_graph(State(local), AxumPath(slug.clone()), headers, Json(request))
                .await?
                .0,
        )
        .map_err(|e| AppError::Internal(e.to_string()))?,
        Operation::Open { request } => {
            if request.graph != slug {
                return Err(AppError::BadRequest("跳转目标必须属于当前草稿".into()));
            }
            serde_json::to_value(build_source_link(State(local), Json(request)).await?.0)
                .map_err(|e| AppError::Internal(e.to_string()))?
        }
        Operation::Preview { request } => {
            if request.graph != slug {
                return Err(AppError::BadRequest("预览目标必须属于当前草稿".into()));
            }
            serde_json::to_value(preview_source(State(local), Json(request)).await?.0)
                .map_err(|e| AppError::Internal(e.to_string()))?
        }
        Operation::Save {} => {
            let mut jobs = state
                .analysis_jobs
                .state
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            if jobs.1.status == "running" {
                return Err(AppError::BadRequest("请等待采集结束再保存草稿".into()));
            }
            draft.save().map_err(AppError::BadRequest)?;
            if jobs.1.draft_id.as_deref() == Some(&id) {
                *jobs = Default::default();
            }
            draft.collection.store(false, Ordering::Relaxed);
            serde_json::json!({"saved":true})
        }
        Operation::Discard {} => {
            let mut jobs = state
                .analysis_jobs
                .state
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            if jobs.1.draft_id.as_deref() == Some(&id) {
                if jobs.1.status == "running" {
                    state.analysis_jobs.cancel.store(true, Ordering::Relaxed);
                } else {
                    *jobs = Default::default();
                }
            }
            serde_json::json!({"discarded":true})
        }
    };
    let (graph, was_dirty) = if include_graph {
        let (graph, dirty) = draft.snapshot().map_err(AppError::BadRequest)?;
        (Some(graph), dirty)
    } else {
        (None, draft.dirty().map_err(AppError::BadRequest)?)
    };
    let pending_collection = state
        .analysis_jobs
        .state
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?
        .1
        .draft_id
        .as_deref()
        == Some(&id);
    let dirty = !closing && (was_dirty || pending_collection);
    if closing {
        state
            .drafts
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?
            .remove(&id);
    }
    Ok(Json(
        serde_json::json!({"draftId":if closing {None} else {Some(id)},"dirty":dirty,"changes":draft.changes().map_err(AppError::BadRequest)?,"graph":graph,"result":result}),
    ))
}
