use std::fs;
use std::path::Path;

use crate::model::{SourcePreview, SourcePreviewLine};

const DEFAULT_CONTEXT_LINES: usize = 6;
const DEFAULT_MAX_BYTES: u64 = 4 * 1024 * 1024;

pub trait SourcePreviewer: Send + Sync {
    fn preview(&self, path: &Path, focus_line: u32) -> Result<SourcePreview, String>;
}

#[derive(Debug, Clone)]
pub struct FileSourcePreviewer {
    context_lines: usize,
    max_bytes: u64,
}

impl Default for FileSourcePreviewer {
    fn default() -> Self {
        Self {
            context_lines: DEFAULT_CONTEXT_LINES,
            max_bytes: DEFAULT_MAX_BYTES,
        }
    }
}

impl SourcePreviewer for FileSourcePreviewer {
    fn preview(&self, path: &Path, focus_line: u32) -> Result<SourcePreview, String> {
        if focus_line == 0 {
            return Err("源码预览行号必须大于 0".to_owned());
        }
        let metadata = fs::metadata(path)
            .map_err(|error| format!("无法读取源码文件 {}：{error}", path.display()))?;
        if metadata.len() > self.max_bytes {
            return Err(format!(
                "源码文件过大，无法预览：{}（上限 {} MiB）",
                path.display(),
                self.max_bytes / 1024 / 1024
            ));
        }
        let content = fs::read_to_string(path)
            .map_err(|error| format!("无法读取源码文件 {}：{error}", path.display()))?;
        let source_lines = content.lines().collect::<Vec<_>>();
        let focus_index = usize::try_from(focus_line - 1).map_err(|error| error.to_string())?;
        if focus_index >= source_lines.len() {
            return Err(format!(
                "源码位置超出文件范围：{}:{}",
                path.display(),
                focus_line
            ));
        }

        let start_index = focus_index.saturating_sub(self.context_lines);
        let end_index = (focus_index + self.context_lines + 1).min(source_lines.len());
        let lines = source_lines[start_index..end_index]
            .iter()
            .enumerate()
            .map(|(offset, text)| {
                let number = u32::try_from(start_index + offset + 1).unwrap_or(u32::MAX);
                SourcePreviewLine {
                    number,
                    text: (*text).to_owned(),
                    focus: number == focus_line,
                }
            })
            .collect();

        Ok(SourcePreview {
            path: path.display().to_string(),
            focus_line,
            start_line: u32::try_from(start_index + 1).unwrap_or(u32::MAX),
            end_line: u32::try_from(end_index).unwrap_or(u32::MAX),
            lines,
        })
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

        let previewer = FileSourcePreviewer {
            context_lines: 2,
            max_bytes: 1024,
        };
        let preview = previewer.preview(&path, 10).expect("preview");

        assert_eq!(preview.start_line, 8);
        assert_eq!(preview.end_line, 12);
        assert_eq!(preview.lines.len(), 5);
        assert_eq!(
            preview.lines.iter().find(|line| line.focus).unwrap().text,
            "line 10"
        );
    }

    #[test]
    fn rejects_line_outside_file() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("sample.rs");
        fs::write(&path, "one\n").expect("source");

        let error = FileSourcePreviewer::default()
            .preview(&path, 2)
            .expect_err("out of range");
        assert!(error.contains("超出文件范围"));
    }
}
