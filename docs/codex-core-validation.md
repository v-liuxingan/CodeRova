# Codex 核心功能系统性验证

## 验证基线

- 源码仓库：本地 `codex`
- 提交：`23899f7cb63a1510e53fddd68740dfc325853e3b`
- 验证方式：逐层阅读真实调用点，以函数定义和调用表达式的相对路径、行号作为证据
- 范围：选择能跨越 CLI/TUI、App Server、Core、模型传输、工具系统、审批沙箱和持久化存储的代表性主链

这不是“扫描到同名函数就连线”的文本索引。每条边都区分直接调用、异步任务、通道、
Trait 分发、回调、远程协议和跨阶段数据流；无法从调用表达式直接确认的动态边会降低
`confidence`。

## 覆盖矩阵

| 调用图 | 核心问题 | 主要模块 | 节点/边 |
| --- | --- | --- | --- |
| `tui-authorization` | 模型请求如何获得认证 | CLI、TUI、App Server、Core | 19 / 19 |
| `codex-turn-lifecycle` | 用户输入如何成为模型采样回合 | TUI、App Server、Core、Model Client | 14 / 13 |
| `codex-shell-tool-execution` | 模型工具调用如何经过审批与沙箱执行 | Stream、Tool Router、Exec Policy、Sandbox | 17 / 16 |
| `codex-thread-resume` | 持久化会话如何恢复成运行线程 | App Server、ThreadStore、Core Session | 12 / 12 |

合计 62 个节点、60 条边和 122 个节点/调用点源码位置。

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

## 验证边界

- 本轮验证的是代表性主干，不声称覆盖 Codex 仓库的全部功能或所有平台分支。
- 宏展开、条件编译、运行时注册表具体内容和外部服务内部实现不强行推断。
- `remote` 边表示 App Server RPC 语义；在当前 TUI 默认模式下它可以运行于同一进程，
  也可以由其他传输承载。
- Guardian 审批和用户审批是条件分支；图展示共同的 Orchestrator 主干及用户审批实现，
  不表示每条命令都会弹出审批。
