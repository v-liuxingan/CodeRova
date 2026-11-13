//! JDT-specific symbol facts. No graph traversal or persistence policy lives here.
use super::{lsp::Client, relative_file};
use crate::model::SymbolInfo;
use lsp_types::{CallHierarchyItem, DocumentSymbol, Position, Range, SymbolKind};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};
use tokio::sync::OnceCell;
type FileFacts = (Vec<DocumentSymbol>, String);
type FileCache = Arc<Mutex<HashMap<String, Arc<OnceCell<FileFacts>>>>>;

pub(super) fn symbol_text(item: &CallHierarchyItem) -> (String, String) {
    let signature = item.name.split(" : ").next().unwrap_or(&item.name);
    let owner = item.detail.clone().unwrap_or_default();
    let label = if owner.is_empty() {
        signature.to_owned()
    } else {
        format!(
            "{}::{signature}",
            owner.rsplit('.').next().unwrap_or(&owner)
        )
    };
    (label, owner)
}

#[derive(Clone, Default)]
pub(super) struct JavaSymbols {
    files: FileCache,
}

fn contains(range: Range, p: Position) -> bool {
    (range.start.line, range.start.character) <= (p.line, p.character)
        && (p.line, p.character) <= (range.end.line, range.end.character)
}

// Preserve line/UTF-16 coordinates while removing comments and literals. Keywords
// in Javadoc, annotations' strings and method bodies must not become modifiers.
fn masked(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if c == '/' && matches!(next, Some('/' | '*')) {
            let block = next == Some('*');
            out.push_str("  ");
            i += 2;
            while i < chars.len() {
                if block && chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    out.push_str("  ");
                    i += 2;
                    break;
                }
                let c = chars[i];
                i += 1;
                if c == '\n' {
                    out.push('\n');
                } else {
                    out.extend(std::iter::repeat_n(' ', c.len_utf16()));
                }
                if !block && c == '\n' {
                    break;
                }
            }
        } else if matches!(c, '\'' | '"') {
            let quote = c;
            out.push(' ');
            i += 1;
            while i < chars.len() {
                let c = chars[i];
                i += 1;
                if c == '\n' {
                    out.push('\n');
                } else {
                    out.extend(std::iter::repeat_n(' ', c.len_utf16()));
                }
                if c == '\\' && i < chars.len() {
                    out.extend(std::iter::repeat_n(' ', chars[i].len_utf16()));
                    i += 1;
                } else if c == quote {
                    break;
                }
            }
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

fn prefix(text: &str, symbol: &DocumentSymbol) -> String {
    // LSP range starts at the declaration (possibly annotations/Javadoc), not
    // at the preceding member. Stop at its selected name, before the body.
    text.lines()
        .enumerate()
        .filter_map(|(i, line)| {
            let i = i as u32;
            if i < symbol.range.start.line || i > symbol.selection_range.start.line {
                return None;
            }
            let start = if i == symbol.range.start.line {
                symbol.range.start.character as usize
            } else {
                0
            };
            let end = if i == symbol.selection_range.start.line {
                symbol.selection_range.start.character as usize
            } else {
                line.encode_utf16().count()
            };
            Some(String::from_utf16_lossy(
                &line
                    .encode_utf16()
                    .skip(start)
                    .take(end.saturating_sub(start))
                    .collect::<Vec<_>>(),
            ))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn facts(
    symbols: &[DocumentSymbol],
    text: &str,
    p: Position,
    owner: Option<SymbolInfo>,
) -> Option<SymbolInfo> {
    for symbol in symbols {
        if !contains(symbol.range, p) {
            continue;
        }
        let declaration = prefix(text, symbol);
        let words: Vec<_> = declaration
            .split(|c: char| !c.is_alphanumeric() && c != '_')
            .filter(|s| !s.is_empty())
            .collect();
        let has = |s| words.contains(&s);
        let mut current = owner.clone();
        if matches!(
            symbol.kind,
            SymbolKind::CLASS | SymbolKind::INTERFACE | SymbolKind::ENUM | SymbolKind::STRUCT
        ) {
            let kind = if has("record") {
                "record"
            } else if symbol.kind == SymbolKind::INTERFACE {
                "interface"
            } else if symbol.kind == SymbolKind::ENUM {
                "enum"
            } else if has("abstract") {
                "abstract-class"
            } else {
                "class"
            };
            current = Some(SymbolInfo {
                owner_kind: kind.into(),
                owner_name: symbol.name.clone(),
                modifiers: vec![],
                tags: if declaration.split('@').skip(1).any(|a| {
                    a.trim_start()
                        .split(|c: char| !c.is_alphanumeric() && c != '.')
                        .next()
                        .is_some_and(|a| a == "Entity" || a.ends_with(".Entity"))
                }) {
                    vec!["Entity".into()]
                } else {
                    vec![]
                },
            });
        }
        if matches!(symbol.kind, SymbolKind::METHOD | SymbolKind::CONSTRUCTOR) {
            if let Some(info) = &mut current {
                info.modifiers = ["static", "abstract", "final", "default", "private"]
                    .into_iter()
                    .filter(|m| has(m))
                    .map(str::to_owned)
                    .collect();
                if info.owner_kind == "interface"
                    && !has("static")
                    && !has("default")
                    && !has("private")
                    && !has("abstract")
                {
                    info.modifiers.push("abstract".into());
                }
            }
            return current;
        }
        if let Some(children) = &symbol.children
            && let Some(found) = facts(children, text, p, current.clone())
        {
            return Some(found);
        }
        return current;
    }
    None
}

// JDT incoming selectionRange can point at a call expression inside the caller.
// Resolve the enclosing declaration, never prepare at that expression (the callee).
fn caller_symbol<'a>(
    symbols: &'a [DocumentSymbol],
    item: &CallHierarchyItem,
) -> Option<&'a DocumentSymbol> {
    for symbol in symbols {
        if !contains(symbol.range, item.selection_range.start) {
            continue;
        }
        if let Some(found) = symbol
            .children
            .as_deref()
            .and_then(|children| caller_symbol(children, item))
        {
            return Some(found);
        }
        if symbol.kind == item.kind
            && symbol.name.split(" : ").next() == item.name.split(" : ").next()
        {
            return Some(symbol);
        }
    }
    None
}

impl JavaSymbols {
    async fn file_facts(
        &mut self,
        session: &Client,
        root: &Path,
        item: &CallHierarchyItem,
    ) -> Result<Arc<OnceCell<FileFacts>>, String> {
        let uri = item.uri.to_string();
        let cell = self
            .files
            .lock()
            .map_err(|e| e.to_string())?
            .entry(uri.clone())
            .or_default()
            .clone();
        cell.get_or_try_init(|| async {
            let file = relative_file(root, &uri)?;
            let text = std::fs::read_to_string(root.join(file)).map_err(|e| e.to_string())?;
            let value = session
                .request(
                    "textDocument/documentSymbol",
                    json!({"textDocument":{"uri":uri}}),
                    180,
                )
                .await?;
            let symbols: Vec<DocumentSymbol> =
                serde_json::from_value(value).map_err(|e| format!("Java 符号信息不可用：{e}"))?;
            Ok::<_, String>((symbols, masked(&text)))
        })
        .await?;
        Ok(cell)
    }

    pub async fn describe(
        &mut self,
        session: &Client,
        root: &Path,
        item: &CallHierarchyItem,
    ) -> Result<Option<SymbolInfo>, String> {
        let cell = self.file_facts(session, root, item).await?;
        let (symbols, text) = cell.get().ok_or("Java 符号信息未加载")?;
        Ok(facts(symbols, text, item.selection_range.start, None))
    }

    pub async fn caller_declaration(
        &mut self,
        session: &Client,
        root: &Path,
        item: &mut CallHierarchyItem,
    ) -> Result<(), String> {
        let cell = self.file_facts(session, root, item).await?;
        let (symbols, _) = cell.get().ok_or("Java 符号信息未加载")?;
        let symbol =
            caller_symbol(symbols, item).ok_or("无法确认 Java 调用者声明，保留为未完成采集")?;
        item.range = symbol.range;
        item.selection_range = symbol.selection_range;
        Ok(())
    }

    pub async fn implementations(
        &mut self,
        session: &Client,
        root: &Path,
        item: &CallHierarchyItem,
        info: Option<&SymbolInfo>,
    ) -> Result<(Vec<CallHierarchyItem>, Vec<String>), String> {
        if item.kind != SymbolKind::METHOD
            || info.is_none_or(|s| {
                s.modifiers
                    .iter()
                    .any(|m| matches!(m.as_str(), "static" | "final" | "private"))
            })
        {
            return Ok((vec![], vec![]));
        }
        let response = session
            .request(
                "textDocument/implementation",
                json!({"textDocument":{"uri":item.uri},"position":item.selection_range.start}),
                180,
            )
            .await?;
        let locations = match response {
            Value::Null => return Ok((vec![], vec![])),
            Value::Array(locations) => locations,
            location if location.is_object() => vec![location],
            _ => return Err("Java 实现查询返回了无效位置列表".into()),
        };
        let mut result = vec![];
        let mut issues = vec![];
        for location in locations {
            let uri = location["uri"]
                .as_str()
                .or_else(|| location["targetUri"].as_str())
                .ok_or("实现位置缺少 URI")?;
            if relative_file(root, uri).is_err() {
                continue;
            }
            let position = location
                .get("targetSelectionRange")
                .unwrap_or(&location["range"])["start"]
                .clone();
            let value = session
                .request(
                    "textDocument/prepareCallHierarchy",
                    json!({"textDocument":{"uri":uri},"position":position}),
                    180,
                )
                .await;
            let items: Vec<CallHierarchyItem> = match value.and_then(|value| {
                super::decode_hierarchy::<Vec<CallHierarchyItem>>(value)
                    .map_err(|e| format!("实现方法无法定位：{e}"))
            }) {
                Ok(items) if !items.is_empty() => items,
                Ok(_) => {
                    issues.push(format!("实现方法无法定位：{uri} {position}"));
                    continue;
                }
                Err(e) => {
                    issues.push(format!("{uri} {position}: {e}"));
                    continue;
                }
            };
            for candidate in items {
                if candidate.kind == SymbolKind::METHOD
                    && !(candidate.uri == item.uri
                        && candidate.selection_range == item.selection_range)
                    && !result.iter().any(|n: &CallHierarchyItem| {
                        n.uri == candidate.uri && n.selection_range == candidate.selection_range
                    })
                {
                    result.push(candidate);
                }
            }
        }
        Ok((result, issues))
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
            caller_symbol(&symbols, &item).unwrap().selection_range,
            selection
        );
        item.name = "direct(String) : void".into();
        assert!(caller_symbol(&symbols, &item).is_none());
        item.name = "direct(int) : void".into();
        item.selection_range.start = Position::new(3, 1);
        assert!(caller_symbol(&symbols, &item).is_none());
    }

    #[test]
    fn masking_preserves_utf16_positions_and_ignores_comment_keywords() {
        let source = "/** 😀 abstract record */\n@Entity(name=\"static😀\") class Order {\n}";
        let clean = masked(source);
        for (a, b) in source.lines().zip(clean.lines()) {
            assert_eq!(a.encode_utf16().count(), b.encode_utf16().count());
        }
        assert!(!clean.contains("abstract"));
        assert!(!clean.contains("record"));
        assert!(!clean.contains("static"));
        assert!(clean.contains("@Entity"));
    }

    #[test]
    fn interface_default_and_nested_record_have_distinct_facts() {
        let source = "interface Service {\n default void run() {}\n record Item(int n) {\n  void show() {}\n }\n}";
        let symbols: Vec<DocumentSymbol> = serde_json::from_value(json!([{
            "name":"Service", "kind":11,
            "range":{"start":{"line":0,"character":0},"end":{"line":5,"character":1}},
            "selectionRange":{"start":{"line":0,"character":10},"end":{"line":0,"character":17}},
            "children":[
                {"name":"run", "kind":6,
                 "range":{"start":{"line":1,"character":1},"end":{"line":1,"character":22}},
                 "selectionRange":{"start":{"line":1,"character":14},"end":{"line":1,"character":17}}},
                {"name":"Item", "kind":5,
                 "range":{"start":{"line":2,"character":1},"end":{"line":4,"character":2}},
                 "selectionRange":{"start":{"line":2,"character":8},"end":{"line":2,"character":12}},
                 "children":[{"name":"show", "kind":6,
                   "range":{"start":{"line":3,"character":2},"end":{"line":3,"character":16}},
                   "selectionRange":{"start":{"line":3,"character":7},"end":{"line":3,"character":11}}}]}
            ]
        }])).unwrap();
        let default = facts(&symbols, source, Position::new(1, 14), None).unwrap();
        assert_eq!(default.owner_kind, "interface");
        assert_eq!(default.modifiers, vec!["default"]);
        let record = facts(&symbols, source, Position::new(3, 7), None).unwrap();
        assert_eq!(record.owner_kind, "record");
        assert_eq!(record.owner_name, "Item");
        assert!(record.modifiers.is_empty());
    }
}
