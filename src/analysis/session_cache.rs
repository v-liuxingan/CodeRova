//! A bounded warm-session cache shared by entry validation and collection.
//! Leases are exclusive. Dropping an unfinished lease kills its child, so a
//! cancelled or partially read protocol stream can never re-enter the cache.
use super::{lsp::Session, provider::Language};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use tokio::sync::Mutex;
const MAX_SESSIONS: usize = 2;
const IDLE_TIMEOUT: Duration = Duration::from_secs(300);
#[derive(Default)]
pub struct SessionCache {
    slot: Mutex<Vec<Cached>>,
    shutting_down: AtomicBool,
    active: Arc<std::sync::Mutex<HashSet<(PathBuf, String)>>>,
    pinned: std::sync::Mutex<HashSet<(PathBuf, String)>>,
}
struct Cached {
    key: Key,
    session: WarmSession,
    returned: Instant,
}
#[derive(Clone, PartialEq, Eq)]
struct Key {
    root: PathBuf,
    language: &'static str,
    fingerprint: u64,
}
pub struct WarmSession {
    pub transport: Session,
    opened: HashMap<String, String>,
}
struct Activity {
    active: Arc<std::sync::Mutex<HashSet<(PathBuf, String)>>>,
    key: (PathBuf, String),
}
impl Drop for Activity {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.key);
        }
    }
}
pub struct Lease {
    owner: Arc<SessionCache>,
    key: Key,
    pub session: WarmSession,
    pub reused: bool,
    _activity: Activity,
}

impl WarmSession {
    pub fn from_open(transport: Session, uri: String, text: String) -> Self {
        Self {
            transport,
            opened: HashMap::from([(uri, text)]),
        }
    }

    pub async fn open(&mut self, uri: &str, language: Language, text: &str) -> Result<(), String> {
        if let Some(previous) = self.opened.get(uri) {
            if previous != text {
                return Err("源码已变化，请重新采集".into());
            }
            return Ok(());
        }
        self.transport.notify("textDocument/didOpen",json!({"textDocument":{"uri":uri,"languageId":language.id(),"version":1,"text":text}})).await?;
        self.opened.insert(uri.into(), text.into());
        Ok(())
    }
}
impl Lease {
    pub async fn acquire(
        owner: Arc<SessionCache>,
        root: &Path,
        language: Language,
    ) -> Result<Self, String> {
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        let activity_key = (root.clone(), language.id().to_owned());
        if !owner
            .active
            .lock()
            .map_err(|e| e.to_string())?
            .insert(activity_key.clone())
        {
            return Err("语言服务器正在使用，请稍后再试".into());
        }
        let activity = Activity {
            active: owner.active.clone(),
            key: activity_key,
        };
        let snapshot_started = Instant::now();
        let snapshot_root = root.clone();
        let fingerprint = tokio::task::spawn_blocking(move || fingerprint(&snapshot_root))
            .await
            .map_err(|e| e.to_string())??;
        tracing::info!(
            elapsed_ms = snapshot_started.elapsed().as_millis(),
            "LSP source fingerprint"
        );
        let key = Key {
            root,
            language: language.id(),
            fingerprint,
        };
        let mut slot = owner.slot.lock().await;
        if owner.shutting_down.load(Ordering::Relaxed) {
            return Err("语言服务器缓存正在关闭".into());
        }
        if let Some(index) = slot
            .iter()
            .position(|cached| cached.key.root == key.root && cached.key.language == key.language)
        {
            let mut cached = slot.remove(index);
            if cached.key == key
                && (cached.returned.elapsed() < IDLE_TIMEOUT
                    || owner
                        .pinned
                        .lock()
                        .unwrap()
                        .contains(&(key.root.clone(), key.language.to_owned())))
                && cached.session.transport.is_alive()?
            {
                tracing::info!(language = key.language, "LSP warm session reused");
                drop(slot);
                return Ok(Self {
                    owner,
                    key,
                    session: cached.session,
                    reused: true,
                    _activity: activity,
                });
            }
            cached.session.transport.stop().await;
        }
        // Reserve room before starting a cold process; keep the most recently
        // returned sessions. Never evict or share an active lease.
        while slot.len() + owner.active.lock().unwrap().len() > MAX_SESSIONS {
            let index = slot
                .iter()
                .position(|c| {
                    !owner
                        .pinned
                        .lock()
                        .unwrap()
                        .contains(&(c.key.root.clone(), c.key.language.to_owned()))
                })
                .ok_or("已达到运行上限，请先停止一个语言服务器")?;
            slot.remove(index).session.transport.stop().await;
        }
        let started = Instant::now();
        let transport = language.start(&key.root, None)?;
        drop(slot);
        language
            .initialize(&transport, &key.root, "callgraph")
            .await?;
        tracing::info!(
            elapsed_ms = started.elapsed().as_millis(),
            language = key.language,
            "LSP cold initialization"
        );
        Ok(Self {
            owner,
            key,
            session: WarmSession {
                transport,
                opened: HashMap::new(),
            },
            reused: false,
            _activity: activity,
        })
    }
    pub async fn release(self) {
        if self.owner.shutting_down.load(Ordering::Relaxed)
            || !self.session.transport.usable()
            || self.session.opened.values().map(String::len).sum::<usize>() > 32 * 1024 * 1024
        {
            return;
        }
        let returned = Instant::now();
        let owner = self.owner;
        let mut slot = owner.slot.lock().await;
        if owner.shutting_down.load(Ordering::Relaxed) {
            return;
        }
        if let Some(index) = slot.iter().position(|cached| {
            cached.key.root == self.key.root && cached.key.language == self.key.language
        }) {
            slot.remove(index).session.transport.stop().await;
        }
        if slot.len() >= MAX_SESSIONS {
            let index = slot.iter().position(|c| {
                !owner
                    .pinned
                    .lock()
                    .unwrap()
                    .contains(&(c.key.root.clone(), c.key.language.to_owned()))
            });
            let Some(index) = index else {
                return;
            };
            slot.remove(index).session.transport.stop().await;
        }
        let expiry_key = self.key.clone();
        slot.push(Cached {
            key: self.key,
            session: self.session,
            returned,
        });
        drop(self._activity);
        drop(slot);
        tokio::spawn(async move {
            tokio::time::sleep(IDLE_TIMEOUT).await;
            let mut slot = owner.slot.lock().await;
            if owner
                .pinned
                .lock()
                .unwrap()
                .contains(&(expiry_key.root.clone(), expiry_key.language.to_owned()))
            {
                return;
            }
            // An older timer must not expire a session that has since been reused.
            if let Some(index) = slot
                .iter()
                .position(|cached| cached.key == expiry_key && cached.returned == returned)
            {
                slot.remove(index).session.transport.stop().await;
            }
        });
    }
}

// Hash actual contents, not just mtime: edits with preserved timestamps must
// invalidate opaque LSP identities and project/build state. No graph data is cached.
fn fingerprint(root: &Path) -> Result<u64, String> {
    fn walk(dir: &Path, paths: &mut Vec<PathBuf>) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                if !matches!(
                    entry.file_name().to_str(),
                    Some(".git" | "target" | "node_modules" | "build" | ".gradle")
                ) {
                    walk(&path, paths)?;
                }
            } else if matches!(
                path.extension().and_then(|e| e.to_str()),
                Some("rs" | "java" | "toml" | "gradle" | "kts" | "xml" | "properties" | "lock")
            ) {
                paths.push(path);
            }
        }
        Ok(())
    }
    let mut paths = vec![];
    walk(root, &mut paths)?;
    paths.sort();
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    for path in paths {
        path.hash(&mut hash);
        fs::read(path).map_err(|e| e.to_string())?.hash(&mut hash);
    }
    let config = std::env::var_os("CALLGRAPH_LSP_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("callgraph.lsp.local.json"));
    config.hash(&mut hash);
    match fs::read(config) {
        Ok(bytes) => bytes.hash(&mut hash),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    Ok(hash.finish())
}
impl SessionCache {
    pub async fn status(&self, root: &Path, language: Language) -> Result<&'static str, String> {
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        if self
            .active
            .lock()
            .map_err(|e| e.to_string())?
            .contains(&(root.clone(), language.id().into()))
        {
            return Ok("busy");
        }
        let mut slot = self.slot.lock().await;
        if let Some(cached) = slot
            .iter_mut()
            .find(|c| c.key.root == root && c.key.language == language.id())
            && cached.session.transport.is_alive()?
        {
            return Ok("running");
        }
        Ok("stopped")
    }
    pub fn pin(&self, root: &Path, language: Language) -> Result<(), String> {
        self.pinned.lock().map_err(|e| e.to_string())?.insert((
            root.canonicalize().map_err(|e| e.to_string())?,
            language.id().into(),
        ));
        Ok(())
    }
    pub async fn stop_project(&self, root: &Path, language: Language) -> Result<(), String> {
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        if self
            .active
            .lock()
            .map_err(|e| e.to_string())?
            .contains(&(root.clone(), language.id().into()))
        {
            return Err("语言服务器正在使用，请先停止采集或等待入口校验完成".into());
        }
        let mut slot = self.slot.lock().await;
        self.pinned
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&(root.clone(), language.id().into()));
        if let Some(i) = slot
            .iter()
            .position(|c| c.key.root == root && c.key.language == language.id())
        {
            slot.remove(i).session.transport.stop().await;
        }
        Ok(())
    }
    pub async fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::Relaxed);
        let mut slot = self.slot.lock().await;
        for cached in slot.drain(..) {
            cached.session.transport.stop().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fingerprint_tracks_nested_source_build_changes_and_deletions() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("module/src");
        fs::create_dir_all(&nested).unwrap();
        let file = nested.join("Entry.java");
        fs::write(&file, "class A {}").unwrap();
        let a = fingerprint(dir.path()).unwrap();
        fs::write(&file, "class B {}").unwrap();
        let b = fingerprint(dir.path()).unwrap();
        assert_ne!(a, b);
        fs::write(dir.path().join("build.gradle"), "plugins {}").unwrap();
        let c = fingerprint(dir.path()).unwrap();
        assert_ne!(b, c);
        fs::remove_file(file).unwrap();
        assert_ne!(c, fingerprint(dir.path()).unwrap());
    }
}
