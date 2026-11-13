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
/// A source anchor, not a claim that LSP has identified a callable symbol.
pub fn position(file: &str, text: &str, line: u32) -> Result<GraphNode, String> {
    Language::for_file(file)?;
    let selected = line
        .checked_sub(1)
        .and_then(|n| text.lines().nth(n as usize))
        .ok_or("所选行超出文件范围")?;
    if selected.trim().is_empty() {
        return Err("请选择有代码的一行".into());
    }
    Ok(GraphNode {
        id: format!(
            "entry-position-{}",
            stable_id(&format!("{file}:{line}:{text}"))
        ),
        symbol: None,
        phase_id: String::new(),
        kind: "function".into(),
        label: format!(
            "{} · 第 {line} 行",
            Path::new(file)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
        ),
        crate_name: String::new(),
        module: String::new(),
        file: file.into(),
        line,
        end_line: None,
        role: "用户选择的源码位置，尚未确认函数身份".into(),
        description: "开始采集时由语言服务器确认所属函数；当前不是已验证的调用符号。".into(),
        state: "expanded".into(),
    })
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
    let uri = Url::from_file_path(crate::project_catalog::tool_path(&path))
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
        let items = language
            .profile()
            .prepare_with_timeout(
                session,
                json!({"textDocument":{"uri":uri},"position":symbol["selectionRange"]["start"]}),
                30,
            )
            .await?;
        let items: Vec<lsp_types::CallHierarchyItem> = super::decode_hierarchy(items)
            .map_err(|e| format!("无法读取语言服务器的入口信息：{e}"))?;
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
    fn source_position_is_bounded_and_content_bound_without_lsp() {
        let text = "// 注释\nfn main() {}\n\n";
        assert!(position("src/main.rs", text, 0).is_err());
        assert!(position("src/main.rs", text, 4).is_err());
        assert!(position("src/main.rs", text, 3).is_err());
        assert!(position("README.md", text, 2).is_err());
        let anchor = position("src/main.rs", text, 2).unwrap();
        assert!(anchor.id.starts_with("entry-position-"));
        assert!(anchor.symbol.is_none());
        assert_ne!(
            anchor.id,
            position("src/main.rs", "fn main() {}", 1).unwrap().id
        );
    }
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
