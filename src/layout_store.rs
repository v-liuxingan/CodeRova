use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const LAYOUT_SCHEMA_VERSION: &str = "0.1";

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
}

impl FileLayoutStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
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
        let path = self.path_for(slug)?;
        fs::create_dir_all(&self.root)
            .map_err(|error| format!("无法创建布局目录 {}：{error}", self.root.display()))?;
        let content = serde_json::to_string_pretty(layout)
            .map_err(|error| format!("无法序列化布局配置：{error}"))?;
        let temporary = self
            .root
            .join(format!(".{slug}.{}.tmp", std::process::id()));
        fs::write(&temporary, format!("{content}\n"))
            .map_err(|error| format!("无法写入临时布局配置 {}：{error}", temporary.display()))?;
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("无法替换布局配置 {}：{error}", path.display()))?;
        }
        fs::rename(&temporary, &path)
            .map_err(|error| format!("无法保存布局配置 {}：{error}", path.display()))
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
}
