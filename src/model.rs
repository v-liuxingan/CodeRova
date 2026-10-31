use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CallGraph {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analysis: Option<crate::analysis::AnalysisReport>,
    pub schema_version: String,
    pub project_id: String,
    pub title: String,
    #[serde(default)]
    pub category_id: String,
    #[serde(default)]
    pub category: String,
    pub root: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub source_revision: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub phases: Vec<GraphPhase>,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphPhase {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    pub order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphNode {
    pub id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub phase_id: String,
    pub kind: String,
    pub label: String,
    #[serde(rename = "crate", default)]
    pub crate_name: String,
    #[serde(default)]
    pub module: String,
    pub file: String,
    pub line: u32,
    #[serde(default)]
    pub end_line: Option<u32>,
    pub role: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_node_state")]
    pub state: String,
}

fn default_node_state() -> String {
    "expanded".to_owned()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: String,
    #[serde(
        default = "default_flow_kind",
        skip_serializing_if = "is_normal_flow_kind"
    )]
    pub flow_kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub condition: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
    #[serde(default)]
    pub label: String,
    #[serde(default = "default_call_site_status")]
    pub call_site_status: String,
    #[serde(default)]
    pub call_site_note: String,
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub line: u32,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub evidence: String,
    #[serde(default = "default_confidence")]
    pub confidence: f32,
}

pub const CALL_SITE_EXACT: &str = "exact";
pub const CALL_SITE_VIRTUAL_NODE: &str = "virtual-node";
pub const CALL_SITE_OMITTED_NODES: &str = "omitted-nodes";

fn default_flow_kind() -> String {
    "normal".to_owned()
}

fn is_normal_flow_kind(kind: &String) -> bool {
    kind == "normal"
}

fn default_call_site_status() -> String {
    CALL_SITE_EXACT.to_owned()
}

impl GraphEdge {
    pub fn exact_call_site(&self) -> Option<(&str, u32)> {
        (self.call_site_status == CALL_SITE_EXACT && !self.file.is_empty() && self.line > 0)
            .then_some((self.file.as_str(), self.line))
    }
}

fn default_confidence() -> f32 {
    1.0
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSummary {
    pub slug: String,
    pub title: String,
    pub category_id: String,
    pub category: String,
    pub description: String,
    pub project_id: String,
    pub node_count: usize,
    pub edge_count: usize,
}

/// A bounded, architecture-level reading path. Unlike `GraphPhase`, a scenario
/// may cross projects and links implementation details through stable graph
/// targets instead of inferring its topology from one callgraph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchitectureScenario {
    pub schema_version: String,
    pub title: String,
    pub goal: String,
    #[serde(default)]
    pub description: String,
    pub participants: Vec<ScenarioParticipant>,
    pub steps: Vec<ScenarioStep>,
    pub links: Vec<ScenarioLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScenarioParticipant {
    pub id: String,
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScenarioStep {
    pub id: String,
    pub participant_id: String,
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub drilldowns: Vec<ScenarioDrilldown>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScenarioDrilldown {
    pub project_id: String,
    pub graph_slug: String,
    pub target_ids: Vec<String>,
    pub purpose: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScenarioLink {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub condition: String,
    #[serde(default = "default_confidence")]
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioSummary {
    pub slug: String,
    pub title: String,
    pub goal: String,
    pub participant_count: usize,
    pub step_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub source_locations: Vec<SourceLocationStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocationStatus {
    pub target_type: String,
    pub id: String,
    pub file: String,
    pub line: u32,
    pub exists: bool,
    pub line_in_range: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub graph: String,
    pub target_type: String,
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewRequest {
    pub graph: String,
    pub target_type: String,
    pub id: String,
    #[serde(default)]
    pub context_lines: Option<u16>,
    #[serde(default)]
    pub scope: PreviewScope,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PreviewScope {
    #[default]
    Target,
    File,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResponse {
    pub uri: String,
    pub path: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePreview {
    pub path: String,
    pub scope: PreviewScope,
    pub language: String,
    pub focus_line: u32,
    pub focus_end_line: u32,
    pub start_line: u32,
    pub end_line: u32,
    pub total_lines: u32,
    pub file_size_bytes: u64,
    pub context_lines: u16,
    pub truncated_before: bool,
    pub truncated_after: bool,
    pub focus_range_truncated: bool,
    pub lines: Vec<SourcePreviewLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePreviewLine {
    pub number: u32,
    pub text: String,
    pub focus: bool,
    pub truncated: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn preview_scope_defaults_to_target_and_rejects_unknown_values() {
        let request: PreviewRequest = serde_json::from_str(
            r#"{"graph":"demo","targetType":"node","id":"node.a","contextLines":12}"#,
        )
        .expect("legacy request");
        assert_eq!(request.scope, PreviewScope::Target);

        let error = serde_json::from_str::<PreviewRequest>(
            r#"{"graph":"demo","targetType":"node","id":"node.a","scope":"workspace"}"#,
        )
        .expect_err("unknown scope");
        assert!(error.to_string().contains("unknown variant"));
    }

    #[test]
    fn graph_category_is_optional_for_existing_documents() {
        let graph: CallGraph = serde_json::from_value(json!({
            "schemaVersion": "0.2",
            "projectId": "codex",
            "title": "Legacy graph",
            "root": "root",
            "nodes": [],
            "edges": []
        }))
        .expect("legacy graph should deserialize");

        assert!(graph.category_id.is_empty());
        assert!(graph.category.is_empty());
        assert!(graph.phases.is_empty());
    }

    #[test]
    fn graph_summary_serializes_category_for_the_catalog() {
        let summary = GraphSummary {
            slug: "shell".into(),
            title: "Shell".into(),
            category_id: "tools".into(),
            category: "工具执行".into(),
            description: String::new(),
            project_id: "codex".into(),
            node_count: 2,
            edge_count: 1,
        };

        let value = serde_json::to_value(summary).expect("summary should serialize");
        assert_eq!(value["category"], "工具执行");
        assert_eq!(value["categoryId"], "tools");
    }

    #[test]
    fn graph_edge_round_trips_optional_execution_order() {
        let edge: GraphEdge = serde_json::from_value(json!({
            "id": "caller-first",
            "from": "caller",
            "to": "first",
            "kind": "direct",
            "order": 1,
            "file": "src/lib.rs",
            "line": 12
        }))
        .expect("ordered edge");

        assert_eq!(edge.order, Some(1));
        let value = serde_json::to_value(edge).expect("serialize edge");
        assert_eq!(value["order"], 1);
    }

    #[test]
    fn graph_round_trips_scenario_phases_without_affecting_legacy_graphs() {
        let graph: CallGraph = serde_json::from_value(json!({
            "schemaVersion": "0.4",
            "projectId": "codex",
            "title": "Scenario graph",
            "root": "root",
            "phases": [{
                "id": "input",
                "title": "接收输入",
                "summary": "把外部输入送入内部回合。",
                "order": 1
            }],
            "nodes": [{
                "id": "root",
                "phaseId": "input",
                "kind": "function",
                "label": "main",
                "file": "src/main.rs",
                "line": 1,
                "role": "用户输入入口"
            }],
            "edges": []
        }))
        .expect("scenario graph should deserialize");

        assert_eq!(graph.phases.len(), 1);
        assert_eq!(graph.phases[0].id, "input");
        assert_eq!(graph.nodes[0].phase_id, "input");
        let value = serde_json::to_value(graph).expect("serialize scenario graph");
        assert_eq!(value["phases"][0]["title"], "接收输入");
        assert_eq!(value["nodes"][0]["phaseId"], "input");
    }
}
