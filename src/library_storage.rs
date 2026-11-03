use crate::graph_store::write_atomic;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
#[derive(Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Library {
    pub directories: BTreeMap<String, String>,
    pub groups: Vec<Group>,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Group {
    pub project: String,
    pub id: String,
    pub name: String,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum Change {
    #[serde(rename_all = "camelCase")]
    RenameDirectory { project_id: String, name: String },
    #[serde(rename_all = "camelCase")]
    UpsertGroup {
        project_id: String,
        group_id: String,
        name: String,
    },
    #[serde(rename_all = "camelCase")]
    DeleteGroup {
        project_id: String,
        group_id: String,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    root: PathBuf,
}
pub struct LibraryStorage {
    pub root: PathBuf,
    pub config_path: PathBuf,
    lock: Mutex<()>,
    overridden: bool,
}
impl LibraryStorage {
    pub fn open(graphs: PathBuf, projects_config: &Path) -> Result<Self, String> {
        let base = projects_config
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."))
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let config_path = base.join("coderova.storage.json");
        let overridden = graphs != Path::new("graphs");
        let root = if graphs == Path::new("graphs") && config_path.exists() {
            let config: Config =
                serde_json::from_slice(&fs::read(&config_path).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            if config.root.is_absolute() {
                config.root
            } else {
                base.join(config.root)
            }
        } else {
            graphs
        };
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        Ok(Self {
            root: root.canonicalize().map_err(|e| e.to_string())?,
            config_path,
            overridden,
            lock: Mutex::new(()),
        })
    }
    fn catalog_path(&self) -> Result<PathBuf, String> {
        let dir = self.root.join(".coderova");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        if !dir
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(&self.root)
        {
            return Err("资料库配置目录越界".into());
        }
        let path = dir.join("library.json");
        if path.exists()
            && !path
                .canonicalize()
                .map_err(|e| e.to_string())?
                .starts_with(&self.root)
        {
            return Err("资料库配置文件越界".into());
        }
        Ok(path)
    }
    pub fn read(&self) -> Result<Library, String> {
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        self.read_unlocked()
    }
    fn read_unlocked(&self) -> Result<Library, String> {
        let path = self.catalog_path()?;
        if !path.exists() {
            return Ok(Library::default());
        }
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    }
    pub fn change(&self, change: Change) -> Result<Library, String> {
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        let mut doc = self.read_unlocked()?;
        match change {
            Change::RenameDirectory { project_id, name } => {
                valid_id(&project_id)?;
                valid_name(&name, 120)?;
                doc.directories.insert(project_id, name.trim().into());
            }
            Change::UpsertGroup {
                project_id,
                group_id,
                name,
            } => {
                valid_id(&project_id)?;
                valid_id(&group_id)?;
                valid_name(&name, 40)?;
                if doc
                    .groups
                    .iter()
                    .any(|g| g.project == project_id && g.id != group_id && g.name == name.trim())
                {
                    return Err("同项目下已有同名分组".into());
                }
                if let Some(group) = doc
                    .groups
                    .iter_mut()
                    .find(|g| g.project == project_id && g.id == group_id)
                {
                    group.name = name.trim().into();
                } else {
                    if doc.groups.len() >= 10000 {
                        return Err("分组数量已达上限".into());
                    }
                    doc.groups.push(Group {
                        project: project_id,
                        id: group_id,
                        name: name.trim().into(),
                    });
                }
            }
            Change::DeleteGroup {
                project_id,
                group_id,
            } => {
                valid_id(&project_id)?;
                valid_id(&group_id)?;
                doc.groups
                    .retain(|g| g.project != project_id || g.id != group_id);
            }
        }
        write_atomic(
            &self.catalog_path()?,
            &serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?,
        )?;
        Ok(doc)
    }
    pub fn info(&self) -> Result<serde_json::Value, String> {
        let next = if self.config_path.exists() {
            let cfg: Config =
                serde_json::from_slice(&fs::read(&self.config_path).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            if cfg.root.is_absolute() {
                cfg.root
            } else {
                self.config_path.parent().unwrap().join(cfg.root)
            }
        } else {
            self.root.clone()
        };
        let next = next.canonicalize().unwrap_or(next);
        Ok(
            serde_json::json!({"root":crate::project_catalog::tool_path(&self.root),"nextRoot":crate::project_catalog::tool_path(&next),"configFile":crate::project_catalog::tool_path(&self.config_path),"defaultRoot":"graphs","restartRequired":next!=self.root && !self.overridden,"commandLineOverride":self.overridden}),
        )
    }
    pub fn configure(&self, path: &Path) -> Result<(), String> {
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        let root = path.canonicalize().map_err(|e| e.to_string())?;
        if !root.is_dir() {
            return Err("请选择存在的目录".into());
        }
        write_atomic(
            &self.config_path,
            &serde_json::to_vec_pretty(&Config {
                root: crate::project_catalog::tool_path(&root),
            })
            .map_err(|e| e.to_string())?,
        )
    }
}
pub fn valid_name(name: &str, max: usize) -> Result<(), String> {
    if name.trim().is_empty() || name.chars().count() > max || name.chars().any(char::is_control) {
        Err(format!("名称不能为空、含控制字符或超过 {max} 字"))
    } else {
        Ok(())
    }
}
fn valid_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 200
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Err("无效目录标识".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configured_root_and_explicit_override_are_distinct() {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("projects.json");
        fs::write(
            temp.path().join("coderova.storage.json"),
            br#"{"root":"library"}"#,
        )
        .unwrap();
        let storage = LibraryStorage::open("graphs".into(), &config).unwrap();
        assert_eq!(
            storage.root,
            temp.path().join("library").canonicalize().unwrap()
        );
        assert_eq!(storage.info().unwrap()["restartRequired"], false);
        storage.configure(&storage.root).unwrap();
        assert_eq!(storage.info().unwrap()["restartRequired"], false);
        let other = temp.path().join("override");
        let explicit = LibraryStorage::open(other.clone(), &config).unwrap();
        assert_eq!(explicit.root, other.canonicalize().unwrap());
        assert_eq!(explicit.info().unwrap()["commandLineOverride"], true);
    }
    #[test]
    fn catalog_survives_reload_and_names_do_not_change_ids() {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("projects.json");
        let root = temp.path().join("library");
        let storage = LibraryStorage::open(root.clone(), &config).unwrap();
        storage
            .change(Change::RenameDirectory {
                project_id: "project".into(),
                name: "我的项目".into(),
            })
            .unwrap();
        for name in ["旧分组", "新分组"] {
            storage
                .change(Change::UpsertGroup {
                    project_id: "project".into(),
                    group_id: "stable".into(),
                    name: name.into(),
                })
                .unwrap();
        }
        let doc = LibraryStorage::open(root, &config).unwrap().read().unwrap();
        assert_eq!(doc.directories["project"], "我的项目");
        assert_eq!(doc.groups.len(), 1);
        assert_eq!(doc.groups[0].id, "stable");
        assert_eq!(doc.groups[0].name, "新分组");
        assert!(
            storage
                .change(Change::UpsertGroup {
                    project_id: "project".into(),
                    group_id: "other".into(),
                    name: "新分组".into()
                })
                .is_err()
        );
        assert!(
            storage
                .change(Change::RenameDirectory {
                    project_id: "../outside".into(),
                    name: "test".into()
                })
                .is_err()
        );
        storage
            .change(Change::DeleteGroup {
                project_id: "project".into(),
                group_id: "stable".into(),
            })
            .unwrap();
        assert!(storage.read().unwrap().groups.is_empty());
    }
}
