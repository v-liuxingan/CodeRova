use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::model::{
    CALL_SITE_EXACT, CALL_SITE_OMITTED_NODES, CALL_SITE_VIRTUAL_NODE, CallGraph,
    SourceLocationStatus, ValidationReport,
};

const NODE_KINDS: &[&str] = &[
    "function",
    "method",
    "closure",
    "trait",
    "struct",
    "module",
    "process",
    "remote-service",
];
const EDGE_KINDS: &[&str] = &[
    "direct",
    "callback",
    "trait-dispatch",
    "spawn",
    "remote",
    "async-boundary",
    "data-flow",
];
const NODE_STATES: &[&str] = &["expanded", "collapsed", "hidden"];

pub fn validate_graph(graph: &CallGraph, source_root: Option<&Path>) -> ValidationReport {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut source_locations = Vec::new();

    if graph.schema_version != "0.2" {
        errors.push(format!(
            "不支持 schemaVersion {:?}，当前仅支持 0.2",
            graph.schema_version
        ));
    }
    if graph.project_id.is_empty()
        || !graph
            .project_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        errors.push("projectId 必须是非空的字母、数字、连字符或下划线组合".to_owned());
    }
    if graph.title.trim().is_empty() {
        errors.push("title 不能为空".to_owned());
    }

    let mut node_ids = HashSet::new();
    for node in &graph.nodes {
        if !node_ids.insert(node.id.as_str()) {
            errors.push(format!("节点 id 重复：{}", node.id));
        }
        if !NODE_KINDS.contains(&node.kind.as_str()) {
            errors.push(format!("节点 {} 的 kind 无效：{}", node.id, node.kind));
        }
        if !NODE_STATES.contains(&node.state.as_str()) {
            errors.push(format!("节点 {} 的 state 无效：{}", node.id, node.state));
        }
        validate_relative_source_path(&node.file, &node.id, &mut errors);
        if node.line == 0 {
            errors.push(format!("节点 {} 的 line 必须大于 0", node.id));
        }
        if let Some(end_line) = node.end_line
            && end_line < node.line
        {
            errors.push(format!("节点 {} 的 endLine 早于 line", node.id));
        }
        if node.role.trim().is_empty() {
            warnings.push(format!("节点 {} 缺少 role", node.id));
        }
        if let Some(root) = source_root {
            source_locations.push(check_source_location(
                root, "node", &node.id, &node.file, node.line,
            ));
        }
    }

    if !node_ids.contains(graph.root.as_str()) {
        errors.push(format!("root 指向不存在的节点：{}", graph.root));
    }

    let mut edge_ids = HashSet::new();
    for edge in &graph.edges {
        if !edge_ids.insert(edge.id.as_str()) {
            errors.push(format!("连线 id 重复：{}", edge.id));
        }
        if !node_ids.contains(edge.from.as_str()) {
            errors.push(format!("连线 {} 的 from 不存在：{}", edge.id, edge.from));
        }
        if !node_ids.contains(edge.to.as_str()) {
            errors.push(format!("连线 {} 的 to 不存在：{}", edge.id, edge.to));
        }
        if !EDGE_KINDS.contains(&edge.kind.as_str()) {
            errors.push(format!("连线 {} 的 kind 无效：{}", edge.id, edge.kind));
        }
        if !(0.0..=1.0).contains(&edge.confidence) {
            errors.push(format!("连线 {} 的 confidence 必须在 0 到 1 之间", edge.id));
        }
        if edge.evidence.trim().is_empty() {
            warnings.push(format!("连线 {} 缺少 evidence", edge.id));
        }
        match edge.call_site_status.as_str() {
            CALL_SITE_EXACT => {
                if edge.file.is_empty() {
                    errors.push(format!("连线 {} 的精确调用位置缺少 file", edge.id));
                } else {
                    validate_relative_source_path(&edge.file, &edge.id, &mut errors);
                }
                if edge.line == 0 {
                    errors.push(format!("连线 {} 的精确调用位置 line 必须大于 0", edge.id));
                }
                if let Some(root) = source_root
                    && let Some((file, line)) = edge.exact_call_site()
                {
                    source_locations
                        .push(check_source_location(root, "edge", &edge.id, file, line));
                }
            }
            CALL_SITE_VIRTUAL_NODE | CALL_SITE_OMITTED_NODES => {
                if !edge.file.is_empty() || edge.line != 0 {
                    errors.push(format!(
                        "连线 {} 的调用位置不可用时不能同时提供 file 或 line",
                        edge.id
                    ));
                }
                if edge.call_site_note.trim().is_empty() {
                    warnings.push(format!("连线 {} 缺少调用位置不可用说明", edge.id));
                }
            }
            status => errors.push(format!(
                "连线 {} 的 callSiteStatus 无效：{}",
                edge.id, status
            )),
        }
    }

    for location in &source_locations {
        if !location.exists {
            errors.push(format!(
                "{} {} 的文件不存在：{}",
                location.target_type, location.id, location.file
            ));
        } else if !location.line_in_range {
            errors.push(format!(
                "{} {} 的行号超出文件范围：{}:{}",
                location.target_type, location.id, location.file, location.line
            ));
        }
    }

    ValidationReport {
        valid: errors.is_empty(),
        errors,
        warnings,
        source_locations,
    }
}

fn validate_relative_source_path(path: &str, id: &str, errors: &mut Vec<String>) {
    let path = Path::new(path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        errors.push(format!("{id} 的 file 必须是源码根目录内的相对路径"));
    }
}

fn check_source_location(
    source_root: &Path,
    target_type: &str,
    id: &str,
    file: &str,
    line: u32,
) -> SourceLocationStatus {
    let path = source_root.join(file);
    let exists = path.is_file();
    let line_in_range = exists
        && fs::read_to_string(&path)
            .map(|content| line as usize <= content.lines().count())
            .unwrap_or(false);
    SourceLocationStatus {
        target_type: target_type.to_owned(),
        id: id.to_owned(),
        file: file.to_owned(),
        line,
        exists,
        line_in_range,
    }
}

pub fn resolve_source_path(source_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let candidate = source_root.join(relative);
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("无法定位源码文件 {}：{error}", candidate.display()))?;
    let canonical_root = source_root
        .canonicalize()
        .map_err(|error| format!("无法定位源码根目录：{error}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("源码路径越过了配置的源码根目录".to_owned());
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CallGraph, GraphEdge, GraphNode};

    fn graph() -> CallGraph {
        CallGraph {
            schema_version: "0.2".into(),
            project_id: "demo".into(),
            title: "test".into(),
            root: "a".into(),
            description: String::new(),
            source_revision: None,
            nodes: vec![
                GraphNode {
                    id: "a".into(),
                    kind: "function".into(),
                    label: "a".into(),
                    crate_name: "demo".into(),
                    module: String::new(),
                    file: "src/main.rs".into(),
                    line: 1,
                    end_line: Some(1),
                    role: "root".into(),
                    description: String::new(),
                    state: "expanded".into(),
                },
                GraphNode {
                    id: "b".into(),
                    kind: "method".into(),
                    label: "b".into(),
                    crate_name: "demo".into(),
                    module: String::new(),
                    file: "src/main.rs".into(),
                    line: 1,
                    end_line: None,
                    role: "leaf".into(),
                    description: String::new(),
                    state: "expanded".into(),
                },
            ],
            edges: vec![GraphEdge {
                id: "a-b".into(),
                from: "a".into(),
                to: "b".into(),
                kind: "direct".into(),
                label: "calls".into(),
                call_site_status: CALL_SITE_EXACT.into(),
                call_site_note: String::new(),
                file: "src/main.rs".into(),
                line: 1,
                description: String::new(),
                evidence: "call expression".into(),
                confidence: 1.0,
            }],
        }
    }

    #[test]
    fn accepts_consistent_graph() {
        let report = validate_graph(&graph(), None);
        assert!(report.valid, "{:?}", report.errors);
    }

    #[test]
    fn rejects_missing_endpoint_and_unsafe_path() {
        let mut graph = graph();
        graph.edges[0].to = "missing".into();
        graph.nodes[0].file = "../secret".into();
        let report = validate_graph(&graph, None);
        assert!(!report.valid);
        assert_eq!(report.errors.len(), 2);
    }

    #[test]
    fn accepts_documented_unavailable_call_site() {
        let mut graph = graph();
        let edge = &mut graph.edges[0];
        edge.call_site_status = CALL_SITE_OMITTED_NODES.into();
        edge.call_site_note = "several adapter nodes are omitted".into();
        edge.file.clear();
        edge.line = 0;

        let report = validate_graph(&graph, None);

        assert!(report.valid, "{:?}", report.errors);
        assert!(report.source_locations.is_empty());
    }

    #[test]
    fn rejects_location_on_virtual_edge() {
        let mut graph = graph();
        graph.edges[0].call_site_status = CALL_SITE_VIRTUAL_NODE.into();

        let report = validate_graph(&graph, None);

        assert!(!report.valid);
        assert_eq!(report.errors.len(), 1);
    }
}
