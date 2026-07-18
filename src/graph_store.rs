use std::fs;
use std::path::{Path, PathBuf};

use crate::model::CallGraph;

/// Storage boundary for callgraph documents.
///
/// A database, remote catalog, or generated graph source can implement this
/// trait without changing the HTTP or rendering layers.
pub trait GraphStore: Send + Sync {
    fn list(&self) -> Result<Vec<(String, CallGraph)>, String>;
    fn load(&self, slug: &str) -> Result<CallGraph, String>;
}

#[derive(Debug, Clone)]
pub struct FileGraphStore {
    root: PathBuf,
}

impl FileGraphStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
}

impl GraphStore for FileGraphStore {
    fn list(&self) -> Result<Vec<(String, CallGraph)>, String> {
        let entries = fs::read_dir(&self.root)
            .map_err(|error| format!("无法读取调用图目录 {}：{error}", self.root.display()))?;
        let mut graphs = Vec::new();
        for entry in entries {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Some(slug) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            graphs.push((slug.to_owned(), read_graph_file(&path)?));
        }
        Ok(graphs)
    }

    fn load(&self, slug: &str) -> Result<CallGraph, String> {
        validate_slug(slug)?;
        let path = self.root.join(format!("{slug}.json"));
        if !path.is_file() {
            return Err(format!("调用图不存在：{slug}"));
        }
        read_graph_file(&path)
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

    #[test]
    fn rejects_unsafe_graph_slug() {
        let store = FileGraphStore::new(PathBuf::from("graphs"));
        let error = store
            .load("../secret")
            .expect_err("unsafe slug should be rejected");
        assert_eq!(error, "调用图名称不合法");
    }
}
