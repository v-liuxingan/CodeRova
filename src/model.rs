use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallGraph {
    pub schema_version: String,
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
    pub file: String,
    pub line: u32,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub evidence: String,
    #[serde(default = "default_confidence")]
    pub confidence: f32,
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
