use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Resolves a stable project id to the local checkout root for this machine.
pub trait ProjectCatalog: Send + Sync {
    fn register(&self, _name: &str, _root: &Path) -> Result<ResolvedProject, String> {
        Err("当前项目目录不支持接入项目".into())
    }

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
    projects: std::sync::Arc<std::sync::Mutex<HashMap<String, ResolvedProject>>>,
    config_path: PathBuf,
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
        Ok(Self {
            projects: std::sync::Arc::new(std::sync::Mutex::new(projects)),
            config_path: path.canonicalize().map_err(|e| e.to_string())?,
        })
    }
}

impl ProjectCatalog for FileProjectCatalog {
    fn register(&self, name: &str, root: &Path) -> Result<ResolvedProject, String> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 120 {
            return Err("项目名称需为1–120个字符".into());
        }
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        if !root.is_dir() {
            return Err("请选择源码目录".into());
        }
        let mut projects = self.projects.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = projects
            .values()
            .find(|p| p.root.canonicalize().ok().as_ref() == Some(&root))
        {
            return Ok(existing.clone());
        }
        let id = format!(
            "project-{}",
            crate::analysis::stable_id(&root.to_string_lossy())
        );
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&self.config_path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let entries = value["projects"].as_array_mut().ok_or("项目配置格式无效")?;
        if entries.iter().any(|p| p["id"] == id) {
            return Err("项目配置已变化，请重启后重试".into());
        }
        entries.push(serde_json::json!({"id":id,"name":name,"root":root}));
        let content = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;
        crate::graph_store::write_atomic(&self.config_path, &content)?;
        let project = ResolvedProject {
            id,
            name: name.into(),
            root,
            root_exists: true,
        };
        projects.insert(project.id.clone(), project.clone());
        Ok(project)
    }

    fn resolve_root(&self, project_id: &str) -> Result<PathBuf, String> {
        self.projects
            .lock()
            .map_err(|e| e.to_string())?
            .get(project_id)
            .map(|project| project.root.clone())
            .ok_or_else(|| format!("项目配置中不存在 projectId：{project_id}"))
    }

    fn projects(&self) -> Vec<ResolvedProject> {
        let mut projects = self
            .projects
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect::<Vec<_>>();
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
    fn registration_persists_and_reuses_existing_directory() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("projects.json");
        fs::write(&config, r#"{"schemaVersion":"0.1","projects":[]}"#).unwrap();
        let source = dir.path().join("source");
        fs::create_dir(&source).unwrap();
        let catalog = FileProjectCatalog::from_file(&config).unwrap();
        let project = catalog.register("New project", &source).unwrap();
        assert_eq!(
            catalog.resolve_root(&project.id).unwrap(),
            source.canonicalize().unwrap()
        );
        assert_eq!(
            catalog.register("Duplicate", &source).unwrap().id,
            project.id
        );
        assert_eq!(
            FileProjectCatalog::from_file(&config)
                .unwrap()
                .projects()
                .len(),
            1
        );
        assert!(catalog.register("", &source).is_err());
        assert!(
            catalog
                .register("Missing", &dir.path().join("missing"))
                .is_err()
        );
    }

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
