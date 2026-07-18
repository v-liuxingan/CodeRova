# Codex Callgraph Visualizer 计划

## 1. 背景

学习 Codex 源码时，调用链经常跨越 CLI、TUI、App Server、Core、Model Provider 和 API 等多个 crate。仅通过文件路径和行号阅读，难以快速理解节点之间的走向，尤其容易遗漏闭包回调、Trait 方法分发和异步任务边界。

本项目计划构建一个本地调用链可视化工具，将调用链分析结果转换成可展开、可隐藏、可定位源码的有向图。

## 2. 目标

### 2.1 核心目标

- 用标准 JSON 描述一条或多条调用链。
- 将调用链渲染为有序的交互式有向图。
- 节点展示函数、模块、文件、行号和职责说明。
- 连线展示调用方向、调用类型和跳转代码位置。
- 支持节点展开、折叠、隐藏和上下游聚焦。
- 支持一键跳转 VSCode 的文件与行号。

### 2.2 非目标

- 第一阶段不追求完整、无误差的 Rust 全量静态调用图。
- 第一阶段不替代 rust-analyzer、IDE 调用层次或调试器。
- 不把所有宏展开、泛型实例化和动态分发都强行伪装成确定调用。

## 3. 典型调用链

第一条验证链使用当前正在学习的 TUI 授权链：

```text
main
  -> run_interactive_tui
  -> codex_tui::run_main
  -> start_embedded_app_server
  -> InProcessAppServerClient::start
  -> codex_app_server::in_process::start
  -> AuthManager::shared_from_config
  -> ModelProvider::auth
  -> auth_provider_from_auth
  -> BearerAuthProvider
  -> AuthProvider::apply_auth
```

## 4. 数据模型草案

建议以 `callgraph.json` 作为标准交换格式：

```json
{
  "schemaVersion": "0.1",
  "title": "TUI authorization call graph",
  "root": "cli.main",
  "nodes": [
    {
      "id": "cli.main",
      "kind": "function",
      "label": "main",
      "crate": "codex-cli",
      "file": "codex-rs/cli/src/main.rs",
      "line": 956,
      "endLine": 962,
      "role": "CLI 程序入口",
      "description": "启动 CLI 并进入异步命令分发流程",
      "state": "expanded"
    }
  ],
  "edges": [
    {
      "id": "edge.cli-main-to-tui",
      "from": "cli.main",
      "to": "cli.run-interactive-tui",
      "kind": "direct",
      "label": "调用",
      "file": "codex-rs/cli/src/main.rs",
      "line": 2273,
      "description": "CLI 将交互启动委托给 TUI crate"
    }
  ]
}
```

### 4.1 节点字段

- `id`：稳定标识。
- `kind`：函数、结构体、Trait、模块、进程、远程服务等。
- `file`、`line`、`endLine`：源码定位。
- `role`、`description`：面向学习者的职责说明。
- `state`：展开、折叠或隐藏状态。

### 4.2 连线字段

- `from`、`to`：起点和终点。
- `kind`：`direct`、`callback`、`trait-dispatch`、`spawn`、`remote` 等。
- `file`、`line`：发生跳转或调用表达式的位置。
- `confidence`：对间接调用分析结果的可信度。

底层使用图结构，不强制限制为树，因为一个函数可能有多个调用者，也可能形成循环。界面可以在图之上提供树状展开视图。

## 5. 交互设计

- 节点：显示函数名、crate、源码行号和一句职责说明。
- 连线：显示调用类型和 `文件:行号`。
- 点击节点：显示详细信息，并提供“跳转 VSCode”。
- 点击连线：定位调用发生处，而不是只定位目标函数。
- 展开/折叠：以节点为边界隐藏或显示下游子图。
- 隐藏：临时移除噪声节点，但保留其关系数据。
- 聚焦：只显示选中节点的上游、下游或完整路径。
- 间接调用：使用不同样式标识闭包、Trait、异步任务和远程边界。

## 6. VSCode 跳转方案

浏览器页面不能直接执行本地 PowerShell 命令，因此需要本地跳转桥接层。候选方案：

1. 本地桥接服务：页面请求本地服务，由服务执行 `Code.exe --goto`。
2. VSCode 扩展：扩展注册命令，页面或文件协议将节点信息交给扩展。
3. CLI 辅助命令：使用 `codex-callgraph open --node <id>` 打开目标位置。

第一版优先采用本地 PowerShell/CLI 辅助命令，减少额外服务依赖；稳定后再考虑 VSCode 扩展。

当前可用的 VSCode CLI（直接启动 `Code.exe` 会触发 Windows 740 提权错误）：

```text
E:\develop\utils\vs\bin\code.cmd
```

## 7. 分阶段计划

### 阶段一：手工数据验证

- 手工编写当前 TUI 授权链 JSON。
- 验证节点、连线、文件行号和职责说明。
- 验证 VSCode 批量打开多个节点。

### 阶段二：交互式图渲染

- 实现本地 HTML/SVG 图视图。
- 支持方向箭头、节点选择、展开、折叠和隐藏。
- 支持节点详情和连线详情。

### 阶段三：跳转工具

- 实现 `Code.exe --goto` 调用封装。
- 支持节点跳转和连线调用点跳转。
- 增加 Windows 路径、空格路径和行号校验。

### 阶段四：分析结果生成

- 根据源码阅读结果生成 JSON。
- 记录直接调用和间接调用的证据。
- 为 Trait、闭包、`tokio::spawn` 和 App Server 边界增加类型标记。

### 阶段五：学习流程集成

- 每节源码课保存一份调用链。
- 从学习笔记链接到对应调用图。
- 支持从节点发起“解释这个函数”或“继续追踪下游”的学习动作。

## 8. 当前进度

- [x] 确认 JSON schema 的 0.1 字段名称并提供 JSON Schema。
- [x] 手工录入并按本地 Codex 源码核验第一条 TUI 授权调用链。
- [x] 第一版使用模块化 SVG 自绘，保留替换 Canvas/WebGL 的渲染器接口。
- [x] 实现节点展开/折叠、隐藏、聚焦和类型筛选状态。
- [x] 实现 Rust CLI 与 `SourceNavigator` VSCode 跳转器。
- [x] 实现只监听 localhost 的本地 HTTP 桥接服务。
- [ ] 将调用链文件与 `codex-source-architecture` 学习项目关联。

## 9. 设计原则

- 先保证源码位置准确，再追求图形美观。
- 所有边都必须能说明“为什么认为存在这条调用关系”。
- 不确定的间接调用必须显式标记，不伪装成确定事实。
- 图用于帮助阅读源码，不能替代源码本身。
- 工具输出应适合长期积累和后续自动生成。
