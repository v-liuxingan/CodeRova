//! V2 analysis: language-server facts remain separate from execution interpretation.
mod collector;
pub mod config;
pub mod entry;
mod java;
mod lsp;
pub mod provider;
pub mod resume;
mod semantics;
pub(crate) mod session_cache;

use crate::{
    model::{CallGraph, GraphNode},
    project_catalog::{FileProjectCatalog, ProjectCatalog},
    validation::{resolve_source_path, validate_graph},
};
use lsp_types::{CallHierarchyItem, CallHierarchyOutgoingCall};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use url::Url;

/// Exploration direction never changes the meaning of stored caller -> callee edges.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    #[default]
    Outgoing,
    Incoming,
}
impl Direction {
    pub fn is_outgoing(&self) -> bool {
        *self == Self::Outgoing
    }
    pub fn endpoints<'a>(&self, edge: &'a crate::model::GraphEdge) -> (&'a str, &'a str) {
        match self {
            Self::Outgoing => (&edge.from, &edge.to),
            Self::Incoming => (&edge.to, &edge.from),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisReport {
    #[serde(default, skip_serializing_if = "Direction::is_outgoing")]
    pub direction: Direction,
    pub provider: String,
    pub scope: String,
    pub max_depth: u32,
    pub request_budget: usize,
    pub queried_nodes: Vec<String>,
    pub pending_nodes: Vec<String>,
    pub issues: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pruned_node_ids: Vec<String>,
}

pub struct AnalyzeOptions {
    pub direction: Direction,
    pub config: PathBuf,
    pub project: String,
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub max_depth: u32,
    pub request_budget: usize,
    pub exclude_paths: Vec<String>,
    pub server: PathBuf,
    pub server_args: Vec<String>,
    pub output: PathBuf,
}

fn validate_call_ranges(
    item: &CallHierarchyItem,
    calls: &[CallHierarchyOutgoingCall],
) -> Result<(), String> {
    for call in calls {
        validate_ranges(item, &call.from_ranges)?;
    }
    Ok(())
}

fn validate_ranges(item: &CallHierarchyItem, ranges: &[lsp_types::Range]) -> Result<(), String> {
    let key = |p: lsp_types::Position| (p.line, p.character);
    for range in ranges {
        if key(range.start) < key(item.range.start)
            || key(range.end) > key(item.range.end)
            || key(range.start) > key(range.end)
        {
            tracing::warn!(caller = %item.name, uri = ?item.uri,
                declaration = ?item.range, call_site = ?range, "LSP call range outside declaration");
            return Err("语言服务器返回的调用点不在当前方法范围内，未采纳此查询结果".into());
        }
    }
    Ok(())
}

fn normalize_exclusion(value: &str) -> Result<String, String> {
    let value = value.replace('\\', "/");
    let value = value.trim_end_matches('/');
    if value.is_empty()
        || value
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
        || value.contains([':', '*', '?'])
    {
        return Err("exclude-path 必须是项目内相对文件或目录，不支持通配符或 ..".into());
    }
    Ok(value.to_owned())
}

fn excluded(file: &str, rule: &str) -> bool {
    file == rule
        || file
            .strip_prefix(rule)
            .is_some_and(|tail| tail.starts_with('/'))
}

pub(crate) fn stable_id(key: &str) -> String {
    // Stable across identical snapshots, not a persistent symbol identity across edits.
    let hash = key.as_bytes().iter().fold(0xcbf29ce484222325_u64, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x100000001b3)
    });
    format!("lsp-{hash:016x}")
}

// JDT may return IRIs with literal Unicode. lsp_types::Uri requires ASCII URIs.
// Normalize only protocol URI fields; opaque server data must round-trip unchanged.
pub(crate) fn decode_hierarchy<T: serde::de::DeserializeOwned>(
    mut value: Value,
) -> Result<T, serde_json::Error> {
    fn uri(item: &mut Value) {
        if let Some(raw) = item.get("uri").and_then(Value::as_str)
            && let Ok(parsed) = Url::parse(raw)
        {
            item["uri"] = Value::String(parsed.to_string());
        }
    }
    if let Some(items) = value.as_array_mut() {
        for item in items {
            uri(item);
            if let Some(to) = item.get_mut("to") {
                uri(to);
            }
            if let Some(from) = item.get_mut("from") {
                uri(from);
            }
        }
    }
    serde_json::from_value(value)
}

fn relative_file(root: &Path, uri: &str) -> Result<String, String> {
    let path = Url::parse(uri)
        .map_err(|e| e.to_string())?
        .to_file_path()
        .map_err(|_| "不是本地文件 URI")?;
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "目标在当前项目范围之外")?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn node(
    root: &Path,
    item: &CallHierarchyItem,
    paths: &mut HashMap<String, Result<String, String>>,
) -> Result<GraphNode, String> {
    let file = paths
        .entry(item.uri.to_string())
        .or_insert_with(|| relative_file(root, item.uri.as_str()))
        .clone()?;
    let id = stable_id(&format!(
        "{}:{}:{}:{}",
        file, item.selection_range.start.line, item.selection_range.start.character, item.name
    ));
    Ok(GraphNode {
        symbol: None,
        id,
        phase_id: String::new(),
        kind: match item.kind {
            lsp_types::SymbolKind::METHOD | lsp_types::SymbolKind::CONSTRUCTOR => "method",
            lsp_types::SymbolKind::CLASS
            | lsp_types::SymbolKind::STRUCT
            | lsp_types::SymbolKind::ENUM => "struct",
            lsp_types::SymbolKind::INTERFACE => "trait",
            _ => "function",
        }
        .into(),
        label: provider::Language::for_file(&file)?.symbol_text(item).0,
        crate_name: String::new(),
        module: provider::Language::for_file(&file)?.symbol_text(item).1,
        file,
        line: item.selection_range.start.line + 1,
        end_line: None,
        role: "静态符号；业务职责尚未解释".into(),
        description: item
            .detail
            .clone()
            .unwrap_or_else(|| "由语言服务器解析的源码符号".into()),
        state: "expanded".into(),
    })
}

pub async fn analyze(options: AnalyzeOptions) -> Result<(), String> {
    tokio::select! {
        result = run(options) => result,
        _ = tokio::signal::ctrl_c() => Err("分析已取消，未导出结果".into()),
    }
}

async fn run(options: AnalyzeOptions) -> Result<(), String> {
    if options.line == 0 || options.column == 0 || options.request_budget == 0 {
        return Err("line、column 和 request-budget 必须大于 0".into());
    }
    if options.output.exists() {
        return Err("输出文件已存在，请选择新文件以保留原图".into());
    }
    let exclusions = options
        .exclude_paths
        .iter()
        .map(|p| normalize_exclusion(p))
        .collect::<Result<Vec<_>, _>>()?;
    let mut paths = HashMap::new();
    let catalog = FileProjectCatalog::from_file(&options.config)?;
    let root = catalog
        .resolve_root(&options.project)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let file = resolve_source_path(&root, &options.file)?;
    let text = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let source_line = text
        .lines()
        .nth(options.line as usize - 1)
        .ok_or("入口行超出文件范围")?;
    if options.column as usize > source_line.encode_utf16().count() + 1 {
        return Err("入口列超出 UTF-16 行范围".into());
    }
    let uri = Url::from_file_path(crate::project_catalog::tool_path(&file))
        .map_err(|_| "无法生成文件 URI")?
        .to_string();
    let language = provider::Language::for_file(&options.file)?;
    let session = language.start(&root, Some((&options.server, &options.server_args)))?;
    eprintln!("正在初始化 {}：{}", language.provider(), root.display());
    language
        .initialize(&session, &root, &options.project)
        .await?;
    session
        .notify(
            "textDocument/didOpen",
            json!({"textDocument":{"uri":uri,"languageId":language.id(),"version":1,"text":text}}),
        )
        .await?;
    session.wait_ready(600).await?;
    let items: Vec<CallHierarchyItem> = decode_hierarchy(session.request("textDocument/prepareCallHierarchy", json!({"textDocument":{"uri":uri},"position":{"line":options.line-1,"character":options.column-1}}), language.query_timeout()).await?).map_err(|_| "入口未解析到调用符号，请检查函数名所在的行列".to_owned())?;
    if items.len() != 1 {
        return Err(format!(
            "入口匹配 {} 个符号，请选择明确的函数名位置",
            items.len()
        ));
    }
    let entry = items.into_iter().next().unwrap();
    let mut first = node(&root, &entry, &mut paths)?;
    let mut semantics = semantics::Semantics::new(language);
    semantics
        .describe(&session, &root, &entry, &mut first)
        .await?;
    let mut graph = CallGraph {
        schema_version: "0.4".into(),
        project_id: options.project,
        title: format!("{} · LSP 调用关系", first.label),
        category_id: "analysis".into(),
        category: "源码分析".into(),
        root: first.id.clone(),
        description: format!(
            "{} 静态调用关系。仅覆盖项目内可解析目标；不代表运行顺序、动态分派全覆盖或业务场景完整性。{}",
            language.provider(),
            if options.direction == Direction::Incoming {
                "向上查找调用者"
            } else {
                language.scope()
            }
        ),
        source_revision: None,
        phases: vec![],
        nodes: vec![first.clone()],
        edges: vec![],
        analysis: None,
    };
    let mut report = AnalysisReport {
        direction: options.direction,
        provider: language.provider().into(),
        scope: if options.direction == Direction::Incoming {
            "project-local incoming calls; static relationships only".into()
        } else {
            language.scope().into()
        },
        max_depth: options.max_depth,
        request_budget: options.request_budget,
        queried_nodes: vec![],
        pending_nodes: vec![],
        issues: vec![],
        pruned_node_ids: vec![],
    };
    report.pending_nodes.push(first.id.clone());
    graph.analysis = Some(report);
    let mut warm = session_cache::WarmSession::from_open(session, uri, text);
    collector::collect(
        &mut graph,
        &root,
        &mut warm,
        language,
        vec![collector::Seed {
            id: first.id,
            item: Some(entry),
            depth: 0,
        }],
        collector::Options {
            budget: options.request_budget,
            max_depth: Some(options.max_depth),
            max_nodes: None,
            exclusions,
        },
        |_, _, _| Ok(()),
    )
    .await?;
    let session = warm.transport;
    session.stop().await;
    let validation = validate_graph(&graph, Some(&root));
    if !validation.valid {
        return Err(validation.errors.join("\n"));
    }
    if let Some(parent) = options
        .output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    use std::io::Write;
    let bytes = serde_json::to_vec_pretty(&graph).map_err(|e| e.to_string())?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&options.output)
        .map_err(|e| e.to_string())?;
    output.write_all(&bytes).map_err(|e| e.to_string())?;
    println!(
        "已生成 {}：{} 个节点，{} 条关系；{} 个待分析节点",
        options.output.display(),
        graph.nodes.len(),
        graph.edges.len(),
        graph.analysis.as_ref().unwrap().pending_nodes.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hierarchy_accepts_unicode_iris_without_rewriting_opaque_data() {
        let raw = json!({"name":"draw(Long)","kind":6,"uri":"file:///D:/示例项目/Activity.java",
            "range":{"start":{"line":1,"character":0},"end":{"line":3,"character":1}},
            "selectionRange":{"start":{"line":1,"character":8},"end":{"line":1,"character":12}},
            "data":{"uri":"server-private:示例项目","handle":"unchanged"}});
        assert!(serde_json::from_value::<CallHierarchyItem>(raw.clone()).is_err());
        let items: Vec<CallHierarchyItem> = decode_hierarchy(json!([raw.clone()])).unwrap();
        assert_eq!(items[0].data, Some(raw["data"].clone()));
        assert!(items[0].uri.as_str().contains("%E7%A4%BA"));
        let calls: Vec<CallHierarchyOutgoingCall> = decode_hierarchy(json!([{
            "to":raw,"fromRanges":[{"start":{"line":2,"character":0},"end":{"line":2,"character":4}}]
        }])).unwrap();
        assert_eq!(calls[0].to.uri, items[0].uri);
    }
    #[test]
    fn java_queries_anchor_declarations_and_reject_foreign_call_ranges() {
        let item: CallHierarchyItem = serde_json::from_value(json!({
            "name":"run() : void", "kind":6, "uri":"file:///example/Main.java",
            "range":{"start":{"line":2,"character":0},"end":{"line":12,"character":1}},
            "selectionRange":{"start":{"line":5,"character":8},"end":{"line":5,"character":11}}
        }))
        .unwrap();
        assert_eq!(
            provider::Language::Java.outgoing_item(&item).range.start,
            item.selection_range.start
        );
        assert_eq!(
            provider::Language::Rust.outgoing_item(&item).range.start,
            item.range.start
        );
        let mut call = CallHierarchyOutgoingCall {
            to: item.clone(),
            from_ranges: vec![lsp_types::Range::new(
                lsp_types::Position::new(6, 1),
                lsp_types::Position::new(6, 4),
            )],
        };
        assert!(validate_call_ranges(&item, &[call.clone()]).is_ok());
        call.from_ranges[0].start.line = 20;
        call.from_ranges[0].end.line = 20;
        assert!(validate_call_ranges(&item, &[call]).is_err());
    }
    #[test]
    fn exclusion_rules_match_components_not_similar_prefixes() {
        assert!(excluded("src/generated/a.rs", "src/generated"));
        assert!(!excluded("src/generated_extra/a.rs", "src/generated"));
        assert_eq!(
            normalize_exclusion("src\\generated/").unwrap(),
            "src/generated"
        );
        for invalid in ["", "../src", "/src", "C:/src", "src/**"] {
            assert!(normalize_exclusion(invalid).is_err());
        }
    }
    #[test]
    fn uri_paths_are_confined_to_project() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::NamedTempFile::new().unwrap();
        assert!(
            relative_file(
                &root.path().canonicalize().unwrap(),
                Url::from_file_path(other.path()).unwrap().as_str()
            )
            .is_err()
        );
        let path = root.path().join("a 空格.rs");
        fs::write(&path, "fn a() {}\n").unwrap();
        assert_eq!(
            relative_file(
                &root.path().canonicalize().unwrap(),
                Url::from_file_path(&path).unwrap().as_str()
            )
            .unwrap(),
            "a 空格.rs"
        );
    }
}
