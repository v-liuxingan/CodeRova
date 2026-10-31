//! A bounded warm-session cache shared by entry validation and collection.
//! Leases are exclusive. Dropping an unfinished lease kills its child, so a
//! cancelled or partially read protocol stream can never re-enter the cache.
use super::{lsp::Session, provider::Language};
use serde_json::json;
use std::{
    collections::HashMap,
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
const IDLE_TIMEOUT: Duration = Duration::from_secs(300);
#[derive(Default)]
pub struct SessionCache {
    slot: Mutex<Option<Cached>>,
    shutting_down: AtomicBool,
}
struct Cached {
    key: Key,
    session: WarmSession,
    returned: Instant,
}
#[derive(PartialEq, Eq)]
struct Key {
    root: PathBuf,
    language: &'static str,
    fingerprint: u64,
}
pub struct WarmSession {
    pub transport: Session,
    opened: HashMap<String, String>,
}
pub struct Lease {
    owner: Arc<SessionCache>,
    key: Key,
    pub session: WarmSession,
    pub reused: bool,
}

impl WarmSession {
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
        let cached = slot.take();
        if let Some(mut cached) = cached {
            if cached.key == key
                && cached.returned.elapsed() < IDLE_TIMEOUT
                && cached.session.transport.is_alive()?
            {
                tracing::info!(language = key.language, "LSP warm session reused");
                drop(slot);
                return Ok(Self {
                    owner,
                    key,
                    session: cached.session,
                    reused: true,
                });
            }
            cached.session.transport.stop().await;
        }
        let started = Instant::now();
        let mut transport = language.start(&key.root, None)?;
        language
            .initialize(&mut transport, &key.root, "callgraph")
            .await?;
        tracing::info!(
            elapsed_ms = started.elapsed().as_millis(),
            language = key.language,
            "LSP cold initialization"
        );
        drop(slot);
        Ok(Self {
            owner,
            key,
            session: WarmSession {
                transport,
                opened: HashMap::new(),
            },
            reused: false,
        })
    }
    pub async fn release(self) {
        if self.owner.shutting_down.load(Ordering::Relaxed)
            || !self.session.transport.usable
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
        if let Some(old) = slot.take() {
            old.session.transport.stop().await;
        }
        *slot = Some(Cached {
            key: self.key,
            session: self.session,
            returned,
        });
        drop(slot);
        tokio::spawn(async move {
            tokio::time::sleep(IDLE_TIMEOUT).await;
            let mut slot = owner.slot.lock().await;
            if slot.as_ref().is_some_and(|c| c.returned == returned)
                && let Some(old) = slot.take()
            {
                old.session.transport.stop().await;
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
    pub async fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::Relaxed);
        let mut slot = self.slot.lock().await;
        if let Some(old) = slot.take() {
            old.session.transport.stop().await;
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
