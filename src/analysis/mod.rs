//! V2 analysis: language-server facts remain separate from execution interpretation.
mod lsp;

use crate::{
    model::{CallGraph, GraphEdge, GraphNode},
    project_catalog::{FileProjectCatalog, ProjectCatalog},
    validation::{resolve_source_path, validate_graph},
};
use lsp_types::{CallHierarchyItem, CallHierarchyOutgoingCall};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisReport {
    pub provider: String,
    pub scope: String,
    pub max_depth: u32,
    pub request_budget: usize,
    pub queried_nodes: Vec<String>,
    pub pending_nodes: Vec<String>,
    pub issues: Vec<String>,
}

pub struct AnalyzeOptions {
    pub config: PathBuf,
    pub project: String,
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub max_depth: u32,
    pub request_budget: usize,
    pub server: PathBuf,
    pub server_args: Vec<String>,
    pub output: PathBuf,
}

fn stable_id(key: &str) -> String {
    // Stable across identical snapshots, not a persistent symbol identity across edits.
    let hash = key.as_bytes().iter().fold(0xcbf29ce484222325_u64, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x100000001b3)
    });
    format!("lsp-{hash:016x}")
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

fn node(root: &Path, item: &CallHierarchyItem) -> Result<GraphNode, String> {
    let file = relative_file(root, item.uri.as_str())?;
    let id = stable_id(&format!(
        "{}:{}:{}:{}",
        file, item.selection_range.start.line, item.selection_range.start.character, item.name
    ));
    Ok(GraphNode {
        id,
        phase_id: String::new(),
        kind: if item.kind == lsp_types::SymbolKind::METHOD {
            "method"
        } else {
            "function"
        }
        .into(),
        label: item.name.clone(),
        crate_name: String::new(),
        module: String::new(),
        file,
        line: item.selection_range.start.line + 1,
        end_line: None,
        role: "静态符号；业务职责尚未解释".into(),
        description: item
            .detail
            .clone()
            .unwrap_or_else(|| "由 rust-analyzer 解析的源码符号".into()),
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
    let uri = Url::from_file_path(&file)
        .map_err(|_| "无法生成文件 URI")?
        .to_string();
    let root_uri = Url::from_directory_path(&root)
        .map_err(|_| "无法生成项目 URI")?
        .to_string();
    let mut session = lsp::Session::start(&options.server, &options.server_args, &root)?;
    eprintln!("正在初始化 rust-analyzer：{}", root.display());
    let init = session.request("initialize", json!({
        "processId": std::process::id(), "rootUri":root_uri,
        "workspaceFolders":[{"uri":root_uri,"name":options.project}],
        "capabilities":{"general":{"positionEncodings":["utf-16"]}, "window":{"workDoneProgress":true}, "experimental":{"serverStatusNotification":true}},
        "initializationOptions":{"checkOnSave":false,"cargo":{"buildScripts":{"enable":false}},"procMacro":{"enable":false}}
    }), 30).await?;
    let capability = &init["capabilities"]["callHierarchyProvider"];
    if capability != true && !capability.is_object() {
        return Err("服务器不支持 callHierarchyProvider".into());
    }
    if init["capabilities"]["positionEncoding"]
        .as_str()
        .is_some_and(|s| s != "utf-16")
    {
        return Err("服务器没有选择 UTF-16 位置编码".into());
    }
    session.notify("initialized", json!({})).await?;
    session
        .notify(
            "textDocument/didOpen",
            json!({"textDocument":{"uri":uri,"languageId":"rust","version":1,"text":text}}),
        )
        .await?;
    session.wait_ready(180).await?;
    let items: Vec<CallHierarchyItem> = serde_json::from_value(session.request("textDocument/prepareCallHierarchy", json!({"textDocument":{"uri":uri},"position":{"line":options.line-1,"character":options.column-1}}), 30).await?).map_err(|_| "入口未解析到调用符号，请检查函数名所在的行列".to_owned())?;
    if items.len() != 1 {
        return Err(format!(
            "入口匹配 {} 个符号，请选择明确的函数名位置",
            items.len()
        ));
    }
    let entry = items.into_iter().next().unwrap();
    let first = node(&root, &entry)?;
    let mut graph = CallGraph {
        schema_version: "0.4".into(), project_id: options.project, title: format!("{} · LSP 调用关系", first.label),
        category_id: "analysis".into(), category: "源码分析".into(), root: first.id.clone(),
        description: "rust-analyzer 静态调用关系。仅覆盖当前项目内的可解析目标；不代表运行顺序、动态分派全覆盖或业务场景完整性。构建脚本与过程宏执行关闭，相关关系可能缺失。".into(),
        source_revision: None, phases: vec![], nodes: vec![first.clone()], edges: vec![], analysis: None,
    };
    let mut report = AnalysisReport { provider: "rust-analyzer / LSP callHierarchy".into(), scope: "project-local outgoing calls; static relationships only; build scripts and proc macros disabled".into(), max_depth:options.max_depth, request_budget:options.request_budget, queried_nodes:vec![], pending_nodes:vec![], issues:vec![] };
    let mut known = HashSet::from([first.id.clone()]);
    let mut depths = HashMap::from([(first.id, 0_u32)]);
    let mut queue = VecDeque::from([entry]);
    let mut seen_edges = HashSet::new();
    let mut requests = 0;
    while let Some(item) = queue.pop_front() {
        let caller = node(&root, &item)?;
        let depth = depths[&caller.id];
        if depth >= options.max_depth || requests >= options.request_budget {
            report.pending_nodes.push(caller.id);
            continue;
        }
        eprintln!("分析 {}（深度 {depth}）", caller.label);
        requests += 1;
        let response = match session
            .request("callHierarchy/outgoingCalls", json!({"item":item}), 30)
            .await
        {
            Ok(value) => value,
            Err(error) => {
                report.issues.push(format!("{}: {error}", caller.id));
                report.pending_nodes.push(caller.id);
                break;
            }
        };
        if response.is_null() {
            report
                .issues
                .push(format!("{}: 服务器返回 null，不能确认下游", caller.id));
            report.pending_nodes.push(caller.id);
            continue;
        }
        let calls: Vec<CallHierarchyOutgoingCall> =
            serde_json::from_value(response).map_err(|e| format!("无效调用层级：{e}"))?;
        report.queried_nodes.push(caller.id.clone());
        for call in calls {
            let target = match node(&root, &call.to) {
                Ok(target) => target,
                Err(error) => {
                    report
                        .issues
                        .push(format!("{} → {}：{error}", caller.label, call.to.name));
                    continue;
                }
            };
            if call.from_ranges.is_empty() {
                report.issues.push(format!(
                    "{} → {}：缺少调用点，未建立边",
                    caller.label, target.label
                ));
                continue;
            }
            if known.insert(target.id.clone()) {
                depths.insert(target.id.clone(), depth + 1);
                graph.nodes.push(target.clone());
                queue.push_back(call.to);
            }
            for range in call.from_ranges {
                let key = format!(
                    "{}:{}:{}:{}",
                    caller.id, target.id, range.start.line, range.start.character
                );
                if !seen_edges.insert(key.clone()) {
                    continue;
                }
                graph.edges.push(GraphEdge {
                    id: stable_id(&key),
                    from: caller.id.clone(),
                    to: target.id.clone(),
                    kind: "static-call".into(),
                    flow_kind: "normal".into(),
                    condition: String::new(),
                    order: None,
                    label: "静态调用".into(),
                    call_site_status: "exact".into(),
                    call_site_note: String::new(),
                    file: caller.file.clone(),
                    line: range.start.line + 1,
                    description: "语言服务器报告的调用关系；调用机制与控制条件尚未进一步分类。"
                        .into(),
                    evidence: format!(
                        "LSP outgoingCalls; UTF-16 call site {}:{}",
                        range.start.line + 1,
                        range.start.character + 1
                    ),
                    confidence: 1.0,
                });
            }
        }
    }
    for item in queue {
        report.pending_nodes.push(node(&root, &item)?.id);
    }
    // Includes depth/budget boundaries and failed/null queries; never report semantic completeness.
    report.pending_nodes.sort();
    report.pending_nodes.dedup();
    graph.analysis = Some(report);
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
        "已生成 {}：{} 个节点，{} 个调用点；{} 个待分析节点",
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
