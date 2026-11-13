//! Normalize protocol facts before the collector can schedule or merge them.
use super::{
    Direction, decode_hierarchy, lsp::Client, node, provider::Language, semantics::Semantics,
    server_profile::ServerProfile, symbol_index::SymbolIndex, validate_call_ranges,
    validate_ranges,
};
use crate::model::GraphNode;
use lsp_types::{CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, Range};
use serde_json::json;
use std::{collections::HashMap, path::Path};

pub(super) struct CallFact {
    pub node: GraphNode,
    pub item: CallHierarchyItem,
    pub ranges: Vec<Range>,
}
pub(super) struct CallBatch {
    pub calls: Vec<CallFact>,
    pub complete: bool,
    pub issues: Vec<String>,
}
#[derive(Clone)]
pub(super) struct AnalysisAdapter {
    profile: ServerProfile,
    index: SymbolIndex,
    pub semantics: Semantics,
}
impl AnalysisAdapter {
    pub fn new(language: Language) -> Self {
        let index = SymbolIndex::default();
        Self {
            profile: language.profile(),
            semantics: Semantics::with_index(language, index.clone()),
            index,
        }
    }
    pub async fn resolve(
        &self,
        client: &Client,
        root: &Path,
        subject: &GraphNode,
        selected: Option<CallHierarchyItem>,
        uri: &str,
        text: &str,
    ) -> Result<CallHierarchyItem, String> {
        let mut paths = HashMap::new();
        let mut selected = selected;
        if selected.is_none() {
            let line = text
                .lines()
                .nth(subject.line.saturating_sub(1) as usize)
                .ok_or("符号行已变化，请重新分析")?;
            let name = subject
                .label
                .split("::")
                .last()
                .unwrap_or(&subject.label)
                .split('(')
                .next()
                .unwrap_or(&subject.label);
            for (column, _) in line.match_indices(name) {
                let value=self.profile.prepare(client,json!({"textDocument":{"uri":uri},"position":{"line":subject.line-1,"character":line[..column].encode_utf16().count()}})).await?;
                let items: Vec<CallHierarchyItem> =
                    super::decode_hierarchy(value).map_err(|e| format!("无法解析函数身份：{e}"))?;
                for item in items {
                    if node(root, &item, &mut paths)?.id == subject.id {
                        selected = Some(item);
                        break;
                    }
                }
                if selected.is_some() {
                    break;
                }
            }
        }
        selected.ok_or("无法重新确认原符号身份，请检查源码版本".into())
    }
    pub async fn calls(
        &mut self,
        client: &Client,
        root: &Path,
        item: &CallHierarchyItem,
        direction: Direction,
        subject: &GraphNode,
    ) -> Result<CallBatch, String> {
        let incoming = direction == Direction::Incoming;
        let value = if incoming {
            self.profile.incoming(client, item).await?
        } else {
            self.profile.outgoing(client, item).await?
        };
        if value.is_null() {
            return Err(if incoming {
                "服务器返回 null，不能确认调用者"
            } else {
                "服务器返回 null，不能确认下游"
            }
            .into());
        }
        let calls: Vec<(CallHierarchyItem, Vec<Range>)> = if incoming {
            let calls: Vec<CallHierarchyIncomingCall> =
                decode_hierarchy(value).map_err(|e| format!("无效反向调用层级：{e}"))?;
            calls
                .into_iter()
                .map(|call| (call.from, call.from_ranges))
                .collect()
        } else {
            let calls: Vec<CallHierarchyOutgoingCall> =
                decode_hierarchy(value).map_err(|e| format!("无效调用层级：{e}"))?;
            validate_call_ranges(item, &calls)?;
            calls
                .into_iter()
                .map(|call| (call.to, call.from_ranges))
                .collect()
        };
        let mut batch = CallBatch {
            calls: vec![],
            complete: true,
            issues: vec![],
        };
        let mut paths = HashMap::new();
        for (mut target, ranges) in calls {
            if incoming
                && let Err(error) = self
                    .profile
                    .caller_declaration(&self.index, client, root, &mut target)
                    .await
                    .and_then(|_| validate_ranges(&target, &ranges))
            {
                batch.complete = false;
                batch.issues.push(format!("{}: {error}", subject.id));
                continue;
            }
            if ranges.is_empty() {
                batch.complete = false;
                batch
                    .issues
                    .push(format!("{}: {} 缺少调用点", subject.id, target.name));
                continue;
            }
            let mut resolved = match node(root, &target, &mut paths) {
                Ok(node) => node,
                Err(error) => {
                    batch
                        .issues
                        .push(format!("{}: {}：{error}", subject.id, target.name));
                    continue;
                }
            };
            if let Err(error) = self
                .semantics
                .describe(client, root, &target, &mut resolved)
                .await
            {
                let id = if incoming { &subject.id } else { &resolved.id };
                batch.issues.push(format!("{id}: {error}"));
            }
            batch.calls.push(CallFact {
                node: resolved,
                item: target,
                ranges,
            });
        }
        Ok(batch)
    }
}
