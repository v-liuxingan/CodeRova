use super::{node, provider::Language, stable_id};
use crate::{model::GraphNode, validation::resolve_source_path};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
use url::Url;

#[derive(Serialize)]
pub struct SourceFile {
    pub id: String,
    pub name: String,
}
pub fn files(root: &Path) -> Result<Vec<SourceFile>, String> {
    fn walk(
        root: &Path,
        dir: &Path,
        out: &mut Vec<SourceFile>,
        seen: &mut HashSet<PathBuf>,
    ) -> Result<(), String> {
        let canonical = dir.canonicalize().map_err(|e| e.to_string())?;
        if !canonical.starts_with(root) || !seen.insert(canonical) {
            return Ok(());
        }
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if !matches!(
                    entry.file_name().to_str(),
                    Some(".git" | "target" | "node_modules" | "build" | ".gradle")
                ) {
                    walk(root, &entry.path(), out, seen)?;
                }
            } else if entry
                .path()
                .extension()
                .is_some_and(|e| e == "rs" || e == "java")
            {
                let name = entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|e| e.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push(SourceFile {
                    id: stable_id(&name),
                    name,
                });
            }
        }
        Ok(())
    }
    let mut out = vec![];
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    walk(&root, &root, &mut out, &mut HashSet::new())?;
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}
pub fn source(root: &Path, id: &str) -> Result<(String, String), String> {
    let name = files(root)?
        .into_iter()
        .find(|f| f.id == id)
        .ok_or("文件选择已失效，请重新选择")?
        .name;
    let path = resolve_source_path(root, &name)?;
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 2 * 1024 * 1024 {
        return Err("文件超过 2 MiB，暂不支持在入口选择器打开".into());
    }
    Ok((name, fs::read_to_string(path).map_err(|e| e.to_string())?))
}
#[derive(Clone)]
pub struct Candidate {
    pub slug: String,
    pub node: GraphNode,
    pub text: String,
}
fn enclosing(symbols: &[Value], line: u32, out: &mut Vec<Value>) {
    for symbol in symbols {
        if symbol["range"]["start"]["line"]
            .as_u64()
            .is_some_and(|n| n <= u64::from(line))
            && symbol["range"]["end"]["line"]
                .as_u64()
                .is_some_and(|n| n >= u64::from(line))
        {
            if matches!(symbol["kind"].as_u64(), Some(6 | 9 | 12)) {
                out.push(symbol.clone());
            }
            if let Some(children) = symbol["children"].as_array() {
                enclosing(children, line, out);
            }
        }
    }
}
pub(crate) async fn check(
    sessions: std::sync::Arc<super::session_cache::SessionCache>,
    root: PathBuf,
    file: String,
    text: String,
    line: u32,
) -> Result<GraphNode, String> {
    if line == 0 || line as usize > text.lines().count() {
        return Err("所选行超出文件范围".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = resolve_source_path(&root, &file)?;
    let uri = Url::from_file_path(path)
        .map_err(|_| "文件 URI 无效")?
        .to_string();
    let language = Language::for_file(&file)?;
    let mut lease = super::session_cache::Lease::acquire(sessions, &root, language).await?;
    lease.session.open(&uri, language, &text).await?;
    let session = &mut lease.session.transport;
    let result = async {
        session.wait_ready(600).await?;
        let symbols = session
            .request(
                "textDocument/documentSymbol",
                json!({"textDocument":{"uri":uri}}),
                language.query_timeout(),
            )
            .await?;
        let mut candidates = vec![];
        enclosing(
            symbols.as_array().ok_or("服务器未返回可定位的符号列表")?,
            line - 1,
            &mut candidates,
        );
        candidates.sort_by_key(|s| {
            s["range"]["end"]["line"].as_u64().unwrap_or(0)
                - s["range"]["start"]["line"].as_u64().unwrap_or(0)
        });
        let symbol = candidates
            .first()
            .ok_or("该行不在可采集函数或方法内，请选择函数定义或函数体内的一行")?;
        let items = session
            .request(
                "textDocument/prepareCallHierarchy",
                json!({"textDocument":{"uri":uri},"position":symbol["selectionRange"]["start"]}),
                30,
            )
            .await?;
        let items: Vec<lsp_types::CallHierarchyItem> =
            serde_json::from_value(items).map_err(|_| "LSP 无法为该位置准备调用层级")?;
        if items.len() != 1 {
            return Err("该行未匹配唯一可采集符号，请选择更明确的位置".into());
        }
        let mut result = node(&root, &items[0], &mut HashMap::new())?;
        super::semantics::Semantics::new(language)
            .describe(session, &root, &items[0], &mut result)
            .await?;
        if result.file != file || !matches!(result.kind.as_str(), "function" | "method") {
            return Err("解析到的符号不属于所选文件中的函数/方法".into());
        }
        Ok(result)
    }
    .await;
    if result.is_ok() {
        lease.release().await;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_catalog_excludes_build_and_dependency_folders() {
        let root = tempfile::tempdir().unwrap();
        for name in [
            "src/main.rs",
            "src/Main.java",
            "build/Generated.java",
            ".gradle/Generated.java",
            "target/generated.rs",
            "node_modules/lib.rs",
            ".git/hidden.rs",
            "src/readme.md",
        ] {
            let path = root.path().join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "fn main() {}\n").unwrap();
        }
        let entries = files(root.path()).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().any(|e| e.name == "src/Main.java"));
        assert!(entries.iter().any(|e| e.name == "src/main.rs"));
        assert!(source(root.path(), "../src/main.rs").is_err());
        assert!(source(root.path(), &entries[0].id).is_ok());
    }
    #[test]
    fn selected_line_must_belong_to_callable_symbol() {
        let symbols = vec![
            json!({"kind":5,"range":{"start":{"line":0},"end":{"line":8}},"children":[{"kind":6,"range":{"start":{"line":2},"end":{"line":5}}}]}),
        ];
        let mut found = vec![];
        enclosing(&symbols, 3, &mut found);
        assert_eq!(found.len(), 1);
        found.clear();
        enclosing(&symbols, 7, &mut found);
        assert!(found.is_empty());
    }
}
