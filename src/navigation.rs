use std::path::Path;

use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};

const URI_PATH_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'`')
    .add(b'{')
    .add(b'}');

/// Converts a verified source location into an editor-owned external URI.
///
/// Implementations must only build data. Opening the URI remains an explicit
/// browser/user action, so the server never launches a shell or child process.
pub trait SourceLinkBuilder: Send + Sync {
    fn build(&self, path: &Path, line: u32, column: u32) -> Result<String, String>;
}

#[derive(Debug, Clone, Default)]
pub struct VscodeUriLinkBuilder;

impl SourceLinkBuilder for VscodeUriLinkBuilder {
    fn build(&self, path: &Path, line: u32, column: u32) -> Result<String, String> {
        if line == 0 || column == 0 {
            return Err("行号和列号必须大于 0".to_owned());
        }
        let raw = path.to_string_lossy();
        let without_verbatim_prefix = raw
            .strip_prefix(r"\\?\UNC\")
            .map(|value| format!("//{value}"))
            .or_else(|| raw.strip_prefix(r"\\?\").map(str::to_owned))
            .unwrap_or_else(|| raw.into_owned());
        let normalized = without_verbatim_prefix.replace('\\', "/");
        let encoded = utf8_percent_encode(&normalized, URI_PATH_ENCODE_SET);
        Ok(format!("vscode://file/{encoded}:{line}:{column}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_windows_vscode_uri_and_encodes_unsafe_characters() {
        let uri = VscodeUriLinkBuilder
            .build(Path::new(r"E:\Work Space\a#b.rs"), 12, 3)
            .expect("URI should be generated");
        assert_eq!(uri, "vscode://file/E:/Work%20Space/a%23b.rs:12:3");
    }

    #[test]
    fn removes_windows_verbatim_prefix() {
        let uri = VscodeUriLinkBuilder
            .build(Path::new(r"\\?\E:\source\main.rs"), 7, 1)
            .expect("URI should be generated");
        assert_eq!(uri, "vscode://file/E:/source/main.rs:7:1");
    }

    #[test]
    fn rejects_zero_position() {
        let error = VscodeUriLinkBuilder
            .build(Path::new("src/main.rs"), 0, 1)
            .expect_err("zero line should fail");
        assert_eq!(error, "行号和列号必须大于 0");
    }
}
