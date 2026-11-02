//! Trusted, shared LSP launch and collection settings.
use serde::Deserialize;
use serde_json::Value;
use std::{fs, path::PathBuf};

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct Collection {
    pub concurrency: usize,
    pub request_timeout_seconds: u64,
    pub max_retries: usize,
}
impl Default for Collection {
    fn default() -> Self {
        Self {
            concurrency: 4,
            request_timeout_seconds: 30,
            max_retries: 3,
        }
    }
}
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Local {
    pub java: Option<Java>,
    #[serde(default)]
    pub collection: Collection,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Java {
    pub command: PathBuf,
    pub args: Vec<String>,
    pub workspace_root: PathBuf,
    #[serde(default)]
    pub settings: Value,
}
impl Local {
    pub fn load() -> Result<Self, String> {
        let explicit = std::env::var_os("CALLGRAPH_LSP_CONFIG");
        let path = explicit
            .clone()
            .map(PathBuf::from)
            .unwrap_or_else(|| "callgraph.lsp.local.json".into());
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(e) if explicit.is_none() && e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(e) => return Err(format!("读取 LSP 配置 {} 失败：{e}", path.display())),
        };
        Self::parse(text.trim_start_matches('\u{feff}'))
    }
    fn parse(text: &str) -> Result<Self, String> {
        let value: Self = serde_json::from_str(text).map_err(|e| e.to_string())?;
        let c = value.collection;
        if !(1..=32).contains(&c.concurrency)
            || !(1..=300).contains(&c.request_timeout_seconds)
            || c.max_retries > 3
        {
            return Err("collection 配置无效：concurrency 1–32，requestTimeoutSeconds 1–300，maxRetries 0–3".into());
        }
        Ok(value)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_strict_limits() {
        assert_eq!(Local::parse("{}").unwrap().collection.concurrency, 4);
        for c in [4, 8, 16] {
            assert_eq!(
                Local::parse(&format!(r#"{{"collection":{{"concurrency":{c}}}}}"#))
                    .unwrap()
                    .collection
                    .concurrency,
                c
            );
        }
        for text in [
            r#"{"collection":{"concurrency":0}}"#,
            r#"{"collection":{"maxRetries":4}}"#,
            r#"{"collection":{"requestTimeoutSeconds":0}}"#,
            r#"{"collection":{"unknown":true}}"#,
        ] {
            assert!(Local::parse(text).is_err());
        }
    }
}
