use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallGraph {
    pub schema_version: String,
    pub project_id: String,
    pub title: String,
    pub root: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub source_revision: Option<String>,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
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
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: String,
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
    pub description: String,
    pub project_id: String,
    pub node_count: usize,
    pub edge_count: usize,
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
    pub focus_line: u32,
    pub start_line: u32,
    pub end_line: u32,
    pub lines: Vec<SourcePreviewLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePreviewLine {
    pub number: u32,
    pub text: String,
    pub focus: bool,
}
