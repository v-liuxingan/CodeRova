# 分析器取舍：保留 LSP

目标是让开发者在 10 分钟内理解并核验陌生项目的关键流程。隐藏的漏边比索引等待更容易建立错误认知，因此平台只保留 LSP 采集；不提供双引擎选择或静默降级。

## 比较对象与结论

这里比较 rust-analyzer/JDT LS 与本项目的 Graphify Tree-sitter 加启发式解析实现。LSP 是协议，AST 是语法表示，并非两类互斥的解析原理；语言服务器自身也使用 AST。

| 维度 | LSP 实现 | 当前 AST 实现 |
| --- | --- | --- |
| 符号与目标 | 借助语言服务器类型、模块及构建上下文解析 | 跨模块重导出、接收者类型解析不足 |
| 调用证据 | 调用层级及调用位置，仍需核验动态分派 | 保留调用点，但目标解析遗漏会截断下游 |
| 首次成本 | 安装语言服务器、项目导入和索引较重 | 需要 Python、定制包和首次全项目索引 |
| 重复使用 | 可复用语言服务器会话 | 快照复用快 |
| 可维护性 | 共享采集生命周期加语言适配 | 额外维护解析、消歧、缓存和进程桥接 |
| 用户流程 | 选文件、选函数、配置采集 | 双引擎增加选择成本和不同预算语义 |

Codex 实验：AST 首次索引 54.294 秒，热缓存 1.482 秒；三层有 141 个调用点，旧 LSP 对照有 594 个，其中匹配 140 个。已核实 AST 漏掉根方法经跨 crate 重导出的一次调用。不能将这组数字当作准确率：旧 LSP 不是运行时真值，深层差异还受上游可达性影响；没有同条件 LSP 冷启动测速，不能宣称固定加速比。实验入口为 `codex-rs/cli/src/main.rs:958`，对照 `tests/artifacts/codex-startup/codex-startup-raw.json`。缺失项是 `main.rs:959` 的 `codex_app_server::take_remote_control_disabled_env()`，实际实现经 crate 重导出位于 app-server-transport。原始实验输出保留在独立的 graphify-evaluation 目录，不作为本应用运行依赖。

## 应用收敛

新建图没有分析器选择；后端按文件选择 Rust 或 Java 语言服务器。入口校验、采集、停止、结果预览、采纳和保存共用原有流程。移除 AST Python 桥接及专用请求字段。已有 AST 图可读、可编辑，但不转换语义、不自动续采、不删除源数据。

这次取舍不等于 LSP 已解决全部问题。宏、构建条件、反射、运行时注册、异步消息和多态仍可能有边界。保留源码证据、未解析说明和人工关联。LSP 冷启动优化应聚焦会话复用、索引就绪、取消及阶段提示，避免重启服务器或全项目重复索引。

## 验收标准

新建只有一条路径；旧引擎参数明确拒绝；历史图可打开；续采仍写草稿，采纳后显式保存。用 Codex 启动和 Spring refresh 检查入口、关键下游与源码位置，而非单看节点数量。后续应做同机器同构建上下文的冷/热耗时对照，以及 10 分钟读图任务验证，不能把本次删分支当作性能提升的证明。

## 原理参考

- [LSP Call Hierarchy](https://github.com/microsoft/language-server-protocol/blob/gh-pages/_specifications/lsp/3.17/language/callHierarchy.md)
- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/)
