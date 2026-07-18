use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Resolves a stable project id to the local checkout root for this machine.
pub trait ProjectCatalog: Send + Sync {
    fn resolve_root(&self, project_id: &str) -> Result<PathBuf, String>;
    fn projects(&self) -> Vec<ResolvedProject>;
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedProject {
    pub id: String,
    pub name: String,
    pub root: PathBuf,
    pub root_exists: bool,
}

#[derive(Debug, Clone)]
pub struct FileProjectCatalog {
    projects: HashMap<String, ResolvedProject>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectsFile {
    schema_version: String,
    projects: Vec<ProjectEntry>,
}

#[derive(Debug, Deserialize)]
struct ProjectEntry {
    id: String,
    name: String,
    root: PathBuf,
}

impl FileProjectCatalog {
    pub fn from_file(path: &Path) -> Result<Self, String> {
        let content = fs::read_to_string(path)
            .map_err(|error| format!("无法读取项目配置 {}：{error}", path.display()))?;
        let config: ProjectsFile = serde_json::from_str(&content)
            .map_err(|error| format!("无法解析项目配置 {}：{error}", path.display()))?;
        if config.schema_version != "0.1" {
            return Err(format!(
                "不支持项目配置 schemaVersion {:?}，当前仅支持 0.1",
                config.schema_version
            ));
        }
        let base = resolve_config_base(path)?;
        let mut ids = HashSet::new();
        let mut projects = HashMap::new();
        for entry in config.projects {
            validate_project_id(&entry.id)?;
            if !ids.insert(entry.id.clone()) {
                return Err(format!("项目 id 重复：{}", entry.id));
            }
            if entry.name.trim().is_empty() {
                return Err(format!("项目 {} 的 name 不能为空", entry.id));
            }
            if entry.root.as_os_str().is_empty() {
                return Err(format!("项目 {} 的 root 不能为空", entry.id));
            }
            let root = if entry.root.is_absolute() {
                entry.root
            } else {
                base.join(entry.root)
            };
            projects.insert(
                entry.id.clone(),
                ResolvedProject {
                    id: entry.id,
                    name: entry.name,
                    root_exists: root.is_dir(),
                    root,
                },
            );
        }
        Ok(Self { projects })
    }
}

impl ProjectCatalog for FileProjectCatalog {
    fn resolve_root(&self, project_id: &str) -> Result<PathBuf, String> {
        self.projects
            .get(project_id)
            .map(|project| project.root.clone())
            .ok_or_else(|| format!("项目配置中不存在 projectId：{project_id}"))
    }

    fn projects(&self) -> Vec<ResolvedProject> {
        let mut projects = self.projects.values().cloned().collect::<Vec<_>>();
        projects.sort_by(|left, right| left.id.cmp(&right.id));
        projects
    }
}

fn validate_project_id(project_id: &str) -> Result<(), String> {
    if project_id.is_empty()
        || !project_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(format!("项目 id 不合法：{project_id}"));
    }
    Ok(())
}

fn resolve_config_base(path: &Path) -> Result<PathBuf, String> {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
        .canonicalize()
        .map_err(|error| format!("无法定位项目配置所在目录：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_roots_from_config_location() {
        let directory = tempfile::tempdir().expect("temp dir");
        let checkout = directory.path().join("checkout");
        fs::create_dir(&checkout).expect("checkout dir");
        let config = directory.path().join("projects.json");
        fs::write(
            &config,
            r#"{"schemaVersion":"0.1","projects":[{"id":"demo","name":"Demo","root":"checkout"}]}"#,
        )
        .expect("config");

        let catalog = FileProjectCatalog::from_file(&config).expect("catalog");
        assert_eq!(
            catalog.resolve_root("demo").expect("project"),
            checkout.canonicalize().expect("canonical checkout")
        );
        assert!(catalog.projects()[0].root_exists);
    }

    #[test]
    fn rejects_duplicate_project_ids() {
        let directory = tempfile::tempdir().expect("temp dir");
        let config = directory.path().join("projects.json");
        fs::write(
            &config,
            r#"{"schemaVersion":"0.1","projects":[{"id":"demo","name":"One","root":"a"},{"id":"demo","name":"Two","root":"b"}]}"#,
        )
        .expect("config");

        let error = FileProjectCatalog::from_file(&config).expect_err("duplicate should fail");
        assert_eq!(error, "项目 id 重复：demo");
    }

    #[test]
    fn accepts_config_filename_without_explicit_parent() {
        let base = resolve_config_base(Path::new("projects.json")).expect("config base");
        assert_eq!(
            base,
            std::env::current_dir()
                .expect("current dir")
                .canonicalize()
                .expect("canonical current dir")
        );
    }
}
