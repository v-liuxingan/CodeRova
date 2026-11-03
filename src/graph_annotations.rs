//! Atomic graph publication with independent, immutable editorial snapshots.
use crate::model::{CallGraph, GraphPhase};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NodeNotes {
    description: String,
    role: String,
    phase_id: String,
    state: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Notes {
    description: String,
    phases: Vec<GraphPhase>,
    nodes: BTreeMap<String, NodeNotes>,
    edges: BTreeMap<String, String>,
}
fn directory(path: &Path) -> Result<PathBuf, String> {
    let slug = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("无效图文件名")?;
    Ok(path
        .parent()
        .ok_or("图文件缺少目录")?
        .join(format!(".annotations-{slug}")))
}
fn checked(path: &Path, reference: &str) -> Result<PathBuf, String> {
    if reference.is_empty() || !reference.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("说明引用不合法".into());
    }
    let dir = directory(path)?;
    let parent = path
        .parent()
        .ok_or("图文件缺少目录")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let canonical = dir
        .canonicalize()
        .map_err(|e| format!("说明目录不可用：{e}"))?;
    if !canonical.starts_with(&parent) {
        return Err("说明目录超出图文件目录".into());
    }
    let file = dir.join(format!("{reference}.json"));
    if file.exists()
        && !file
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(canonical)
    {
        return Err("说明文件超出目录".into());
    }
    Ok(file)
}
pub(crate) fn encode(path: &Path, graph: &CallGraph) -> Result<Vec<u8>, String> {
    let mut core = graph.clone();
    let notes = Notes {
        description: std::mem::take(&mut core.description),
        phases: std::mem::take(&mut core.phases),
        nodes: core
            .nodes
            .iter_mut()
            .map(|n| {
                (
                    n.id.clone(),
                    NodeNotes {
                        description: std::mem::take(&mut n.description),
                        role: std::mem::take(&mut n.role),
                        phase_id: std::mem::take(&mut n.phase_id),
                        state: std::mem::replace(&mut n.state, "expanded".into()),
                    },
                )
            })
            .collect(),
        edges: core
            .edges
            .iter_mut()
            .map(|e| (e.id.clone(), std::mem::take(&mut e.description)))
            .collect(),
    };
    fs::create_dir_all(directory(path)?).map_err(|e| e.to_string())?;
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let reference = format!(
        "{time:x}-{:x}-{:x}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    );
    let snapshot = checked(path, &reference)?;
    crate::graph_store::write_atomic(
        &snapshot,
        &serde_json::to_vec_pretty(&notes).map_err(|e| e.to_string())?,
    )?;
    let mut value = serde_json::to_value(core).map_err(|e| e.to_string())?;
    value["_annotations"] = reference.into();
    serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())
}
pub(crate) fn decode(mut value: serde_json::Value, path: &Path) -> Result<CallGraph, String> {
    let reference = value
        .as_object_mut()
        .and_then(|v| v.remove("_annotations"))
        .and_then(|v| v.as_str().map(str::to_owned))
        .ok_or("无效说明引用")?;
    let mut graph: CallGraph = serde_json::from_value(value).map_err(|e| e.to_string())?;
    let notes: Notes = serde_json::from_slice(
        &fs::read(checked(path, &reference)?).map_err(|e| format!("无法读取说明快照：{e}"))?,
    )
    .map_err(|e| e.to_string())?;
    graph.description = notes.description;
    graph.phases = notes.phases;
    for n in &mut graph.nodes {
        if let Some(a) = notes.nodes.get(&n.id) {
            n.description.clone_from(&a.description);
            n.role.clone_from(&a.role);
            n.phase_id.clone_from(&a.phase_id);
            n.state.clone_from(&a.state);
        }
    }
    for e in &mut graph.edges {
        if let Some(a) = notes.edges.get(&e.id) {
            e.description.clone_from(a);
        }
    }
    Ok(graph)
}
pub(crate) fn copy_for_move(source: &Path, target: &Path) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(source).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if let Some(reference) = value.get("_annotations").and_then(|v| v.as_str()) {
        let bytes = fs::read(checked(source, reference)?).map_err(|e| e.to_string())?;
        fs::create_dir_all(directory(target)?).map_err(|e| e.to_string())?;
        crate::graph_store::write_atomic(&checked(target, reference)?, &bytes)?;
    }
    Ok(())
}
