//! Optional language capabilities, normalized before graph traversal.
use super::{java::JavaSymbols, lsp::Session, node, provider::Language, stable_id};
use crate::model::{GraphEdge, GraphNode};
use lsp_types::CallHierarchyItem;
use std::{collections::HashMap, path::Path};

pub(super) struct ImplementationCandidate {
    pub node: GraphNode,
    pub edge: GraphEdge,
    pub item: CallHierarchyItem,
}

pub(super) enum Semantics {
    Basic,
    Java(JavaSymbols),
}
impl Semantics {
    pub fn new(language: Language) -> Self {
        match language {
            Language::Rust => Self::Basic,
            Language::Java => Self::Java(JavaSymbols::default()),
        }
    }
    pub async fn describe(
        &mut self,
        session: &mut Session,
        root: &Path,
        item: &CallHierarchyItem,
        target: &mut GraphNode,
    ) -> Result<(), String> {
        if let Self::Java(java) = self {
            target.symbol = java.describe(session, root, item).await?;
        }
        Ok(())
    }
    pub async fn candidates(
        &mut self,
        session: &mut Session,
        root: &Path,
        item: &CallHierarchyItem,
        caller: &GraphNode,
    ) -> Result<Vec<ImplementationCandidate>, String> {
        let Self::Java(java) = self else {
            return Ok(vec![]);
        };
        let items = java
            .implementations(session, root, item, caller.symbol.as_ref())
            .await?;
        let single = items.len() == 1;
        let mut paths = HashMap::new();
        let mut result = vec![];
        for item in items {
            let mut target = node(root, &item, &mut paths)?;
            target.symbol = java.describe(session, root, &item).await?;
            let edge = GraphEdge {
                id: stable_id(&format!("implementation:{}:{}", caller.id, target.id)),
                from: caller.id.clone(),
                to: target.id.clone(),
                kind: "trait-dispatch".into(),
                flow_kind: "normal".into(),
                condition: String::new(),
                order: None,
                label: if single {
                    "单一实现"
                } else {
                    "候选实现"
                }
                .into(),
                call_site_status: "omitted-nodes".into(),
                call_site_note: "实现关系没有调用点；请查看目标方法声明。".into(),
                file: String::new(),
                line: 0,
                description: if single {
                    "当前项目索引仅找到一个实现，按采集预算继续；不证明运行时一定执行。"
                } else {
                    "语言服务器找到多个项目内实现；需要人或 AI 选择，不代表全部执行。"
                }
                .into(),
                evidence: "LSP textDocument/implementation; target declaration".into(),
                confidence: 1.0,
            };
            result.push(ImplementationCandidate {
                node: target,
                edge,
                item,
            });
        }
        Ok(result)
    }
}

/// An implementation-only target is an explicit collection boundary. A real
/// incoming call may independently justify traversal of that same symbol.
pub(super) fn selection_required(graph: &crate::model::CallGraph, id: &str) -> bool {
    let mut candidate = false;
    for edge in graph.edges.iter().filter(|e| e.to == id) {
        if edge.kind != "trait-dispatch" || edge.call_site_status != "omitted-nodes" {
            return false;
        }
        candidate = true;
    }
    candidate
}
