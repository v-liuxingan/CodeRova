//! Multiplexed stdio transport. Only the reader owns framing; query cancellation
//! never drops a partially read frame. Session owns process/task lifetime.
use super::config::Collection;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    ops::Deref,
    path::Path,
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdout, Command},
    sync::{mpsc, oneshot, watch},
    task::JoinHandle,
    time::{Instant, timeout},
};

type Reply = Result<Value, Failure>;
#[derive(Debug)]
struct Failure {
    message: String,
    retryable: bool,
}
impl Failure {
    fn fatal(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: false,
        }
    }
}
struct Shared {
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    send: mpsc::Sender<Value>,
    next: AtomicU64,
    usable: AtomicBool,
    ready: watch::Sender<bool>,
    settings: Value,
    policy: Collection,
}
impl Shared {
    fn fail(&self, message: &str) {
        self.usable.store(false, Ordering::Relaxed);
        for (_, sender) in self.pending.lock().unwrap().drain() {
            let _ = sender.send(Err(Failure::fatal(message)));
        }
        self.ready.send_replace(false);
    }
}
#[derive(Clone)]
pub struct Client {
    shared: Arc<Shared>,
}
pub struct Session {
    child: Child,
    client: Client,
    reader: JoinHandle<()>,
    writer: JoinHandle<()>,
}
impl Deref for Session {
    type Target = Client;
    fn deref(&self) -> &Client {
        &self.client
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.client.shared.fail("语言服务器会话已关闭");
        self.reader.abort();
        self.writer.abort();
        // Child::kill_on_drop also handles aborted leases.
    }
}
impl Session {
    pub fn is_alive(&mut self) -> Result<bool, String> {
        Ok(self.usable() && self.child.try_wait().map_err(|e| e.to_string())?.is_none())
    }
    pub fn client(&self) -> Client {
        self.client.clone()
    }
    pub fn start(
        server: &Path,
        args: &[String],
        root: &Path,
        policy: Collection,
        settings: Value,
    ) -> Result<Self, String> {
        let mut child = Command::new(server)
            .args(args)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("启动语言服务器失败：{e}"))?;
        let mut input = child.stdin.take().unwrap();
        let mut output = BufReader::new(child.stdout.take().unwrap());
        let (send, mut receive) = mpsc::channel::<Value>(128);
        let (ready, _) = watch::channel(false);
        let shared = Arc::new(Shared {
            pending: Mutex::new(HashMap::new()),
            send,
            next: AtomicU64::new(1),
            usable: AtomicBool::new(true),
            ready,
            settings,
            policy,
        });
        let weak = Arc::downgrade(&shared);
        let writer = tokio::spawn(async move {
            while let Some(value) = receive.recv().await {
                let result = async {
                    let body = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
                    input
                        .write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
                        .await
                        .map_err(|e| e.to_string())?;
                    input.write_all(&body).await.map_err(|e| e.to_string())?;
                    input.flush().await.map_err(|e| e.to_string())
                }
                .await;
                if let Err(error) = result {
                    if let Some(state) = weak.upgrade() {
                        state.fail(&error);
                    }
                    break;
                }
            }
        });
        let weak = Arc::downgrade(&shared);
        let reader = tokio::spawn(async move {
            loop {
                let message = read_frame(&mut output).await;
                let Some(state) = weak.upgrade() else {
                    break;
                };
                let value = match message {
                    Ok(value) => value,
                    Err(error) => {
                        state.fail(&error);
                        break;
                    }
                };
                if let Some(method) = value["method"].as_str() {
                    if method == "experimental/serverStatus" {
                        state
                            .ready
                            .send_replace(value["params"]["quiescent"].as_bool().unwrap_or(false));
                    }
                    if method == "language/status" && value["params"]["type"] == "Started" {
                        state.ready.send_replace(true);
                    }
                    if let Some(id) = value.get("id") {
                        let response = server_response(&state.settings, method, &value);
                        let response = match response {
                            Some(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
                            None => {
                                json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Unsupported client request"}})
                            }
                        };
                        if state.send.send(response).await.is_err() {
                            state.fail("语言服务器写入已关闭");
                            break;
                        }
                    }
                } else if let Some(id) = value["id"].as_u64() {
                    let sender = state.pending.lock().unwrap().remove(&id);
                    if let Some(sender) = sender {
                        let reply = if let Some(error) = value.get("error") {
                            Err(Failure {
                                message: error.to_string(),
                                retryable: matches!(
                                    error["code"].as_i64(),
                                    Some(-32603 | -32801 | -32802)
                                ),
                            })
                        } else {
                            value
                                .get("result")
                                .cloned()
                                .ok_or_else(|| Failure::fatal("LSP 响应缺少 result"))
                        };
                        let _ = sender.send(reply);
                    } // Cancelled/expired request IDs cannot update a later request.
                }
            }
        });
        Ok(Self {
            child,
            client: Client { shared },
            reader,
            writer,
        })
    }
    pub async fn stop(mut self) {
        let _ = self.request("shutdown", Value::Null, 3).await;
        let _ = self.notify("exit", Value::Null).await;
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
}
struct Pending {
    state: Arc<Shared>,
    id: u64,
}
impl Drop for Pending {
    fn drop(&mut self) {
        let removed = self
            .state
            .pending
            .lock()
            .unwrap()
            .remove(&self.id)
            .is_some();
        if removed {
            let message =
                json!({"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":self.id}});
            if self.state.send.try_send(message).is_err() {
                self.state.fail("取消请求无法发送");
            }
        }
    }
}
impl Client {
    pub fn usable(&self) -> bool {
        self.shared.usable.load(Ordering::Relaxed)
    }
    pub fn settings(&self) -> &Value {
        &self.shared.settings
    }
    pub fn policy(&self) -> Collection {
        self.shared.policy
    }
    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        timeout(
            Duration::from_secs(self.policy().request_timeout_seconds),
            self.shared
                .send
                .send(json!({"jsonrpc":"2.0","method":method,"params":params})),
        )
        .await
        .map_err(|_| "LSP 通知排队超时")?
        .map_err(|_| "LSP 写入已关闭".into())
    }
    async fn once(&self, method: &str, params: Value, seconds: u64) -> Reply {
        if !self.usable() {
            return Err(Failure::fatal("语言服务器会话不可用"));
        }
        let id = self.shared.next.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.shared.pending.lock().unwrap().insert(id, sender);
        let _pending = Pending {
            state: self.shared.clone(),
            id,
        };
        let started = Instant::now();
        let result = timeout(Duration::from_secs(seconds), async {
            self.shared
                .send
                .send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
                .await
                .map_err(|_| Failure::fatal("LSP 写入已关闭"))?;
            receiver
                .await
                .map_err(|_| Failure::fatal("LSP 响应通道关闭"))?
        })
        .await
        .unwrap_or_else(|_| {
            Err(Failure {
                message: format!("超时（{seconds}s），已请求取消"),
                retryable: true,
            })
        });
        tracing::debug!(
            method,
            request_id = id,
            elapsed_ms = started.elapsed().as_millis(),
            ok = result.is_ok(),
            "LSP request"
        );
        result
    }
    pub async fn request(
        &self,
        method: &str,
        params: Value,
        seconds: u64,
    ) -> Result<Value, String> {
        let query = method.starts_with("textDocument/") || method.starts_with("callHierarchy/");
        let retries = if query { self.policy().max_retries } else { 0 };
        let seconds = if query {
            self.policy().request_timeout_seconds
        } else {
            seconds
        };
        for attempt in 0..=retries {
            match self.once(method, params.clone(), seconds).await {
                Ok(value) => return Ok(value),
                Err(error) => {
                    if !error.retryable || !self.usable() || attempt == retries {
                        return Err(format!(
                            "{method}: {}（尝试 {} 次）",
                            error.message,
                            attempt + 1
                        ));
                    }
                    tracing::warn!(method, retry=attempt+1, error=%error.message, "LSP query retry");
                    tokio::time::sleep(Duration::from_millis(100 * (attempt as u64 + 1))).await;
                }
            }
        }
        unreachable!()
    }
    pub async fn wait_ready(&self, seconds: u64) -> Result<(), String> {
        let started = Instant::now();
        let mut ready = self.shared.ready.subscribe();
        timeout(Duration::from_secs(seconds), async {
            loop {
                if !self.usable() {
                    return Err("语言服务器会话不可用".to_owned());
                }
                if *ready.borrow_and_update() {
                    return Ok(());
                }
                ready
                    .changed()
                    .await
                    .map_err(|_| "语言服务器已关闭".to_owned())?;
            }
        })
        .await
        .map_err(|_| "等待语言服务器索引完成超时".to_owned())??;
        tracing::info!(
            elapsed_ms = started.elapsed().as_millis(),
            "LSP readiness wait"
        );
        Ok(())
    }
}
fn server_response(settings: &Value, method: &str, value: &Value) -> Option<Value> {
    match method {
        "workspace/configuration" => Some(Value::Array(
            value["params"]["items"]
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .map(|item| {
                            let mut value = settings;
                            for part in item["section"]
                                .as_str()
                                .unwrap_or("")
                                .split('.')
                                .filter(|s| !s.is_empty())
                            {
                                value = &value[part];
                            }
                            value.clone()
                        })
                        .collect()
                })
                .unwrap_or_default(),
        )),
        "window/workDoneProgress/create"
        | "client/registerCapability"
        | "client/unregisterCapability" => Some(Value::Null),
        "workspace/applyEdit" => {
            Some(json!({"applied":false,"failureReason":"Read-only analysis client"}))
        }
        _ => None,
    }
}
async fn read_frame(output: &mut BufReader<ChildStdout>) -> Result<Value, String> {
    let mut length = None;
    let mut total = 0;
    loop {
        let mut line = String::new();
        let bytes = output
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?;
        if bytes == 0 {
            return Err("语言服务器已关闭输出".into());
        }
        total += bytes;
        if total > 8192 {
            return Err("LSP 消息头过大".into());
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((key, value)) = line.split_once(':')
            && key.eq_ignore_ascii_case("Content-Length")
        {
            length = value.trim().parse::<usize>().ok();
        }
    }
    let length = length
        .filter(|n| *n <= 32 * 1024 * 1024)
        .ok_or("LSP 消息长度无效")?;
    let mut body = vec![0; length];
    output
        .read_exact(&mut body)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::from_slice(&body).map_err(|e| format!("无效 LSP JSON：{e}"))
}
