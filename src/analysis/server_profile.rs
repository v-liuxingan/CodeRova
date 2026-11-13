//! Protocol compatibility belongs to the configured server, not traversal.
use super::{
    lsp,
    symbol_index::{SymbolIndex, caller_symbol},
};
use lsp_types::CallHierarchyItem;
use serde_json::{Value, json};
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum ServerProfile {
    Standard,
    Jdt,
}
impl ServerProfile {
    pub fn query_timeout(self) -> u64 {
        match self {
            Self::Standard => 30,
            Self::Jdt => 180,
        }
    }
    async fn sequence(self, client: &lsp::Client) -> Option<tokio::sync::MutexGuard<'_, ()>> {
        if self == Self::Jdt {
            Some(client.hierarchy_sequence().await)
        } else {
            None
        }
    }
    pub async fn prepare(self, client: &lsp::Client, params: Value) -> Result<Value, String> {
        self.prepare_with_timeout(client, params, self.query_timeout())
            .await
    }
    pub async fn prepare_with_timeout(
        self,
        client: &lsp::Client,
        params: Value,
        timeout: u64,
    ) -> Result<Value, String> {
        let _sequence = self.sequence(client).await;
        client
            .request("textDocument/prepareCallHierarchy", params, timeout)
            .await
    }
    pub async fn caller_declaration(
        self,
        index: &SymbolIndex,
        client: &lsp::Client,
        root: &Path,
        item: &mut CallHierarchyItem,
    ) -> Result<(), String> {
        if self == Self::Standard {
            return Ok(());
        }
        let file = index.load(client, root, item, self.query_timeout()).await?;
        let symbol = caller_symbol(&file.symbols, item, |a, b| {
            a.split(" : ").next() == b.split(" : ").next()
        })
        .ok_or("无法确认 Java 调用者声明，保留为未完成采集")?;
        item.range = symbol.range;
        item.selection_range = symbol.selection_range;
        Ok(())
    }
    pub async fn incoming(
        self,
        session: &lsp::Client,
        item: &lsp_types::CallHierarchyItem,
    ) -> Result<Value, String> {
        let _sequence = self.sequence(session).await;
        session
            .request(
                "callHierarchy/incomingCalls",
                json!({"item": item}),
                self.query_timeout(),
            )
            .await
    }

    pub async fn outgoing(
        self,
        session: &lsp::Client,
        item: &lsp_types::CallHierarchyItem,
    ) -> Result<Value, String> {
        let _sequence = self.sequence(session).await;
        // JDT's cached child wrappers retain the previous caller's call location.
        // Preparing this declaration as a fresh root clears that context before
        // outgoingCalls; otherwise implementation candidates may use foreign ranges.
        if self == Self::Jdt {
            let response = session
                .request(
                    "textDocument/prepareCallHierarchy",
                    json!({
                        "textDocument":{"uri":item.uri},"position":item.selection_range.start
                    }),
                    self.query_timeout(),
                )
                .await?;
            let prepared: Vec<lsp_types::CallHierarchyItem> =
                super::decode_hierarchy(response).map_err(|_| "无法重新确认 Java 方法")?;
            if prepared.len() != 1
                || prepared[0].uri != item.uri
                || prepared[0].name != item.name
                || prepared[0].selection_range != item.selection_range
            {
                tracing::warn!(expected_name = %item.name, uri = ?item.uri,
                    expected_selection = ?item.selection_range,
                    actual = ?prepared.iter().map(|p| (&p.name, &p.uri, p.selection_range)).collect::<Vec<_>>(),
                    "Java declaration identity mismatch");
                return Err("Java 方法身份发生变化，拒绝使用旧调用位置".into());
            }
        }
        session
            .request(
                "callHierarchy/outgoingCalls",
                json!({"item":self.outgoing_item(item)}),
                self.query_timeout(),
            )
            .await
    }
    pub fn outgoing_item(
        self,
        item: &lsp_types::CallHierarchyItem,
    ) -> lsp_types::CallHierarchyItem {
        let mut item = item.clone();
        // JDT LS resolves outgoing calls from range.start rather than selectionRange.
        // A leading Javadoc @link can otherwise resolve an unrelated type/member.
        if self == Self::Jdt {
            item.range.start = item.selection_range.start;
        }
        item
    }
}
