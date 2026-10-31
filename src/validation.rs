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
    "static-call",
    "direct",
    "callback",
    "trait-dispatch",
    "spawn",
    "remote",
    "async-boundary",
    "data-flow",
];
const FLOW_KINDS: &[&str] = &[
    "normal",
    "branch",
    "fallback",
    "merge",
    "loop-back",
    "loop-exit",
];
const NODE_STATES: &[&str] = &["expanded", "collapsed", "hidden"];

pub fn validate_graph(graph: &CallGraph, source_root: Option<&Path>) -> ValidationReport {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut source_locations = Vec::new();

    if !matches!(graph.schema_version.as_str(), "0.2" | "0.3" | "0.4") {
        errors.push(format!(
            "不支持 schemaVersion {:?}，当前支持 0.2、0.3 和 0.4",
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
    if !graph.category_id.is_empty()
        && !graph
            .category_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        errors.push("categoryId 必须是字母、数字、连字符或下划线组合".to_owned());
    }
    if graph.category.chars().count() > 40 {
        errors.push("category 不能超过 40 个字符".to_owned());
    }
    if !graph.category_id.is_empty() && graph.category.trim().is_empty() {
        warnings.push("已配置 categoryId，但缺少面向用户的 category 名称".to_owned());
    }

    let mut phase_ids = HashSet::new();
    let mut phase_orders = HashSet::new();
    for phase in &graph.phases {
        if phase.id.is_empty()
            || !phase.id.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
            })
        {
            errors.push(format!("阶段 id 无效：{}", phase.id));
        } else if !phase_ids.insert(phase.id.as_str()) {
            errors.push(format!("阶段 id 重复：{}", phase.id));
        }
        if phase.title.trim().is_empty() {
            errors.push(format!("阶段 {} 的 title 不能为空", phase.id));
        }
        if phase.order == 0 {
            errors.push(format!("阶段 {} 的 order 必须大于 0", phase.id));
        } else if !phase_orders.insert(phase.order) {
            errors.push(format!("阶段 order 重复：{}", phase.order));
        }
    }

    let mut node_ids = HashSet::new();
    let mut used_phase_ids = HashSet::new();
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
        if !node.phase_id.is_empty() {
            if !phase_ids.contains(node.phase_id.as_str()) {
                errors.push(format!(
                    "节点 {} 的 phaseId 不存在：{}",
                    node.id, node.phase_id
                ));
            } else {
                used_phase_ids.insert(node.phase_id.as_str());
            }
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
    for phase_id in phase_ids.difference(&used_phase_ids) {
        warnings.push(format!("阶段 {phase_id} 没有归属节点"));
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
        if !FLOW_KINDS.contains(&edge.flow_kind.as_str()) {
            errors.push(format!(
                "连线 {} 的 flowKind 无效：{}",
                edge.id, edge.flow_kind
            ));
        }
        if matches!(edge.flow_kind.as_str(), "branch" | "fallback" | "loop-exit")
            && edge.condition.trim().is_empty()
        {
            warnings.push(format!(
                "控制流连线 {} 的 {} 缺少 condition",
                edge.id, edge.flow_kind
            ));
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
            analysis: None,
            schema_version: "0.2".into(),
            project_id: "demo".into(),
            title: "test".into(),
            category_id: String::new(),
            category: String::new(),
            root: "a".into(),
            description: String::new(),
            source_revision: None,
            phases: Vec::new(),
            nodes: vec![
                GraphNode {
                    symbol: None,
                    id: "a".into(),
                    phase_id: String::new(),
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
                    symbol: None,
                    id: "b".into(),
                    phase_id: String::new(),
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
                flow_kind: "normal".into(),
                condition: String::new(),
                order: None,
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
    fn accepts_control_flow_edge_semantics() {
        let mut graph = graph();
        graph.schema_version = "0.3".into();
        graph.edges[0].flow_kind = "loop-exit".into();
        graph.edges[0].condition = "done".into();

        let report = validate_graph(&graph, None);

        assert!(report.valid, "{:?}", report.errors);
    }

    #[test]
    fn validates_scenario_phase_contract() {
        let mut graph = graph();
        graph.schema_version = "0.4".into();
        graph.phases = vec![
            crate::model::GraphPhase {
                id: "input".into(),
                title: "接收输入".into(),
                summary: "把外部输入送入系统".into(),
                order: 1,
            },
            crate::model::GraphPhase {
                id: "model".into(),
                title: "请求模型".into(),
                summary: String::new(),
                order: 2,
            },
        ];
        graph.nodes[0].phase_id = "input".into();
        graph.nodes[1].phase_id = "model".into();

        let report = validate_graph(&graph, None);

        assert!(report.valid, "{:?}", report.errors);
        assert!(report.warnings.is_empty(), "{:?}", report.warnings);
    }

    #[test]
    fn rejects_unknown_and_duplicated_scenario_phases() {
        let mut graph = graph();
        graph.schema_version = "0.4".into();
        graph.phases = vec![
            crate::model::GraphPhase {
                id: "input".into(),
                title: "接收输入".into(),
                summary: String::new(),
                order: 1,
            },
            crate::model::GraphPhase {
                id: "input".into(),
                title: "重复阶段".into(),
                summary: String::new(),
                order: 1,
            },
        ];
        graph.nodes[0].phase_id = "missing".into();

        let report = validate_graph(&graph, None);

        assert!(!report.valid);
        assert!(
            report
                .errors
                .iter()
                .any(|error| error.contains("阶段 id 重复"))
        );
        assert!(
            report
                .errors
                .iter()
                .any(|error| error.contains("阶段 order 重复"))
        );
        assert!(
            report
                .errors
                .iter()
                .any(|error| error.contains("phaseId 不存在"))
        );
    }

    #[test]
    fn rejects_unknown_control_flow_kind() {
        let mut graph = graph();
        graph.edges[0].flow_kind = "scenario".into();

        let report = validate_graph(&graph, None);

        assert!(!report.valid);
        assert!(report.errors.iter().any(|error| error.contains("flowKind")));
    }

    #[test]
    fn validates_category_metadata() {
        let mut graph = graph();
        graph.category_id = "../tools".into();
        graph.category = "x".repeat(41);

        let report = validate_graph(&graph, None);

        assert!(!report.valid);
        assert!(
            report
                .errors
                .iter()
                .any(|error| error.contains("categoryId"))
        );
        assert!(
            report
                .errors
                .iter()
                .any(|error| error.contains("category 不能超过"))
        );
    }

    #[test]
    fn warns_when_conditional_flow_has_no_condition() {
        let mut graph = graph();
        graph.edges[0].flow_kind = "branch".into();

        let report = validate_graph(&graph, None);

        assert!(report.valid, "{:?}", report.errors);
        assert!(
            report
                .warnings
                .iter()
                .any(|warning| warning.contains("缺少 condition"))
        );
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
