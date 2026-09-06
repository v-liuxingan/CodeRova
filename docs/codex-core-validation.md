# Codex 核心功能系统性验证

## 验证基线

- 源码仓库：本地 `codex`
- 提交：`a68d0a74bd38ddc01361ce42262da689b788afce`
- 验证方式：逐层阅读真实调用点，以函数定义和调用表达式的相对路径、行号作为证据
- 范围：选择能跨越 CLI/TUI、App Server、Core、模型传输、工具系统、审批沙箱和持久化存储的代表性主链

这不是“扫描到同名函数就连线”的文本索引。每条边都区分直接调用、异步任务、通道、
Trait 分发、回调、远程协议和跨阶段数据流；无法从调用表达式直接确认的动态边会降低
`confidence`。

## 覆盖矩阵

| 调用图 | 核心问题 | 主要模块 | 节点/边 |
| --- | --- | --- | --- |
| `codex-end-to-end-agent-loop` | 一条用户输入如何完成上下文、模型、工具、回写和压缩闭环 | TUI、App Server、Core、Model Client、Tool Runtime、Compact | 53 / 73 |
| `tui-authorization` | 模型请求如何获得认证 | CLI、TUI、App Server、Core | 23 / 23 |
| `codex-turn-lifecycle` | 用户输入如何成为模型采样回合 | TUI、App Server、Core、Model Client | 20 / 21 |
| `codex-shell-tool-execution` | 模型工具调用如何经过审批与沙箱执行 | Stream、Tool Router、Exec Policy、Sandbox | 21 / 22 |
| `codex-thread-resume` | 持久化会话如何恢复成运行线程 | App Server、ThreadStore、Core Session | 16 / 18 |
| `codex-config-resolution` | 系统、用户、项目与运行时配置如何合并 | Core Config、Config Loader、Requirements | 10 / 13 |
| `codex-mcp-tool-call` | MCP 工具如何经过审批并到达远程 server | Tool Router、MCP Policy、Prepared Call Binding、RMCP | 15 / 15 |
| `codex-context-compaction` | 上下文超限时如何压缩并安装新历史 | Turn、Compact、Model Client、Session History | 17 / 17 |

合计 175 个节点、202 条边和 338 个经过校验的节点/调用点源码位置。

## 0. 端到端 Agent 回合与上下文闭环

```text
ChatWidget user input
  -> App Server turn/start or turn/steer
  -> CodexThread / submission_loop
  -> RegularTask::run
  -> run_turn
     -> context updates + skills/plugins + user input history
     -> capture step context + build tools
     -> ContextManager::for_prompt + build_prompt
     -> ModelClientSession::stream
        -> Responses HTTP/SSE or WebSocket
     -> handle_output_item_done
        -> assistant output persistence
        -> Shell or MCP tool runtime
     -> drain_in_flight
     -> record tool output in history
     -> next model sampling
     -> token window check
        -> remote or local auto compact
        -> replace_compacted_history
        -> continue with compacted context
```

关键结论：

- 这不是一条只到模型请求为止的线性链。`run_turn` 同时拥有采样前压缩、上下文装载、
  pending steer、模型续跑、工具结果回写和正常结束等多条控制分支。
- 上下文来源不是单一历史数组：步骤快照、world state、权限与环境更新、用户输入、
  技能/插件注入和工具结果最终在 `ContextManager::for_prompt` 汇合。
- 模型传输分成 Responses HTTP/SSE 和 WebSocket 两条运行路径，但统一返回
  `ResponseEvent`，再由同一个输出处理器识别普通消息或工具调用。
- Shell 与 MCP 共享 ToolRouter、ToolCallRuntime 和 ToolRegistry；在具体 handler 后分开
  执行，最终都以 `ResponseInputItem` 回到 `drain_in_flight`。
- 工具输出写入历史并把 `needs_follow_up` 置为真，因此下一次模型采样能看到工具结果；
  这条回流是 Agent loop 的关键闭环。
- token usage 更新后，`context_window_token_status` 决定正常结束还是中途压缩；远程和本地
  压缩最终都通过 `replace_compacted_history` 汇合，再回到下一次 `for_prompt`。

## 1. 交互回合生命周期

```text
AppCommand::UserTurn
  -> AppServerSession::turn_start
  -> TurnRequestProcessor::turn_start_inner
  -> CodexThread / SessionIo submission channel
  -> submission_loop
  -> user_input_or_turn_inner
  -> Session::spawn_task
  -> RegularTask::run
  -> run_turn
  -> run_sampling_request
  -> try_run_sampling_request
  -> ModelClientSession::stream
```

关键结论：

- TUI 在同一入口区分“启动新回合”和“向活动回合 steer”，不是每次输入都创建任务。
- App Server 是协议和配置适配层；真正的执行通过 `Op::UserInput` 进入 Core。
- `SessionIo` 与 `submission_loop` 之间是异步通道边界。
- `RegularTask` 通过 `tokio::spawn` 运行，`run_turn` 内部还包含“模型调用—工具结果—
  再调用模型”的循环。
- 模型传输在 `ModelClientSession::stream` 中选择 Responses WebSocket，并可回退到 HTTP。

## 2. shell 工具、审批与沙箱

```text
ResponseItem
  -> ToolRouter::build_tool_call
  -> ToolCallRuntime
  -> ToolRouter / ToolRegistry
  -> ShellCommandHandler
  -> ExecPolicyManager
  -> ToolOrchestrator
     -> permission hook / Guardian / user approval
     -> SandboxAttempt
  -> ShellRuntime::run
  -> execute_env
```

关键结论：

- 模型流只负责识别和排队工具 Future；具体 handler 由注册表动态分发。
- 工具是否并行由注册表声明，非并行工具通过写锁与其他调用互斥。
- `ExecPolicyManager` 先把命令判定为 `Skip`、`Forbidden` 或 `NeedsApproval`。
- 审批并非只有 UI：permission hook 可以预先允许/拒绝，Guardian 可以自动审核，
  用户路径则通过 `ExecApprovalRequest` 事件和 oneshot 回调等待决定。
- `ToolOrchestrator` 是审批、沙箱选择、网络审批和失败升级重试的统一状态机。
- 真正创建子进程前，`ShellRuntime` 还会装配 shell snapshot、环境、网络和平台沙箱。

## 3. 持久化线程恢复

```text
thread/resume
  -> ThreadRequestProcessor::thread_resume_inner
  -> ThreadStore::read_thread
  -> LocalThreadStore / SQLite + rollout
  -> InitialHistory::Resumed
  -> ThreadManager::resume_thread_with_history
  -> spawn_thread_with_source
  -> Session::spawn
  -> finalize_thread_spawn
  -> thread resume lifecycle contributors
```

关键结论：

- 恢复先检查线程是否仍在内存运行；运行中的线程采用重连语义，冷线程才重建 Session。
- `ThreadStore` 是可替换存储边界，默认本地实现结合 SQLite 元数据和 rollout 内容。
- 分页历史只装载最新模型上下文；传统 rollout 模式按需附加完整历史。
- `spawn_thread_with_source` 会去重相同 conversation id，避免重复运行同一恢复线程。
- `SessionConfigured` 握手完成且线程注册后，才触发扩展的 thread-resume 生命周期。

## 4. 分层配置解析

```text
ConfigBuilder::build
  -> ConfigBuilder::build_inner
  -> load_config_layers_state
     -> load_config_layers_internal
     -> compose_requirements
     -> ThreadConfigLoader::load_config_layers
     -> load_project_layers
  -> ConfigLayerStack::new
  -> ConfigLayerStack::effective_config
  -> Config::load_config_with_layer_stack
```

关键结论：

- 普通配置和强制约束是两条不同的数据通道：普通 TOML 按优先级覆盖，requirements
  独立组合并在最终 `Config` 装配时施加。
- 项目配置会被发现，但是否启用取决于项目根与 trust context；未受信任层不会偷偷参与
  `effective_config`。
- 线程级配置通过 `ThreadConfigLoader` Trait 注入，并按统一优先级插入，不绕过普通配置栈。
- 相对路径在各自配置文件所属目录下先解析为绝对路径，最终合并时不再依赖单一 cwd。

## 5. MCP 工具调用

```text
ResponseItem
  -> ToolRouter / ToolCallRuntime / ToolRegistry
  -> McpHandler::handle_call
  -> handle_mcp_tool_call
     -> maybe_request_mcp_tool_approval
     -> handle_approved_mcp_tool_call
  -> PreparedMcpCall::call_with_preparation
  -> ManagedClient::call_tool
  -> MCP server tools/call
```

关键结论：

- MCP 工具与内置工具共享模型输出识别、并行门禁、注册表、hook 和遥测基础设施，只在具体
  handler 后进入 MCP 专属策略。
- 审批同时考虑 permission profile、MCP tool annotations、App policy、会话/持久化记忆、
  permission hook、Guardian 和用户输入；并非所有 MCP 调用都会弹窗。
- `handle_approved_mcp_tool_call` 会附加 thread id、沙箱状态和 rollout trace 元数据；
  `PreparedMcpCall` 随后校验工具目录版本，并使用审批时绑定的客户端、工具与超时执行，
  避免审批对象和真正执行对象发生漂移。
- OAuth 刷新、参数形状校验和真正的 `tools/call` 协议请求位于 `ManagedClient`，Core 不直接
  操纵传输。

## 6. 自动上下文压缩

```text
run_turn
  -> run_pre_sampling_compact
  -> context_window_token_status
  -> run_auto_compact
     -> remote: compact_conversation_history
     -> local: drain_to_completed + build_compacted_history
  -> Session::replace_compacted_history
```

关键结论：

- 自动压缩同时受可配置 token budget 和模型硬上下文窗口约束；达到任一有效边界都可在采样前触发。
- provider 支持远程压缩时调用 Responses compact endpoint；否则用普通 Responses 采样生成
  摘要，两条路径最终共享“安装 replacement history”的语义边界。
- 远程结果会过滤不应保留的响应项，并在 mid-turn 场景把规范初始上下文插回正确位置；
  本地路径保留受限用户消息并追加固定前缀摘要。
- `replace_compacted_history` 不只改内存：它还持久化 `Compacted`、WorldState 和 TurnContext，
  并为 compact 后的 session-start hook 排队。

## 验证边界

- 本轮验证的是代表性主干，不声称覆盖 Codex 仓库的全部功能或所有平台分支。
- 宏展开、条件编译、运行时注册表具体内容和外部服务内部实现不强行推断。
- `remote` 边表示 App Server RPC 语义；在当前 TUI 默认模式下它可以运行于同一进程，
  也可以由其他传输承载。
- Guardian 审批和用户审批是条件分支；图展示共同的 Orchestrator 主干及用户审批实现，
  不表示每条命令都会弹出审批。
