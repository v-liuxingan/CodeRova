use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

pub const LAYOUT_SCHEMA_VERSION: &str = "0.1";
static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphLayout {
    pub schema_version: String,
    pub graph: String,
    #[serde(default)]
    pub positions: BTreeMap<String, BTreeMap<String, NodePosition>>,
}

impl GraphLayout {
    pub fn empty(graph: impl Into<String>) -> Self {
        Self {
            schema_version: LAYOUT_SCHEMA_VERSION.to_owned(),
            graph: graph.into(),
            positions: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
}

pub trait LayoutStore: Send + Sync {
    fn load(&self, slug: &str) -> Result<Option<GraphLayout>, String>;
    fn save(&self, slug: &str, layout: &GraphLayout) -> Result<(), String>;
}

#[derive(Debug, Clone)]
pub struct FileLayoutStore {
    root: PathBuf,
    write_lock: Arc<Mutex<()>>,
}

impl FileLayoutStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            write_lock: Arc::new(Mutex::new(())),
        }
    }

    fn path_for(&self, slug: &str) -> Result<PathBuf, String> {
        validate_slug(slug)?;
        Ok(self.root.join(format!("{slug}.layout.json")))
    }
}

impl LayoutStore for FileLayoutStore {
    fn load(&self, slug: &str) -> Result<Option<GraphLayout>, String> {
        let path = self.path_for(slug)?;
        if !path.is_file() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)
            .map_err(|error| format!("无法读取 {}：{error}", path.display()))?;
        let layout = serde_json::from_str(&content)
            .map_err(|error| format!("无法解析 {}：{error}", path.display()))?;
        Ok(Some(layout))
    }

    fn save(&self, slug: &str, layout: &GraphLayout) -> Result<(), String> {
        let _write_guard = self
            .write_lock
            .lock()
            .map_err(|_| "布局写入锁已损坏".to_owned())?;
        let path = self.path_for(slug)?;
        fs::create_dir_all(&self.root)
            .map_err(|error| format!("无法创建布局目录 {}：{error}", self.root.display()))?;
        let content = serde_json::to_string_pretty(layout)
            .map_err(|error| format!("无法序列化布局配置：{error}"))?;
        let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temporary = self
            .root
            .join(format!(".{slug}.{}.{sequence}.tmp", std::process::id()));
        fs::write(&temporary, format!("{content}\n"))
            .map_err(|error| format!("无法写入临时布局配置 {}：{error}", temporary.display()))?;
        if let Err(error) = replace_file(&temporary, &path) {
            let _ = fs::remove_file(&temporary);
            return Err(format!("无法保存布局配置 {}：{error}", path.display()));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(temporary: &std::path::Path, path: &std::path::Path) -> std::io::Result<()> {
    fs::rename(temporary, path)
}

#[cfg(windows)]
fn replace_file(temporary: &std::path::Path, path: &std::path::Path) -> std::io::Result<()> {
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
    // SAFETY: Both arguments are valid, null-terminated UTF-16 strings for the
    // duration of the call. MoveFileExW does not retain either pointer.
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
    use std::sync::{Arc, Barrier};

    use super::*;

    #[test]
    fn saves_and_loads_graph_layout() {
        let directory = tempfile::tempdir().expect("temp dir");
        let store = FileLayoutStore::new(directory.path().to_owned());
        let mut layout = GraphLayout::empty("demo");
        layout
            .positions
            .entry("vertical".into())
            .or_default()
            .insert("node.a".into(), NodePosition { x: 12.5, y: 42.0 });

        store.save("demo", &layout).expect("save");
        let loaded = store.load("demo").expect("load").expect("layout");

        assert_eq!(loaded, layout);
        assert!(directory.path().join("demo.layout.json").is_file());
    }

    #[test]
    fn rejects_unsafe_slug() {
        let store = FileLayoutStore::new(PathBuf::from("layouts"));
        assert_eq!(
            store.load("../secret").expect_err("unsafe"),
            "调用图名称不合法"
        );
    }

    #[test]
    fn concurrent_saves_keep_a_complete_layout_file() {
        const WRITERS: usize = 16;

        let directory = tempfile::tempdir().expect("temp dir");
        let store = Arc::new(FileLayoutStore::new(directory.path().to_owned()));
        let barrier = Arc::new(Barrier::new(WRITERS));
        let handles = (0..WRITERS)
            .map(|writer| {
                let store = Arc::clone(&store);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    let mut layout = GraphLayout::empty("demo");
                    layout
                        .positions
                        .entry("vertical".into())
                        .or_default()
                        .insert(
                            "node.a".into(),
                            NodePosition {
                                x: writer as f64,
                                y: writer as f64,
                            },
                        );
                    barrier.wait();
                    store.save("demo", &layout)
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            handle.join().expect("writer thread").expect("save");
        }

        let loaded = store.load("demo").expect("load").expect("layout");
        assert_eq!(loaded.graph, "demo");
        assert_eq!(loaded.positions["vertical"].len(), 1);
        let temporary_files = fs::read_dir(directory.path())
            .expect("layout dir")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(temporary_files, 0);
    }
}
