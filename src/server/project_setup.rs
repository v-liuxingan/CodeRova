//! Project onboarding and explicit LSP lifecycle. Browser inputs never select commands or paths.
use super::*;
use crate::analysis::{provider::Language, session_cache::Lease};
use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
#[derive(Default)]
pub(super) struct Services {
    directories: Mutex<HashMap<String, (PathBuf, Instant)>>,
    selecting: AtomicBool,
    workers: Mutex<HashMap<(String, String), Worker>>,
    next: AtomicU64,
    control: tokio::sync::Mutex<()>,
}
struct Worker {
    generation: u64,
    state: String,
    message: String,
    task: Option<tokio::task::JoinHandle<()>>,
}
fn language(id: &str) -> Result<Language, AppError> {
    match id {
        "rust" => Ok(Language::Rust),
        "java" => Ok(Language::Java),
        _ => Err(AppError::BadRequest("仅支持 Rust 和 Java".into())),
    }
}
fn failure(e: impl ToString) -> AppError {
    AppError::BadRequest(e.to_string())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Register {
    selection_id: String,
    name: String,
}
pub(super) async fn select_directory(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    same_origin(&headers)?;
    if state
        .project_services
        .selecting
        .swap(true, Ordering::Relaxed)
    {
        return Err(failure("目录选择器已打开"));
    }
    struct Reset(Arc<Services>);
    impl Drop for Reset {
        fn drop(&mut self) {
            self.0.selecting.store(false, Ordering::Relaxed);
        }
    }
    let _reset = Reset(state.project_services.clone());
    let selected = choose_directory().await.map_err(failure)?;
    let Some(root) = selected else {
        return Ok(Json(serde_json::json!({"cancelled":true})));
    };
    let root = root.canonicalize().map_err(failure)?;
    if !root.is_dir() {
        return Err(failure("选择的目录不存在"));
    }
    let id = format!(
        "directory-{}-{}",
        std::process::id(),
        state.project_services.next.fetch_add(1, Ordering::Relaxed)
    );
    let mut selections = state.project_services.directories.lock().map_err(failure)?;
    selections.retain(|_, (_, t)| t.elapsed() < Duration::from_secs(600));
    if selections.len() >= 32 {
        return Err(failure("目录选择过多，请稍后重试"));
    }
    selections.insert(id.clone(), (root.clone(), Instant::now()));
    Ok(Json(
        serde_json::json!({"selectionId":id,"name":root.file_name().unwrap_or_default().to_string_lossy(),"root":crate::project_catalog::tool_path(&root)}),
    ))
}
async fn choose_directory() -> Result<Option<PathBuf>, String> {
    choose_path(None).await
}
pub(super) fn take_directory(state: &AppState, id: &str) -> Result<PathBuf, AppError> {
    state
        .project_services
        .directories
        .lock()
        .map_err(failure)?
        .remove(id)
        .filter(|(_, time)| time.elapsed() < Duration::from_secs(600))
        .map(|(path, _)| path)
        .ok_or_else(|| failure("目录选择已失效，请重新选择"))
}
#[cfg(windows)]
async fn choose_path(root: Option<PathBuf>) -> Result<Option<PathBuf>, String> {
    tokio::task::spawn_blocking(move || {
        let picker = rfd::FileDialog::new();
        match root {
            Some(root) => picker
                .set_title("选择项目内源文件")
                .set_directory(crate::project_catalog::tool_path(&root))
                .add_filter("Rust / Java 源文件", &["rs", "java"])
                .pick_file(),
            None => picker.set_title("选择本地文件夹").pick_folder(),
        }
    })
    .await
    .map_err(|e| e.to_string())
}
#[cfg(not(windows))]
async fn choose_path(_root: Option<PathBuf>) -> Result<Option<PathBuf>, String> {
    Err("本机选择器目前支持 Windows；请使用项目文件列表或配置文件".into())
}
pub(super) async fn select_graph_file(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    same_origin(&headers)?;
    let graph = state.graph_store.load(&slug).map_err(AppError::NotFound)?;
    select_file(State(state), AxumPath(graph.project_id), headers).await
}
pub(super) async fn select_file(
    State(state): State<AppState>,
    AxumPath(project): AxumPath<String>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    same_origin(&headers)?;
    let root = state
        .project_catalog
        .resolve_root(&project)
        .map_err(failure)?;
    if state
        .project_services
        .selecting
        .swap(true, Ordering::Relaxed)
    {
        return Err(failure("文件选择器已打开"));
    }
    struct Reset(Arc<Services>);
    impl Drop for Reset {
        fn drop(&mut self) {
            self.0.selecting.store(false, Ordering::Relaxed);
        }
    }
    let _reset = Reset(state.project_services.clone());
    let Some(selected) = choose_path(Some(root.clone())).await.map_err(failure)? else {
        return Ok(Json(serde_json::json!({"cancelled":true})));
    };
    let file = selected_file(&root, &selected).map_err(failure)?;
    Ok(Json(serde_json::json!({"id":file.id,"name":file.name})))
}
fn selected_file(
    root: &std::path::Path,
    selected: &std::path::Path,
) -> Result<crate::analysis::entry::SourceFile, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    // Reject links before resolving Windows short names / path casing. Matching
    // raw picker strings against canonical catalog paths rejects valid aliases.
    for ancestor in selected
        .ancestors()
        .filter(|path| !path.as_os_str().is_empty())
    {
        if std::fs::symlink_metadata(ancestor)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("请选择当前项目内的源文件，不支持符号链接".into());
        }
    }
    let selected = selected.canonicalize().map_err(|e| e.to_string())?;
    crate::analysis::entry::files(&root)?
        .into_iter()
        .find(|file| {
            root.join(&file.name)
                .canonicalize()
                .is_ok_and(|path| path == selected)
        })
        .ok_or_else(|| "请选择当前项目内的 Rust 或 Java 源文件（不含构建目录或符号链接）".into())
}
pub(super) async fn register(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(input): Json<Register>,
) -> Result<Json<ResolvedProject>, AppError> {
    same_origin(&headers)?;
    let root = {
        let selections = state.project_services.directories.lock().map_err(failure)?;
        selections
            .get(&input.selection_id)
            .filter(|(_, t)| t.elapsed() < Duration::from_secs(600))
            .map(|(p, _)| p.clone())
            .ok_or_else(|| failure("目录选择已失效，请重新选择"))?
    };
    let catalog = state.project_catalog.clone();
    let result = tokio::task::spawn_blocking(move || catalog.register(&input.name, &root))
        .await
        .map_err(failure)?
        .map_err(failure)?;
    state
        .project_services
        .directories
        .lock()
        .map_err(failure)?
        .remove(&input.selection_id);
    Ok(Json(result))
}
pub(super) async fn status(
    State(state): State<AppState>,
    AxumPath((project, lang)): AxumPath<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let language = language(&lang)?;
    let root = state
        .project_catalog
        .resolve_root(&project)
        .map_err(failure)?;
    let recorded = state
        .project_services
        .workers
        .lock()
        .map_err(failure)?
        .get(&(project.clone(), lang.clone()))
        .map(|w| (w.state.clone(), w.message.clone()));
    if let Some((phase, message)) = &recorded
        && phase == "starting"
    {
        return Ok(Json(
            serde_json::json!({"state":phase,"message":message,"serverType":language.server_type()}),
        ));
    }
    let phase = state
        .analysis_jobs
        .sessions
        .status(&root, language)
        .await
        .map_err(failure)?;
    if phase == "stopped"
        && let Some((recorded, message)) = recorded
        && recorded == "failed"
    {
        return Ok(Json(
            serde_json::json!({"state":"failed","message":message,"serverType":language.server_type()}),
        ));
    }
    Ok(Json(
        serde_json::json!({"state":phase,"message":"","serverType":language.server_type()}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Control {
    action: Action,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Action {
    Start,
    Stop,
}
pub(super) async fn control(
    State(state): State<AppState>,
    AxumPath((project, lang)): AxumPath<(String, String)>,
    headers: axum::http::HeaderMap,
    Json(input): Json<Control>,
) -> Result<Json<serde_json::Value>, AppError> {
    same_origin(&headers)?;
    let services = state.project_services.clone();
    let _control = services.control.lock().await;
    let language = language(&lang)?;
    let root = state
        .project_catalog
        .resolve_root(&project)
        .map_err(failure)?;
    let key = (project.clone(), lang.clone());
    if matches!(input.action, Action::Stop) {
        // Abort only our warmup task. Active collection/entry leases are protected by SessionCache.
        let warmup = {
            let mut workers = state.project_services.workers.lock().map_err(failure)?;
            workers.get_mut(&key).and_then(|w| {
                if w.state != "starting" {
                    return None;
                }
                w.state = "stopped".into();
                w.generation += 1;
                w.task.take()
            })
        };
        if let Some(task) = warmup {
            task.abort();
            let _ = task.await;
        }
        state
            .analysis_jobs
            .sessions
            .stop_project(&root, language)
            .await
            .map_err(failure)?;
        state
            .project_services
            .workers
            .lock()
            .map_err(failure)?
            .remove(&key);
        return Ok(Json(
            serde_json::json!({"state":"stopped","message":"","serverType":language.server_type()}),
        ));
    }
    let phase = state
        .analysis_jobs
        .sessions
        .status(&root, language)
        .await
        .map_err(failure)?;
    if phase == "busy" {
        return status(State(state), AxumPath((project, lang))).await;
    }
    if phase == "running" {
        state
            .analysis_jobs
            .sessions
            .pin(&root, language)
            .map_err(failure)?;
        return status(State(state), AxumPath((project, lang))).await;
    }
    let generation = state.project_services.next.fetch_add(1, Ordering::Relaxed);
    {
        let mut workers = state.project_services.workers.lock().map_err(failure)?;
        if workers.get(&key).is_some_and(|w| w.state == "starting") {
            return Ok(Json(
                serde_json::json!({"state":"starting","message":"正在启动语言服务器…","serverType":language.server_type()}),
            ));
        }
        workers.retain(|_, w| w.state == "starting");
        if workers.len() >= 2 {
            return Err(failure("已有两个启动任务，请稍后重试"));
        }
        workers.insert(
            key.clone(),
            Worker {
                generation,
                state: "starting".into(),
                message: "正在启动语言服务器…".into(),
                task: None,
            },
        );
    }
    let services = state.project_services.clone();
    let sessions = state.analysis_jobs.sessions.clone();
    let task_key = key.clone();
    let task = tokio::spawn(async move {
        let result = async {
            let mut lease = Lease::acquire(sessions.clone(), &root, language).await?;
            let scan_root = root.clone();
            let files =
                tokio::task::spawn_blocking(move || crate::analysis::entry::files(&scan_root))
                    .await
                    .map_err(|e| e.to_string())??;
            let file = files
                .iter()
                .find(|f| Language::for_file(&f.name).ok() == Some(language))
                .ok_or("该项目没有对应语言的源文件")?;
            let path = resolve_source_path(&root, &file.name)?;
            let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let uri = url::Url::from_file_path(crate::project_catalog::tool_path(&path))
                .map_err(|_| "文件URI无效")?
                .to_string();
            lease.session.open(&uri, language, &text).await?;
            lease.session.transport.wait_ready(600).await?;
            sessions.pin(&root, language)?;
            lease.release().await;
            Ok::<(), String>(())
        }
        .await;
        if let Ok(mut workers) = services.workers.lock()
            && let Some(w) = workers.get_mut(&task_key)
            && w.generation == generation
        {
            w.state = if result.is_ok() { "running" } else { "failed" }.into();
            w.message = result.err().unwrap_or_default();
            w.task = None;
        }
    });
    if let Some(w) = state
        .project_services
        .workers
        .lock()
        .map_err(failure)?
        .get_mut(&key)
    {
        w.task = Some(task);
    }
    Ok(Json(
        serde_json::json!({"state":"starting","message":"正在启动语言服务器…","serverType":language.server_type()}),
    ))
}

impl Services {
    pub(super) async fn shutdown(&self) {
        let tasks: Vec<_> = self
            .workers
            .lock()
            .unwrap()
            .drain()
            .filter_map(|(_, w)| w.task)
            .collect();
        for task in tasks {
            task.abort();
            let _ = task.await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_selection_is_project_scoped_and_preserves_unicode() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("抽奖系统");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("target")).unwrap();
        let file = root.join("src/入口.java");
        std::fs::write(&file, "class 入口 {}").unwrap();
        std::fs::write(root.join("target/Generated.java"), "class Generated {}").unwrap();
        std::fs::write(dir.path().join("Other.java"), "class Other {}").unwrap();
        assert_eq!(selected_file(&root, &file).unwrap().name, "src/入口.java");
        assert!(selected_file(&root, &root.join("target/Generated.java")).is_err());
        assert!(selected_file(&root, &dir.path().join("Other.java")).is_err());
        #[cfg(windows)]
        assert_eq!(
            selected_file(
                &root,
                &PathBuf::from(file.to_string_lossy().to_ascii_lowercase())
            )
            .unwrap()
            .name,
            "src/入口.java"
        );
        let canonical = file.canonicalize().unwrap();
        assert_eq!(
            selected_file(&root, &canonical).unwrap().name,
            "src/入口.java"
        );
        let readable = crate::project_catalog::tool_path(&canonical);
        assert!(readable.to_string_lossy().contains("抽奖系统"));
        assert!(!readable.to_string_lossy().starts_with(r"\\?\"));
        assert!(
            url::Url::from_file_path(&readable)
                .unwrap()
                .to_file_path()
                .unwrap()
                .is_file()
        );
    }
    #[tokio::test]
    async fn registration_requires_live_server_selected_directory() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("projects.json");
        std::fs::write(&config, r#"{"schemaVersion":"0.1","projects":[]}"#).unwrap();
        let state = AppState::new(
            Arc::new(FileGraphStore::new(dir.path().join("graphs"))),
            Arc::new(FileScenarioStore::new(dir.path().join("scenes"))),
            Arc::new(FileProjectCatalog::from_file(&config).unwrap()),
            Arc::new(VscodeUriLinkBuilder),
            Arc::new(FileSourcePreviewer::default()),
            Arc::new(FileLayoutStore::new(dir.path().join("layouts"))),
        );
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("origin", "http://127.0.0.1".parse().unwrap());
        headers.insert("host", "127.0.0.1".parse().unwrap());
        assert!(
            register(
                State(state.clone()),
                headers.clone(),
                Json(Register {
                    selection_id: "invented".into(),
                    name: "Test".into()
                })
            )
            .await
            .is_err()
        );
        state.project_services.directories.lock().unwrap().insert(
            "expired".into(),
            (dir.path().into(), Instant::now() - Duration::from_secs(601)),
        );
        assert!(
            register(
                State(state.clone()),
                headers.clone(),
                Json(Register {
                    selection_id: "expired".into(),
                    name: "Test".into()
                })
            )
            .await
            .is_err()
        );
        state
            .project_services
            .directories
            .lock()
            .unwrap()
            .insert("selected".into(), (dir.path().into(), Instant::now()));
        let result = register(
            State(state.clone()),
            headers.clone(),
            Json(Register {
                selection_id: "selected".into(),
                name: "Test".into(),
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(
            state.project_catalog.resolve_root(&result.id).unwrap(),
            dir.path().canonicalize().unwrap()
        );
        assert!(
            register(
                State(state),
                headers,
                Json(Register {
                    selection_id: "selected".into(),
                    name: "Replay".into()
                })
            )
            .await
            .is_err()
        );
    }
}
