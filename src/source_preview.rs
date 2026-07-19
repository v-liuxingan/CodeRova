use std::fs;
use std::path::Path;

use crate::model::{SourcePreview, SourcePreviewLine};

pub const DEFAULT_CONTEXT_LINES: u16 = 12;
pub const MAX_CONTEXT_LINES: u16 = 40;
const DEFAULT_MAX_BYTES: u64 = 4 * 1024 * 1024;
const MAX_RETURNED_LINES: usize = 240;
const MAX_LINE_CHARS: usize = 4_000;

pub trait SourcePreviewer: Send + Sync {
    fn preview(
        &self,
        path: &Path,
        focus_line: u32,
        focus_end_line: u32,
        context_lines: u16,
    ) -> Result<SourcePreview, String>;
}

#[derive(Debug, Clone)]
pub struct FileSourcePreviewer {
    max_bytes: u64,
}

impl Default for FileSourcePreviewer {
    fn default() -> Self {
        Self {
            max_bytes: DEFAULT_MAX_BYTES,
        }
    }
}

impl SourcePreviewer for FileSourcePreviewer {
    fn preview(
        &self,
        path: &Path,
        focus_line: u32,
        focus_end_line: u32,
        context_lines: u16,
    ) -> Result<SourcePreview, String> {
        if focus_line == 0 || focus_end_line < focus_line {
            return Err("源码预览范围无效".to_owned());
        }
        let metadata = fs::metadata(path)
            .map_err(|error| format!("无法读取源码文件 {}：{error}", path.display()))?;
        if !metadata.is_file() {
            return Err(format!("源码位置不是普通文件：{}", path.display()));
        }
        if metadata.len() > self.max_bytes {
            return Err(format!(
                "源码文件过大，无法预览：{}（上限 {} MiB）",
                path.display(),
                self.max_bytes / 1024 / 1024
            ));
        }
        let bytes = fs::read(path)
            .map_err(|error| format!("无法读取源码文件 {}：{error}", path.display()))?;
        if bytes.contains(&0) {
            return Err(format!("拒绝预览疑似二进制文件：{}", path.display()));
        }
        let content = String::from_utf8(bytes)
            .map_err(|_| format!("源码文件不是有效 UTF-8：{}", path.display()))?;
        let source_lines = content.lines().collect::<Vec<_>>();
        let focus_index = usize::try_from(focus_line - 1).map_err(|error| error.to_string())?;
        if focus_index >= source_lines.len() {
            return Err(format!(
                "源码位置超出文件范围：{}:{}",
                path.display(),
                focus_line
            ));
        }

        let context_lines = context_lines.min(MAX_CONTEXT_LINES);
        let context = usize::from(context_lines);
        let requested_focus_end =
            usize::try_from(focus_end_line).map_err(|error| error.to_string())?;
        let actual_focus_end = requested_focus_end
            .min(source_lines.len())
            .max(focus_index + 1);
        let desired_start = focus_index.saturating_sub(context);
        let desired_end = actual_focus_end
            .saturating_add(context)
            .min(source_lines.len());
        let start_index = desired_start;
        let end_index = desired_end.min(start_index.saturating_add(MAX_RETURNED_LINES));
        let focus_range_truncated = end_index < actual_focus_end;
        let lines = source_lines[start_index..end_index]
            .iter()
            .enumerate()
            .map(|(offset, text)| {
                let number = u32::try_from(start_index + offset + 1).unwrap_or(u32::MAX);
                let (text, truncated) = truncate_line(text);
                SourcePreviewLine {
                    number,
                    text,
                    focus: number >= focus_line
                        && number <= focus_end_line
                        && number as usize <= end_index,
                    truncated,
                }
            })
            .collect();

        Ok(SourcePreview {
            path: path.display().to_string(),
            language: language_for_path(path).to_owned(),
            focus_line,
            focus_end_line: u32::try_from(actual_focus_end).unwrap_or(u32::MAX),
            start_line: u32::try_from(start_index + 1).unwrap_or(u32::MAX),
            end_line: u32::try_from(end_index).unwrap_or(u32::MAX),
            total_lines: u32::try_from(source_lines.len()).unwrap_or(u32::MAX),
            file_size_bytes: metadata.len(),
            context_lines,
            truncated_before: start_index > 0,
            truncated_after: end_index < source_lines.len(),
            focus_range_truncated,
            lines,
        })
    }
}

fn truncate_line(line: &str) -> (String, bool) {
    let mut chars = line.chars();
    let text = chars.by_ref().take(MAX_LINE_CHARS).collect::<String>();
    let truncated = chars.next().is_some();
    (text, truncated)
}

fn language_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("rs") => "rust",
        Some("js" | "mjs" | "cjs") => "javascript",
        Some("ts" | "tsx") => "typescript",
        Some("py") => "python",
        Some("go") => "go",
        Some("java") => "java",
        Some("kt" | "kts") => "kotlin",
        Some("c" | "h") => "c",
        Some("cc" | "cpp" | "cxx" | "hpp") => "cpp",
        Some("json") => "json",
        Some("toml") => "toml",
        Some("yaml" | "yml") => "yaml",
        Some("md") => "markdown",
        Some("sh" | "bash") => "shell",
        _ => "text",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_bounded_context_and_marks_focus_line() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("sample.rs");
        let content = (1..=20)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&path, content).expect("source");

        let previewer = FileSourcePreviewer { max_bytes: 1024 };
        let preview = previewer.preview(&path, 10, 10, 2).expect("preview");

        assert_eq!(preview.start_line, 8);
        assert_eq!(preview.end_line, 12);
        assert_eq!(preview.lines.len(), 5);
        assert_eq!(
            preview.lines.iter().find(|line| line.focus).unwrap().text,
            "line 10"
        );
        assert_eq!(preview.language, "rust");
        assert_eq!(preview.total_lines, 20);
        assert!(preview.truncated_before);
        assert!(preview.truncated_after);
    }

    #[test]
    fn rejects_line_outside_file() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("sample.rs");
        fs::write(&path, "one\n").expect("source");

        let error = FileSourcePreviewer::default()
            .preview(&path, 2, 2, DEFAULT_CONTEXT_LINES)
            .expect_err("out of range");
        assert!(error.contains("超出文件范围"));
    }

    #[test]
    fn caps_context_range_and_long_lines() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("sample.txt");
        let long_line = "x".repeat(MAX_LINE_CHARS + 10);
        let content = std::iter::repeat_n(long_line, 400)
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&path, content).expect("source");

        let preview = FileSourcePreviewer::default()
            .preview(&path, 20, 350, u16::MAX)
            .expect("preview");

        assert_eq!(preview.context_lines, MAX_CONTEXT_LINES);
        assert_eq!(preview.lines.len(), MAX_RETURNED_LINES);
        assert!(preview.focus_range_truncated);
        assert!(preview.lines.iter().all(|line| line.truncated));
    }

    #[test]
    fn rejects_binary_content() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("sample.bin");
        fs::write(&path, b"hello\0world").expect("source");

        let error = FileSourcePreviewer::default()
            .preview(&path, 1, 1, DEFAULT_CONTEXT_LINES)
            .expect_err("binary");

        assert!(error.contains("二进制"));
    }
}
