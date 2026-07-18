use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Opens a verified source location in an external editor.
///
/// The default implementation launches VSCode. Future implementations may use
/// a VSCode extension URI, another editor, or a remote-development bridge.
pub trait SourceNavigator: Send + Sync {
    fn is_available(&self) -> bool;
    fn open(&self, path: &Path, line: u32) -> Result<(), String>;
}

#[derive(Debug, Clone)]
pub struct VscodeCommandNavigator {
    executable: PathBuf,
}

impl VscodeCommandNavigator {
    pub fn new(executable: PathBuf) -> Self {
        Self { executable }
    }
}

impl SourceNavigator for VscodeCommandNavigator {
    fn is_available(&self) -> bool {
        self.executable.is_file()
    }

    fn open(&self, path: &Path, line: u32) -> Result<(), String> {
        if !self.is_available() {
            return Err(format!(
                "找不到 VSCode 可执行文件：{}",
                self.executable.display()
            ));
        }
        if line == 0 {
            return Err("行号必须大于 0".to_owned());
        }
        let target = format!("{}:{line}", path.display());
        let extension = self
            .executable
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        let mut command = if cfg!(windows)
            && (extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat"))
        {
            // Keep paths out of the PowerShell program text. Environment variables
            // avoid quoting bugs and command injection for spaces or metacharacters.
            let mut command = Command::new("powershell.exe");
            command
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-WindowStyle",
                    "Hidden",
                    "-Command",
                    "& $env:CODEX_CALLGRAPH_EDITOR --goto $env:CODEX_CALLGRAPH_TARGET",
                ])
                .env("CODEX_CALLGRAPH_EDITOR", &self.executable)
                .env("CODEX_CALLGRAPH_TARGET", &target);
            command
        } else {
            let mut command = Command::new(&self.executable);
            command.arg("--goto").arg(&target);
            command
        };
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("启动 VSCode 失败：{error}"))?;
        Ok(())
    }
}

#[cfg(test)]
pub struct RecordingNavigator {
    pub available: bool,
    pub opened: std::sync::Mutex<Vec<(PathBuf, u32)>>,
}

#[cfg(test)]
impl SourceNavigator for RecordingNavigator {
    fn is_available(&self) -> bool {
        self.available
    }

    fn open(&self, path: &Path, line: u32) -> Result<(), String> {
        self.opened
            .lock()
            .map_err(|_| "recording navigator lock poisoned".to_owned())?
            .push((path.to_owned(), line));
        Ok(())
    }
}
