use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::model::CallGraph;

pub const DEFAULT_CATEGORY_ID: &str = "uncategorized";
pub const DEFAULT_CATEGORY: &str = "未分类";
static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Storage boundary for callgraph documents.
///
/// A database, remote catalog, or generated graph source can implement this
/// trait without changing the HTTP or rendering layers.
pub trait GraphStore: Send + Sync {
    fn list(&self) -> Result<Vec<(String, CallGraph)>, String>;
    fn load(&self, slug: &str) -> Result<CallGraph, String>;
    fn update_category(
        &self,
        slug: &str,
        category_id: &str,
        category: &str,
    ) -> Result<CallGraph, String>;
}

#[derive(Debug, Clone)]
pub struct FileGraphStore {
    root: PathBuf,
    operation_lock: Arc<Mutex<()>>,
}

impl FileGraphStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            operation_lock: Arc::new(Mutex::new(())),
        }
    }

    fn index(&self) -> Result<BTreeMap<String, PathBuf>, String> {
        let mut paths = Vec::new();
        collect_graph_files(&self.root, &mut paths)?;
        paths.sort();

        let mut index = BTreeMap::new();
        for path in paths {
            let slug = path
                .file_stem()
                .and_then(|value| value.to_str())
                .ok_or_else(|| format!("调用图文件名不是有效 UTF-8：{}", path.display()))?;
            validate_slug(slug)?;
            if let Some(previous) = index.insert(slug.to_owned(), path.clone()) {
                return Err(format!(
                    "调用图 slug 重复：{slug}（{} 与 {}）",
                    previous.display(),
                    path.display()
                ));
            }
        }
        Ok(index)
    }

    fn read_indexed_graph(&self, path: &Path) -> Result<CallGraph, String> {
        let mut graph = read_graph_file(path)?;
        warn_on_category_mismatch(&self.root, path, &graph);
        normalize_graph_category(&mut graph);
        Ok(graph)
    }
}

impl GraphStore for FileGraphStore {
    fn list(&self) -> Result<Vec<(String, CallGraph)>, String> {
        let _operation_guard = self
            .operation_lock
            .lock()
            .map_err(|_| "图谱存储锁已损坏".to_owned())?;
        self.index()?
            .into_iter()
            .map(|(slug, path)| self.read_indexed_graph(&path).map(|graph| (slug, graph)))
            .collect()
    }

    fn load(&self, slug: &str) -> Result<CallGraph, String> {
        validate_slug(slug)?;
        let _operation_guard = self
            .operation_lock
            .lock()
            .map_err(|_| "图谱存储锁已损坏".to_owned())?;
        let path = self
            .index()?
            .remove(slug)
            .ok_or_else(|| format!("调用图不存在：{slug}"))?;
        self.read_indexed_graph(&path)
    }

    fn update_category(
        &self,
        slug: &str,
        category_id: &str,
        category: &str,
    ) -> Result<CallGraph, String> {
        validate_slug(slug)?;
        validate_category(category_id, category)?;
        let _operation_guard = self
            .operation_lock
            .lock()
            .map_err(|_| "图谱存储锁已损坏".to_owned())?;
        let source = self
            .index()?
            .remove(slug)
            .ok_or_else(|| format!("调用图不存在：{slug}"))?;
        let original =
            fs::read(&source).map_err(|error| format!("无法读取 {}：{error}", source.display()))?;
        let mut graph: CallGraph = serde_json::from_slice(&original)
            .map_err(|error| format!("无法解析 {}：{error}", source.display()))?;
        graph.category_id = category_id.trim().to_owned();
        graph.category = category.trim().to_owned();

        let target_directory = self.root.join(&graph.category_id);
        let target = target_directory.join(
            source
                .file_name()
                .ok_or_else(|| format!("调用图路径缺少文件名：{}", source.display()))?,
        );
        if source != target && target.exists() {
            return Err(format!("目标分类中已存在同名调用图：{}", target.display()));
        }
        let content = serde_json::to_vec_pretty(&graph)
            .map_err(|error| format!("无法序列化调用图：{error}"))?;
        if source != target {
            fs::create_dir_all(&target_directory).map_err(|error| {
                format!(
                    "无法创建图谱分类目录 {}：{error}",
                    target_directory.display()
                )
            })?;
        }
        write_atomic(&source, &content)?;

        if source != target {
            if let Err(error) = fs::rename(&source, &target) {
                let rollback = write_atomic(&source, &original);
                return Err(match rollback {
                    Ok(()) => format!("无法移动调用图到 {}：{error}", target.display()),
                    Err(rollback_error) => format!(
                        "无法移动调用图到 {}：{error}；回滚也失败：{rollback_error}",
                        target.display()
                    ),
                });
            }
            if let Some(previous_directory) = source.parent()
                && previous_directory != self.root
            {
                let _ = fs::remove_dir(previous_directory);
            }
        }
        Ok(graph)
    }
}

fn normalize_graph_category(graph: &mut CallGraph) {
    if graph.category_id.trim().is_empty() {
        graph.category_id = DEFAULT_CATEGORY_ID.to_owned();
        graph.category = DEFAULT_CATEGORY.to_owned();
    } else if graph.category.trim().is_empty() {
        graph.category = graph.category_id.clone();
    }
}

fn validate_category(category_id: &str, category: &str) -> Result<(), String> {
    let category_id = category_id.trim();
    let category = category.trim();
    if category_id.is_empty()
        || !category_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("categoryId 必须是字母、数字、连字符或下划线组合".to_owned());
    }
    if category.is_empty() || category.chars().count() > 40 {
        return Err("分类名称不能为空且不能超过 40 个字符".to_owned());
    }
    Ok(())
}

fn write_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("图谱路径缺少父目录：{}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("无法创建图谱目录 {}：{error}", parent.display()))?;
    let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(
        ".{}.{}.{sequence}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("graph"),
        std::process::id()
    ));
    let mut terminated = content.to_vec();
    if !terminated.ends_with(b"\n") {
        terminated.push(b'\n');
    }
    fs::write(&temporary, terminated)
        .map_err(|error| format!("无法写入临时调用图 {}：{error}", temporary.display()))?;
    if let Err(error) = replace_file(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("无法保存调用图 {}：{error}", path.display()));
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(temporary: &Path, path: &Path) -> std::io::Result<()> {
    fs::rename(temporary, path)
}

#[cfg(windows)]
fn replace_file(temporary: &Path, path: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let temporary = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // SAFETY: Both arguments are valid null-terminated UTF-16 strings for the call.
    let result = unsafe {
        MoveFileExW(
            temporary.as_ptr(),
            path.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn collect_graph_files(directory: &Path, paths: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("无法读取调用图目录 {}：{error}", directory.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "无法读取调用图目录项类型 {}：{error}",
                entry.path().display()
            )
        })?;
        if file_type.is_dir() {
            collect_graph_files(&entry.path(), paths)?;
        } else if file_type.is_file()
            && entry.path().extension().and_then(|value| value.to_str()) == Some("json")
        {
            paths.push(entry.path());
        }
    }
    Ok(())
}

fn warn_on_category_mismatch(root: &Path, path: &Path, graph: &CallGraph) {
    let Ok(relative) = path.strip_prefix(root) else {
        return;
    };
    let mut components = relative.components();
    let Some(category_directory) = components
        .next()
        .and_then(|component| component.as_os_str().to_str())
    else {
        return;
    };
    if components.next().is_none() {
        if !graph.category_id.is_empty() {
            tracing::warn!(
                graph = %path.display(),
                category_id = %graph.category_id,
                "图谱声明了 categoryId，但文件仍位于 graphs 根目录"
            );
        }
        return;
    }
    if graph.category_id != category_directory {
        tracing::warn!(
            graph = %path.display(),
            category_id = %graph.category_id,
            directory = %category_directory,
            "图谱 categoryId 与物理分类目录不一致"
        );
    }
}

pub fn read_graph_file(path: &Path) -> Result<CallGraph, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("无法读取 {}：{error}", path.display()))?;
    serde_json::from_str(&content).map_err(|error| format!("无法解析 {}：{error}", path.display()))
}

fn validate_slug(slug: &str) -> Result<(), String> {
    if slug.is_empty()
        || !slug
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("调用图名称不合法".to_owned());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_unsafe_graph_slug() {
        let store = FileGraphStore::new(PathBuf::from("graphs"));
        let error = store
            .load("../secret")
            .expect_err("unsafe slug should be rejected");
        assert_eq!(error, "调用图名称不合法");
    }

    #[test]
    fn recursively_lists_and_loads_categorized_graphs() {
        let directory = tempfile::tempdir().expect("temp dir");
        write_graph(directory.path(), "tools/shell.json", "tools", "Shell");
        write_graph(directory.path(), "session/turn.json", "session", "Turn");
        let store = FileGraphStore::new(directory.path().to_owned());

        let listed = store.list().expect("recursive list");
        assert_eq!(
            listed
                .iter()
                .map(|(slug, graph)| (slug.as_str(), graph.category_id.as_str()))
                .collect::<Vec<_>>(),
            vec![("shell", "tools"), ("turn", "session")]
        );
        assert_eq!(store.load("turn").expect("nested load").title, "Turn");
    }

    #[test]
    fn rejects_duplicate_slugs_across_categories() {
        let directory = tempfile::tempdir().expect("temp dir");
        write_graph(directory.path(), "tools/shared.json", "tools", "Tool");
        write_graph(
            directory.path(),
            "session/shared.json",
            "session",
            "Session",
        );
        let store = FileGraphStore::new(directory.path().to_owned());

        let error = store.list().expect_err("duplicate slug");
        assert!(error.contains("调用图 slug 重复：shared"));
    }

    #[test]
    fn missing_category_uses_uncategorized_defaults() {
        let directory = tempfile::tempdir().expect("temp dir");
        write_graph(directory.path(), "legacy.json", "", "Legacy");
        let store = FileGraphStore::new(directory.path().to_owned());

        let graph = store.load("legacy").expect("load legacy");
        assert_eq!(graph.category_id, DEFAULT_CATEGORY_ID);
        assert_eq!(graph.category, DEFAULT_CATEGORY);
    }

    #[test]
    fn updates_category_metadata_and_moves_graph_without_changing_slug() {
        let directory = tempfile::tempdir().expect("temp dir");
        write_graph(directory.path(), "legacy.json", "", "Legacy");
        let store = FileGraphStore::new(directory.path().to_owned());

        let graph = store
            .update_category("legacy", "tools", "工具执行")
            .expect("update category");
        assert_eq!(graph.category_id, "tools");
        assert_eq!(graph.category, "工具执行");
        assert!(!directory.path().join("legacy.json").exists());
        assert!(directory.path().join("tools/legacy.json").is_file());
        assert_eq!(store.load("legacy").expect("load moved").title, "Legacy");
    }

    #[test]
    fn concurrent_category_updates_leave_one_complete_graph_file() {
        const WRITERS: usize = 8;
        let directory = tempfile::tempdir().expect("temp dir");
        write_graph(directory.path(), "legacy.json", "", "Legacy");
        let store = Arc::new(FileGraphStore::new(directory.path().to_owned()));
        let handles = (0..WRITERS)
            .map(|writer| {
                let store = Arc::clone(&store);
                std::thread::spawn(move || {
                    let category_id = if writer % 2 == 0 { "tools" } else { "session" };
                    store.update_category("legacy", category_id, "并发分类")
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            handle.join().expect("writer").expect("category update");
        }
        let graph = store.load("legacy").expect("complete graph");
        assert!(matches!(graph.category_id.as_str(), "tools" | "session"));
        assert_eq!(store.list().expect("list").len(), 1);
        let temporary_files = collect_all_files(directory.path())
            .into_iter()
            .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("tmp"))
            .count();
        assert_eq!(temporary_files, 0);
    }

    fn write_graph(root: &Path, relative: &str, category_id: &str, title: &str) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().expect("parent")).expect("create category");
        let graph = json!({
            "schemaVersion": "0.2",
            "projectId": "codex",
            "categoryId": category_id,
            "category": "测试",
            "title": title,
            "root": "root",
            "nodes": [],
            "edges": []
        });
        fs::write(path, serde_json::to_vec(&graph).expect("serialize graph")).expect("write graph");
    }

    fn collect_all_files(root: &Path) -> Vec<PathBuf> {
        let mut files = Vec::new();
        for entry in fs::read_dir(root).expect("read directory") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                files.extend(collect_all_files(&path));
            } else {
                files.push(path);
            }
        }
        files
    }
}
