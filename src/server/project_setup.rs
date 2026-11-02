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
        serde_json::json!({"selectionId":id,"name":root.file_name().unwrap_or_default().to_string_lossy(),"root":root}),
    ))
}
#[cfg(windows)]
async fn choose_directory() -> Result<Option<PathBuf>, String> {
    let output=tokio::process::Command::new("powershell.exe").args(["-NoProfile","-STA","-Command",
        "Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $picker=New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description='选择源码项目目录'; $picker.ShowNewFolderButton=$false; $owner=New-Object System.Windows.Forms.Form; $owner.TopMost=$true; $owner.ShowInTaskbar=$false; $owner.Opacity=0; try{$owner.Show();$owner.Activate();if($picker.ShowDialog($owner) -eq 'OK'){[Console]::Write($picker.SelectedPath)}}finally{$picker.Dispose();$owner.Dispose()}"])
        .creation_flags(0x08000000).kill_on_drop(true).output().await.map_err(|e|e.to_string())?;
    if !output.status.success() {
        return Err("无法打开目录选择器，请检查本机 PowerShell".into());
    }
    let value = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    Ok((!value.trim().is_empty()).then(|| PathBuf::from(value.trim())))
}
#[cfg(not(windows))]
async fn choose_directory() -> Result<Option<PathBuf>, String> {
    Err("本机目录选择器目前支持Windows；其他系统请通过项目配置接入".into())
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
        return Ok(Json(serde_json::json!({"state":phase,"message":message})));
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
            serde_json::json!({"state":"failed","message":message}),
        ));
    }
    Ok(Json(serde_json::json!({"state":phase,"message":""})))
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
        return Ok(Json(serde_json::json!({"state":"stopped","message":""})));
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
                serde_json::json!({"state":"starting","message":"正在启动语言服务器…"}),
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
            let uri = url::Url::from_file_path(path)
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
        serde_json::json!({"state":"starting","message":"正在启动语言服务器…"}),
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
