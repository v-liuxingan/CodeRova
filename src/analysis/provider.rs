//! Server launch configuration is local/trusted, never supplied by HTTP clients.
use super::lsp;
use serde_json::{Value, json};
use std::{fs, path::Path};
use url::Url;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Language {
    Rust,
    Java,
}
impl Language {
    pub(super) fn symbol_text(self, item: &lsp_types::CallHierarchyItem) -> (String, String) {
        match self {
            Self::Rust => (item.name.clone(), String::new()),
            Self::Java => super::java::symbol_text(item),
        }
    }

    pub async fn incoming(
        self,
        session: &lsp::Client,
        item: &lsp_types::CallHierarchyItem,
    ) -> Result<Value, String> {
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
        // JDT's cached child wrappers retain the previous caller's call location.
        // Preparing this declaration as a fresh root clears that context before
        // outgoingCalls; otherwise implementation candidates may use foreign ranges.
        if self == Self::Java {
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
        if self == Self::Java {
            item.range.start = item.selection_range.start;
        }
        item
    }
    pub fn for_file(file: &str) -> Result<Self, String> {
        match Path::new(file).extension().and_then(|s| s.to_str()) {
            Some("rs") => Ok(Self::Rust),
            Some("java") => Ok(Self::Java),
            _ => Err("仅支持 Rust 或 Java 源文件".into()),
        }
    }
    pub fn server_type(self) -> &'static str {
        match self {
            Self::Rust => "rust-analyzer",
            Self::Java => "Eclipse JDT LS",
        }
    }
    pub fn id(self) -> &'static str {
        match self {
            Self::Rust => "rust",
            Self::Java => "java",
        }
    }
    pub fn provider(self) -> &'static str {
        match self {
            Self::Rust => "rust-analyzer / LSP callHierarchy",
            Self::Java => "eclipse-jdtls / LSP callHierarchy",
        }
    }
    pub fn query_timeout(self) -> u64 {
        match self {
            Self::Rust => 30,
            Self::Java => 180,
        }
    }
    pub fn scope(self) -> &'static str {
        match self {
            Self::Rust => {
                "project-local outgoing calls; static relationships only; build scripts and proc macros disabled"
            }
            Self::Java => {
                "project-local outgoing calls; Java static binding only; reflection, proxies and runtime dispatch may be missing"
            }
        }
    }
    pub fn from_provider(value: &str) -> Result<Self, String> {
        if value == "rust-analyzer" || value.starts_with("rust-analyzer /") {
            Ok(Self::Rust)
        } else if value == "eclipse-jdtls" || value.starts_with("eclipse-jdtls /") {
            Ok(Self::Java)
        } else {
            Err("不支持此图的分析器".into())
        }
    }
    pub fn supported(value: &str) -> bool {
        Self::from_provider(value).is_ok()
    }
    pub fn start(
        self,
        root: &Path,
        server: Option<(&Path, &[String])>,
    ) -> Result<lsp::Session, String> {
        let config = super::config::Local::load()?;
        let policy = config.collection;
        let external_root = crate::project_catalog::tool_path(root);
        let (command, args, settings) = match self {
            Self::Rust => {
                let (s, a) = server.unwrap_or((Path::new("rust-analyzer"), &[]));
                (s.to_path_buf(), a.to_vec(), json!({}))
            }
            Self::Java => {
                let java = config
                    .java
                    .ok_or("Java LSP 未配置，请填写本地配置中的 java")?;
                let workspace = java
                    .workspace_root
                    .join(super::stable_id(&root.to_string_lossy()));
                fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
                let args = java
                    .args
                    .iter()
                    .map(|a| {
                        a.replace("{workspace}", &workspace.to_string_lossy())
                            .replace("{root}", &external_root.to_string_lossy())
                    })
                    .collect();
                (java.command, args, java.settings)
            }
        };
        let session = lsp::Session::start(&command, &args, root, policy, settings)?;
        Ok(session)
    }
    pub async fn initialize(
        self,
        session: &lsp::Client,
        root: &Path,
        name: &str,
    ) -> Result<(), String> {
        let uri = Url::from_directory_path(crate::project_catalog::tool_path(root))
            .map_err(|_| "项目 URI 无效")?
            .to_string();
        let options = match self {
            Self::Rust => {
                json!({"checkOnSave":false,"cargo":{"buildScripts":{"enable":false}},"procMacro":{"enable":false}})
            }
            Self::Java => {
                json!({"settings":session.settings(),"extendedClientCapabilities":{"classFileContentsSupport":false}})
            }
        };
        let init=session.request("initialize",json!({"processId":std::process::id(),"rootUri":uri,"workspaceFolders":[{"uri":uri,"name":name}],"capabilities":{"general":{"positionEncodings":["utf-16"]},"workspace":{"configuration":true},"textDocument":{"documentSymbol":{"hierarchicalDocumentSymbolSupport":true}},"window":{"workDoneProgress":true},"experimental":{"serverStatusNotification":true}},"initializationOptions":options}),120).await?;
        let cap = &init["capabilities"]["callHierarchyProvider"];
        if cap != true && !cap.is_object() {
            return Err("服务器不支持调用层级".into());
        }
        if init["capabilities"]["positionEncoding"]
            .as_str()
            .is_some_and(|s| s != "utf-16")
        {
            return Err("服务器位置编码不是 UTF-16".into());
        }
        session.notify("initialized", json!({})).await?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routes_only_supported_sources_and_providers() {
        assert_eq!(Language::for_file("src/X.java").unwrap(), Language::Java);
        assert_eq!(Language::for_file("src/main.rs").unwrap(), Language::Rust);
        assert!(Language::for_file("X.class").is_err());
        assert!(Language::supported("eclipse-jdtls / LSP callHierarchy"));
        assert!(!Language::supported("unknown"));
        assert!(!Language::supported("eclipse-jdtls-unknown"));
    }
}
