# Codex Callgraph Visualizer

本地 Codex 源码调用链浏览器。它把带证据的调用关系保存为标准 JSON，通过 Rust
服务校验源码位置，再用可交互 SVG 展示节点、调用方向和间接调用边界。

当前已经包含一条基于本地 Codex 提交
`23899f7cb63a1510e53fddd68740dfc325853e3b` 核验过的 TUI 授权链。

## 功能

- 标准 `callgraph.json` 数据模型和 JSON Schema。
- 节点、连线、文件行号、职责、证据和置信度展示。
- 上游、下游、完整路径聚焦。
- 节点折叠、隐藏、恢复和调用类型筛选。
- 横向/纵向分层布局、缩放、拖动和适配视口。
- 节点跳到定义位置，连线跳到调用发生位置。
- Rust CLI 校验图结构和真实源码位置。
- 安全的 VSCode 本地跳转桥接。

## 启动

要求 Rust 1.85+。在本目录运行：

```powershell
cargo run -- serve
```

然后访问 <http://127.0.0.1:4317>。

默认使用：

- Codex 源码根目录：`../codex`
- VSCode CLI：`E:/develop/utils/vs/bin/code.cmd`
- 调用图目录：`graphs`
- 静态页面目录：`public`

这些路径都可以覆盖：

```powershell
cargo run -- serve `
  --source-root E:/path/to/codex `
  --code E:/path/to/code.cmd `
  --port 4317
```

## CLI

校验图结构和每个节点/连线的源码位置：

```powershell
cargo run -- validate graphs/tui-authorization.json --source-root ../codex
```

输出 JSON 校验报告：

```powershell
cargo run -- validate graphs/tui-authorization.json --source-root ../codex --json
```

直接打开节点或调用点：

```powershell
cargo run -- open graphs/tui-authorization.json `
  --node cli.main `
  --source-root ../codex

cargo run -- open graphs/tui-authorization.json `
  --edge edge.client-runtime-start `
  --source-root ../codex
```

## 项目结构

```text
src/
  graph_store.rs       GraphStore 接口与 JSON 文件仓储
  model.rs             领域数据模型
  navigation.rs        SourceNavigator 接口与 VSCode 实现
  validation.rs        图一致性与源码位置校验
  server.rs            HTTP API 和静态资源适配层
  main.rs              serve / validate / open CLI
public/js/
  graph-state.js       隐藏、折叠、聚焦和筛选状态
  layouts/             与渲染器无关的布局算法
  renderers/           可替换渲染器；当前为 SVG
  renderer-registry.js 渲染器插件注册
schema/
  callgraph.schema.json
graphs/
  tui-authorization.json
```

模块扩展方式见 [架构说明](docs/architecture.md)，原始设想与阶段规划见
[路线图](docs/roadmap.md)。

## 验证

```powershell
cargo fmt --check
cargo test
cargo run -- validate graphs/tui-authorization.json --source-root ../codex
```

浏览器端到端测试使用 Playwright，并自动管理 Rust 服务：

```powershell
python E:/develop/Agent/skills/webapp-testing/scripts/with_server.py `
  --server "cargo run --quiet -- serve" --port 4317 `
  -- python tests/e2e_visualizer.py
```

## 安全边界

HTTP 跳转接口不接受任意文件路径。它只接受调用图 slug、目标类型和目标 ID，服务端
从已加载图中重新解析源码位置，并校验规范化路径仍位于 `source-root` 内，再调用编辑器。
