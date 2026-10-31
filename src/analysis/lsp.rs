//! A sequential, bounded stdio LSP client. The child is always killed on drop.
use serde_json::{Value, json};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::{Instant, timeout_at},
};

pub struct Session {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    id: u64,
    pub ready: bool,
    pub usable: bool,
    pub settings: Value,
}

impl Session {
    pub fn is_alive(&mut self) -> Result<bool, String> {
        Ok(self.usable && self.child.try_wait().map_err(|e| e.to_string())?.is_none())
    }

    pub fn start(server: &Path, args: &[String], root: &Path) -> Result<Self, String> {
        let mut child = Command::new(server)
            .args(args)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("启动语言服务器失败：{e}"))?;
        Ok(Self {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
            id: 0,
            ready: false,
            usable: true,
            settings: Value::Null,
        })
    }

    async fn send(&mut self, value: Value) -> Result<(), String> {
        let body = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
        self.input
            .write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        self.input
            .write_all(&body)
            .await
            .map_err(|e| e.to_string())?;
        self.input.flush().await.map_err(|e| e.to_string())
    }

    pub async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.send(json!({"jsonrpc":"2.0", "method":method, "params":params}))
            .await
    }

    async fn read(&mut self) -> Result<Value, String> {
        let mut length = None;
        let mut total = 0;
        loop {
            let mut line = String::new();
            let bytes = self
                .output
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
        self.output
            .read_exact(&mut body)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::from_slice(&body).map_err(|e| format!("无效 LSP JSON：{e}"))
    }

    async fn handle(&mut self, value: &Value) -> Result<(), String> {
        let method = value["method"].as_str().unwrap_or("");
        if method == "experimental/serverStatus" {
            self.ready = value["params"]["quiescent"].as_bool().unwrap_or(false);
        }
        if method == "language/status" && value["params"]["type"] == "Started" {
            self.ready = true;
        }
        if let Some(id) = value.get("id").filter(|_| !method.is_empty()) {
            let result = match method {
                "workspace/configuration" => Some(Value::Array(
                    value["params"]["items"]
                        .as_array()
                        .map(|items| {
                            items
                                .iter()
                                .map(|item| {
                                    let mut value = &self.settings;
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
            };
            self.send(match result {
                Some(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
                None => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Unsupported client request"}}),
            }).await?;
        }
        Ok(())
    }

    pub async fn request(
        &mut self,
        method: &str,
        params: Value,
        seconds: u64,
    ) -> Result<Value, String> {
        // Partial reads/timeouts cannot safely resume the framed stream. A
        // complete matching response, including an RPC error, can resume.
        self.usable = false;
        self.id += 1;
        let id = self.id;
        let deadline = Instant::now() + Duration::from_secs(seconds);
        let started = Instant::now();
        let result = timeout_at(deadline, async {
            self.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
                .await?;
            loop {
                let value = self.read().await?;
                if value.get("method").is_none() && value["id"] == id {
                    self.usable = true;
                    if let Some(error) = value.get("error") {
                        return Err(format!("{method}: {error}"));
                    }
                    return value
                        .get("result")
                        .cloned()
                        .ok_or_else(|| "LSP 响应缺少 result".into());
                }
                self.handle(&value).await?;
            }
        })
        .await
        .map_err(|_| format!("{method} 超时（{seconds}s），此次会话不可继续"))?;
        tracing::debug!(
            method,
            elapsed_ms = started.elapsed().as_millis(),
            ok = result.is_ok(),
            "LSP request"
        );
        result
    }

    pub async fn wait_ready(&mut self, seconds: u64) -> Result<(), String> {
        let started = Instant::now();
        let result = timeout_at(Instant::now() + Duration::from_secs(seconds), async {
            while !self.ready {
                let value = self.read().await?;
                self.handle(&value).await?;
            }
            Ok(())
        })
        .await
        .map_err(|_| "等待语言服务器索引完成超时".to_owned())?;
        tracing::info!(
            elapsed_ms = started.elapsed().as_millis(),
            ok = result.is_ok(),
            "LSP readiness wait"
        );
        result
    }

    pub async fn stop(mut self) {
        let _ = self.request("shutdown", Value::Null, 3).await;
        let _ = self.notify("exit", Value::Null).await;
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
}
