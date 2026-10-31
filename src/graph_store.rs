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
    fn delete_archived(&self, slug: &str) -> Result<(), String>;
    fn archived(&self) -> Result<Vec<(String, CallGraph)>, String>;
    fn set_archived(&self, slug: &str, archived: bool) -> Result<(), String>;
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
    fn archived_index(&self) -> Result<BTreeMap<String, PathBuf>, String> {
        let mut paths = Vec::new();
        collect_files(&self.root, "deleted", &mut paths)?;
        let mut index = BTreeMap::new();
        for path in paths {
            let slug = path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or("无效回收站文件名")?
                .to_owned();
            validate_slug(&slug)?;
            if index.insert(slug.clone(), path).is_some() {
                return Err(format!("回收站名称冲突：{slug}"));
            }
        }
        Ok(index)
    }
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
    fn delete_archived(&self, slug: &str) -> Result<(), String> {
        validate_slug(slug)?;
        let _guard = self.operation_lock.lock().map_err(|_| "图谱存储锁已损坏")?;
        let path = self
            .archived_index()?
            .remove(slug)
            .ok_or_else(|| format!("回收站中不存在调用图：{slug}"))?;
        fs::remove_file(path).map_err(|e| format!("无法永久删除图配置：{e}"))
    }
    fn archived(&self) -> Result<Vec<(String, CallGraph)>, String> {
        let _guard = self.operation_lock.lock().map_err(|_| "图谱存储锁已损坏")?;
        self.archived_index()?
            .into_iter()
            .map(|(slug, path)| self.read_indexed_graph(&path).map(|g| (slug, g)))
            .collect()
    }

    fn set_archived(&self, slug: &str, archived: bool) -> Result<(), String> {
        validate_slug(slug)?;
        let _guard = self.operation_lock.lock().map_err(|_| "图谱存储锁已损坏")?;
        let active = self.index()?;
        let deleted = self.archived_index()?;
        let (source, occupied, extension) = if archived {
            (&active, &deleted, "deleted")
        } else {
            (&deleted, &active, "json")
        };
        if occupied.contains_key(slug) {
            return Err(format!("同名调用图已存在，无法覆盖：{slug}"));
        }
        let source = source
            .get(slug)
            .ok_or_else(|| format!("调用图不存在：{slug}"))?;
        let target = source.with_extension(extension);
        if target.exists() {
            return Err("目标文件已存在，无法覆盖".into());
        }
        // Same-directory rename preserves every byte and its original category. No source files or layouts are touched.
        fs::rename(source, target).map_err(|e| format!("无法更新回收站：{e}"))
    }
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
        let mut graph = parse_graph(&original, &source)?;
        graph.category_id = category_id.trim().to_owned();
        graph.category = category.trim().to_owned();

        let target_directory = self.root.join(&graph.category_id);
        if target_directory.exists()
            && !target_directory
                .canonicalize()
                .map_err(|e| e.to_string())?
                .starts_with(self.root.canonicalize().map_err(|e| e.to_string())?)
        {
            return Err("分类目录必须位于图谱根目录内".into());
        }
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
    collect_files(directory, "json", paths)
}

fn collect_files(
    directory: &Path,
    extension: &str,
    paths: &mut Vec<PathBuf>,
) -> Result<(), String> {
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
            collect_files(&entry.path(), extension, paths)?;
        } else if file_type.is_file()
            && entry.path().extension().and_then(|value| value.to_str()) == Some(extension)
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
    let content =
        fs::read(path).map_err(|error| format!("无法读取 {}：{error}", path.display()))?;
    parse_graph(&content, path)
}

fn parse_graph(content: &[u8], path: &Path) -> Result<CallGraph, String> {
    let mut deserializer = serde_json::Deserializer::from_slice(content);
    serde_path_to_error::deserialize(&mut deserializer).map_err(|error| {
        let field_path = match error.path().to_string().as_str() {
            "." => "根对象".to_owned(),
            value => value.to_owned(),
        };
        let source = error.inner();
        let category = match source.classify() {
            serde_json::error::Category::Syntax => "JSON 语法错误",
            serde_json::error::Category::Data => "字段格式错误",
            serde_json::error::Category::Eof => "JSON 内容不完整",
            serde_json::error::Category::Io => "JSON 读取错误",
        };
        let suggestion = parse_error_suggestion(source);
        format!(
            "调用图格式检查失败：{}\n\
             位置：{}（第 {} 行，第 {} 列）\n\
             类型：{}\n\
             原因：{}\n\
             修复建议：{}",
            path.display(),
            field_path,
            source.line(),
            source.column(),
            category,
            source,
            suggestion,
        )
    })
}

fn parse_error_suggestion(error: &serde_json::Error) -> &'static str {
    let message = error.to_string();
    if message.contains("unknown field") {
        "删除未知字段，或改用原因中列出的允许字段。"
    } else if message.contains("missing field") {
        "补充原因中指出的必填字段，并对照 schema/callgraph.schema.json 填写。"
    } else if message.contains("invalid type") {
        "将该字段改为原因中要求的 JSON 类型。"
    } else {
        match error.classify() {
            serde_json::error::Category::Syntax | serde_json::error::Category::Eof => {
                "检查该行附近的逗号、引号和括号是否完整。"
            }
            serde_json::error::Category::Data => {
                "对照 schema/callgraph.schema.json 修正该字段的名称、类型或取值。"
            }
            serde_json::error::Category::Io => "确认文件可读取且内容为 UTF-8 JSON。",
        }
    }
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
    fn graph_format_error_reports_unknown_field_and_repair_hint() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("unknown-field.json");
        fs::write(
            &path,
            br#"{
                "schemaVersion": "0.4",
                "projectId": "codex",
                "title": "Unknown field",
                "root": "root",
                "nodes": [],
                "edges": [],
                "titel": "typo"
            }"#,
        )
        .expect("write invalid graph");

        let error = read_graph_file(&path).expect_err("unknown field should fail");
        assert!(error.contains("调用图格式检查失败"));
        assert!(error.contains("unknown field `titel`"));
        assert!(error.contains("修复建议：删除未知字段"));
        assert!(error.contains("第 8 行"));
    }

    #[test]
    fn graph_format_error_reports_nested_field_path_and_expected_type() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("invalid-type.json");
        fs::write(
            &path,
            br#"{
                "schemaVersion": "0.4",
                "projectId": "codex",
                "title": "Invalid type",
                "root": "root",
                "nodes": [{
                    "id": "root",
                    "kind": "function",
                    "label": "root",
                    "file": "src/main.rs",
                    "line": "twelve",
                    "role": "entry"
                }],
                "edges": []
            }"#,
        )
        .expect("write invalid graph");

        let error = read_graph_file(&path).expect_err("invalid type should fail");
        assert!(error.contains("位置：nodes[0].line"));
        assert!(error.contains("invalid type"));
        assert!(error.contains("修复建议：将该字段改为"));
    }

    #[test]
    fn graph_format_error_reports_missing_required_field() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("missing-field.json");
        fs::write(
            &path,
            br#"{
                "schemaVersion": "0.4",
                "projectId": "codex",
                "root": "root",
                "nodes": [],
                "edges": []
            }"#,
        )
        .expect("write invalid graph");

        let error = read_graph_file(&path).expect_err("missing field should fail");
        assert!(error.contains("missing field `title`"));
        assert!(error.contains("修复建议：补充原因中指出的必填字段"));
    }

    #[test]
    fn graph_format_error_reports_json_syntax_location() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("invalid-syntax.json");
        fs::write(
            &path,
            br#"{
                "schemaVersion": "0.4",
                "projectId": "codex",
                "title": "Invalid syntax",
                "root": "root",
                "nodes": [],
                "edges": [],
            }"#,
        )
        .expect("write invalid graph");

        let error = read_graph_file(&path).expect_err("invalid syntax should fail");
        assert!(error.contains("JSON 语法错误"));
        assert!(error.contains("修复建议：检查该行附近的逗号"));
        assert!(error.contains("第 8 行"));
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

    #[test]
    fn trash_preserves_bytes_restores_and_deletes_only_archived_files() {
        let directory = tempfile::tempdir().unwrap();
        write_graph(directory.path(), "tools/example.json", "tools", "Example");
        let path = directory.path().join("tools/example.json");
        let original = fs::read(&path).unwrap();
        let store = FileGraphStore::new(directory.path().to_owned());
        assert!(store.delete_archived("example").is_err());
        assert!(store.set_archived("../example", true).is_err());
        store.set_archived("example", true).unwrap();
        assert!(!path.exists());
        assert!(store.list().unwrap().is_empty());
        assert_eq!(store.archived().unwrap().len(), 1);
        assert_eq!(fs::read(path.with_extension("deleted")).unwrap(), original);
        store.set_archived("example", false).unwrap();
        assert_eq!(fs::read(&path).unwrap(), original);
        store.set_archived("example", true).unwrap();
        write_graph(directory.path(), "other/example.json", "other", "Conflict");
        assert!(store.set_archived("example", false).is_err());
        assert_eq!(fs::read(path.with_extension("deleted")).unwrap(), original);
        store.delete_archived("example").unwrap();
        assert!(!path.with_extension("deleted").exists());
        assert_eq!(store.load("example").unwrap().title, "Conflict");
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
