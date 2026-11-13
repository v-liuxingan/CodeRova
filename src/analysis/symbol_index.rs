//! Shared, collection-scoped document symbols. No language syntax or graph policy.
use super::{lsp::Client, relative_file};
use lsp_types::{CallHierarchyItem, DocumentSymbol, Position, Range};
use serde_json::json;
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};
use tokio::sync::OnceCell;

pub(super) struct FileSymbols {
    pub symbols: Vec<DocumentSymbol>,
    pub text: String,
}
type FileCache = Arc<Mutex<HashMap<(u64, String), Arc<OnceCell<Arc<FileSymbols>>>>>>;
#[derive(Clone, Default)]
pub(super) struct SymbolIndex {
    files: FileCache,
}
impl SymbolIndex {
    pub async fn load(
        &self,
        client: &Client,
        root: &Path,
        item: &CallHierarchyItem,
        timeout: u64,
    ) -> Result<Arc<FileSymbols>, String> {
        // Resolve the boundary on every access, including cache hits.
        let uri = item.uri.to_string();
        let file = root.join(relative_file(root, &uri)?);
        let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
        let cell = self
            .files
            .lock()
            .map_err(|e| e.to_string())?
            .entry((client.identity(), uri.clone()))
            .or_default()
            .clone();
        let result = cell
            .get_or_try_init(|| async {
                let value = client
                    .request(
                        "textDocument/documentSymbol",
                        json!({"textDocument":{"uri":uri}}),
                        timeout,
                    )
                    .await?;
                // Flat SymbolInformation has no selectionRange. Do not fabricate one.
                let symbols: Vec<DocumentSymbol> = serde_json::from_value(value)
                    .map_err(|e| format!("声明符号信息不可用：{e}"))?;
                if std::fs::read_to_string(&file).map_err(|e| e.to_string())? != text {
                    return Err("源码已变化，请重新采集".to_owned());
                }
                Ok(Arc::new(FileSymbols {
                    symbols,
                    text: text.clone(),
                }))
            })
            .await?;
        // A collection is a single source snapshot. Retry in a new collection,
        // rather than combine old call handles with freshly read declarations.
        if result.text != text {
            return Err("源码已变化，请重新采集".into());
        }
        Ok(result.clone())
    }
}
fn contains(range: Range, p: Position) -> bool {
    (range.start.line, range.start.character) <= (p.line, p.character)
        && (p.line, p.character) < (range.end.line, range.end.character)
}
// JDT incoming selectionRange can point at a call expression inside the caller.
// Resolve the enclosing declaration, never prepare at that expression (the callee).
pub(super) fn caller_symbol<'a>(
    symbols: &'a [DocumentSymbol],
    item: &CallHierarchyItem,
    matches: impl Fn(&str, &str) -> bool + Copy,
) -> Option<&'a DocumentSymbol> {
    fn collect<'a>(
        symbols: &'a [DocumentSymbol],
        item: &CallHierarchyItem,
        matches: impl Fn(&str, &str) -> bool + Copy,
        found: &mut Vec<&'a DocumentSymbol>,
    ) {
        for symbol in symbols {
            if !contains(symbol.range, item.selection_range.start) {
                continue;
            }
            if let Some(children) = &symbol.children {
                collect(children, item, matches, found);
            }
            if symbol.kind == item.kind && matches(&symbol.name, &item.name) {
                found.push(symbol);
            }
        }
    }
    let mut found = vec![];
    collect(symbols, item, matches, &mut found);
    // A nested declaration wins over its enclosing method. Equal or overlapping
    // candidates without strict containment are ambiguous, never first-wins.
    let innermost: Vec<_> = found
        .iter()
        .filter(|candidate| {
            !found.iter().any(|other| {
                other.range != candidate.range
                    && contains(candidate.range, other.range.start)
                    && (other.range.end.line, other.range.end.character)
                        <= (candidate.range.end.line, candidate.range.end.character)
            })
        })
        .collect();
    if innermost.len() == 1 {
        Some(*innermost[0])
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn incoming_call_site_resolves_only_the_matching_declaration() {
        let range = Range::new(Position::new(2, 1), Position::new(2, 90));
        let selection = Range::new(Position::new(2, 13), Position::new(2, 19));
        let symbols: Vec<DocumentSymbol> = serde_json::from_value(json!([{
            "name":"direct(int) : void", "kind":6, "range":range,
            "selectionRange":selection
        }]))
        .unwrap();
        let mut item: CallHierarchyItem = serde_json::from_value(json!({
            "name":"direct(int) : void", "kind":6, "uri":"file:///fixture/Main.java",
            "range":range,
            "selectionRange":Range::new(Position::new(2, 42), Position::new(2, 55))
        }))
        .unwrap();
        assert_eq!(
            caller_symbol(&symbols, &item, |a, b| a == b)
                .unwrap()
                .selection_range,
            selection
        );
        let mut duplicate = symbols.clone();
        duplicate.push(symbols[0].clone());
        assert!(caller_symbol(&duplicate, &item, |a, b| a == b).is_none());
        item.name = "direct(String) : void".into();
        assert!(caller_symbol(&symbols, &item, |a, b| a == b).is_none());
        item.name = "direct(int) : void".into();
        item.selection_range.start = Position::new(3, 1);
        assert!(caller_symbol(&symbols, &item, |a, b| a == b).is_none());
    }
}
