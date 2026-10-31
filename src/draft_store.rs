use crate::{graph_store::GraphStore, model::CallGraph};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct DraftState {
    baseline: CallGraph,
    current: CallGraph,
    dirty: bool,
    last_access: Instant,
}

pub struct DraftStore {
    pub slug: String,
    pub collection: std::sync::atomic::AtomicBool,
    pub operation: tokio::sync::Mutex<()>,
    original: Arc<dyn GraphStore>,
    graphs: Mutex<DraftState>,
}
impl DraftStore {
    pub fn new(slug: String, original: Arc<dyn GraphStore>) -> Result<Self, String> {
        let graph = original.load(&slug)?;
        Ok(Self {
            slug,
            collection: std::sync::atomic::AtomicBool::new(false),
            original,
            operation: tokio::sync::Mutex::new(()),
            graphs: Mutex::new(DraftState {
                baseline: graph.clone(),
                current: graph,
                dirty: false,
                last_access: Instant::now(),
            }),
        })
    }
    pub fn expired_clean(&self, idle: Duration) -> bool {
        self.graphs.lock().is_ok_and(|state| {
            (!state.dirty && state.last_access.elapsed() >= idle)
                || (self.collection.load(std::sync::atomic::Ordering::Relaxed)
                    && state.last_access.elapsed() >= Duration::from_secs(30 * 60))
        })
    }
    pub fn snapshot(&self) -> Result<(CallGraph, bool), String> {
        let mut pair = self.graphs.lock().map_err(|e| e.to_string())?;
        pair.last_access = Instant::now();
        Ok((pair.current.clone(), pair.dirty))
    }
    pub fn changes(&self) -> Result<serde_json::Value, String> {
        let pair = self.graphs.lock().map_err(|e| e.to_string())?;
        let old_nodes: std::collections::HashSet<_> =
            pair.baseline.nodes.iter().map(|n| &n.id).collect();
        let new_nodes: std::collections::HashSet<_> =
            pair.current.nodes.iter().map(|n| &n.id).collect();
        let old_edges: std::collections::HashSet<_> =
            pair.baseline.edges.iter().map(|e| &e.id).collect();
        let new_edges: std::collections::HashSet<_> =
            pair.current.edges.iter().map(|e| &e.id).collect();
        Ok(
            serde_json::json!({"addedNodes":new_nodes.difference(&old_nodes).count(),"removedNodes":old_nodes.difference(&new_nodes).count(),"addedEdges":new_edges.difference(&old_edges).count(),"removedEdges":old_edges.difference(&new_edges).count()}),
        )
    }
    pub fn save(&self) -> Result<(), String> {
        let mut pair = self.graphs.lock().map_err(|e| e.to_string())?;
        self.original
            .checkpoint(&self.slug, &pair.baseline, &pair.current)?;
        pair.baseline = pair.current.clone();
        pair.dirty = false;
        pair.last_access = Instant::now();
        Ok(())
    }
}
impl GraphStore for DraftStore {
    fn load(&self, slug: &str) -> Result<CallGraph, String> {
        if slug != self.slug {
            return self.original.load(slug);
        }
        Ok(self.snapshot()?.0)
    }
    fn checkpoint(&self, slug: &str, before: &CallGraph, after: &CallGraph) -> Result<(), String> {
        if slug != self.slug {
            return Err("草稿不能修改其他图".into());
        }
        let mut pair = self.graphs.lock().map_err(|e| e.to_string())?;
        if serde_json::to_value(&pair.current).map_err(|e| e.to_string())?
            != serde_json::to_value(before).map_err(|e| e.to_string())?
        {
            return Err("草稿已变化，请重新加载".into());
        }
        pair.dirty = serde_json::to_value(&pair.baseline).map_err(|e| e.to_string())?
            != serde_json::to_value(after).map_err(|e| e.to_string())?;
        pair.current = after.clone();
        pair.last_access = Instant::now();
        Ok(())
    }
    fn list(&self) -> Result<Vec<(String, CallGraph)>, String> {
        self.original.list()
    }
    fn archived(&self) -> Result<Vec<(String, CallGraph)>, String> {
        self.original.archived()
    }
    fn delete_archived(&self, _: &str) -> Result<(), String> {
        Err("草稿不支持目录操作".into())
    }
    fn set_archived(&self, _: &str, _: bool) -> Result<(), String> {
        Err("草稿不支持目录操作".into())
    }
    fn update_category(&self, _: &str, _: &str, _: &str) -> Result<CallGraph, String> {
        Err("请先保存草稿再调整分类".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph_store::FileGraphStore;
    #[test]
    fn edits_are_isolated_until_explicit_save_and_conflicts_preserve_draft() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("graph.json"), r#"{"schemaVersion":"0.4","projectId":"p","title":"original","root":"r","nodes":[],"edges":[]}"#).unwrap();
        let store: Arc<dyn GraphStore> = Arc::new(FileGraphStore::new(dir.path().into()));
        let first = DraftStore::new("graph".into(), store.clone()).unwrap();
        let second = DraftStore::new("graph".into(), store.clone()).unwrap();
        let original = first.load("graph").unwrap();
        let mut edited = original.clone();
        edited.title = "first".into();
        first.checkpoint("graph", &original, &edited).unwrap();
        assert!(first.snapshot().unwrap().1);
        assert!(!first.expired_clean(Duration::ZERO));
        assert_eq!(store.load("graph").unwrap().title, "original");
        assert_eq!(second.load("graph").unwrap().title, "original");
        first.save().unwrap();
        assert_eq!(store.load("graph").unwrap().title, "first");
        assert!(!first.snapshot().unwrap().1);
        assert!(first.expired_clean(Duration::ZERO));
        edited.title = "second".into();
        second.checkpoint("graph", &original, &edited).unwrap();
        assert!(second.save().is_err());
        assert_eq!(second.load("graph").unwrap().title, "second");
        assert_eq!(store.load("graph").unwrap().title, "first");
        assert!(first.checkpoint("other", &original, &edited).is_err());
        second.graphs.lock().unwrap().last_access = Instant::now() - Duration::from_secs(31 * 60);
        assert!(!second.expired_clean(Duration::from_secs(15 * 60)));
        second
            .collection
            .store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(second.expired_clean(Duration::from_secs(15 * 60)));
    }
}
