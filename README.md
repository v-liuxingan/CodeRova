# Callgraph Visualizer

面向任意本地源码仓库的调用链浏览器。它把带证据的调用关系保存为标准 JSON，通过
Rust 服务校验源码位置，再用可交互 SVG 展示节点、调用方向和间接调用边界。数据模型
不限定编程语言、框架或仓库。

仓库当前附带一条 Codex TUI 授权链作为真实世界示例，该示例基于提交
`23899f7cb63a1510e53fddd68740dfc325853e3b` 核验。

## 功能

- 标准 `callgraph.json` 数据模型和 JSON Schema。
- 节点、连线、职责、证据和置信度展示；精确调用位置直接标注在连线上。
- 上游、下游、完整路径聚焦。
- 节点折叠、隐藏、恢复和调用类型筛选。
- 横向/纵向分层布局、缩放、拖动和适配视口。
- 节点跳到定义位置；连线提供宽点击热区，选中后可跳到精确调用位置。
- 虚拟节点或省略中间节点的抽象连线不伪造调用位置，并显示不可用原因。
- Rust CLI 校验图结构和真实源码位置。
- 后端校验后由浏览器触发 `vscode://` 外部协议，不创建 shell 或编辑器进程。
- 可注册、可持久化切换的界面主题；默认 `Halo` 明亮科技主题，并提供 `Aether` 深色与 `Signal` 经典主题。

## 启动

要求 Rust 1.85+。在本目录运行：

```powershell
cargo run -- serve
```

然后访问 <http://127.0.0.1:4317>。

默认使用：

- 项目目录配置：`callgraph.projects.json`
- 源码跳转协议：`vscode://file/...:line:column`
- 调用图目录：`graphs`
- 静态页面目录：`public`

默认配置已经把仓库自带的 Codex 示例映射到 `../codex`：

也可以覆盖项目配置、端口和数据目录：

```powershell
cargo run -- serve --config E:/path/to/callgraph.projects.local.json `
  --graphs E:/path/to/graphs --port 4317
```

## 项目根路径

调用图只保存稳定的 `projectId` 和项目内相对路径。项目在当前机器上的实际位置集中定义
在 `callgraph.projects.json`：

```json
{
  "schemaVersion": "0.1",
  "projects": [
    {
      "id": "codex",
      "name": "OpenAI Codex",
      "root": "../codex"
    }
  ]
}
```

`root` 可以是绝对路径，也可以是相对于项目配置文件的路径。源码迁移后只需修改这里，
不需要重写调用图。需要保存机器专属路径时，可以创建已被 Git 忽略的
`callgraph.projects.local.json`，并使用 `--config` 指定。

调用图 0.2 通过 `projectId` 引用项目：

```json
{
  "schemaVersion": "0.2",
  "projectId": "codex",
  "nodes": [
    {
      "file": "codex-rs/cli/src/main.rs",
      "line": 956
    }
  ]
}
```

精确边继续使用项目内相对路径：

```json
{ "callSiteStatus": "exact", "file": "src/main.rs", "line": 42 }
```

当端点是虚拟节点或一条边省略了多个中间节点时，不要伪造位置，改为提供原因：

```json
{
  "callSiteStatus": "omitted-nodes",
  "callSiteNote": "跨越消息通道和服务端分发层，省略了多个协议适配节点。"
}
```

## CLI

校验图结构和每个节点/连线的源码位置：

```powershell
cargo run -- validate graphs/tui-authorization.json
```

输出 JSON 校验报告：

```powershell
cargo run -- validate graphs/tui-authorization.json --json
```

为节点或调用点生成经过校验的 VSCode URI：

```powershell
cargo run -- open graphs/tui-authorization.json `
  --node cli.main

cargo run -- open graphs/tui-authorization.json `
  --edge edge.client-runtime-start
```

## 项目结构

```text
src/
  graph_store.rs       GraphStore 接口与 JSON 文件仓储
  model.rs             领域数据模型
  navigation.rs        SourceLinkBuilder 接口与 VSCode URI 实现
  project_catalog.rs   ProjectCatalog 接口与项目根路径配置
  validation.rs        图一致性与源码位置校验
  server.rs            HTTP API 和静态资源适配层
  main.rs              serve / validate / open CLI
public/js/
  graph-state.js       隐藏、折叠、聚焦和筛选状态
  layouts/             与渲染器无关的布局算法
  renderers/           可替换渲染器；当前为 SVG
  renderer-registry.js 渲染器插件注册
  theme-registry.js    可注册主题与本地持久化切换
schema/
  callgraph.schema.json  调用图 0.2
  projects.schema.json   项目目录配置 0.1
graphs/
  codex-shell-tool-execution.json
  codex-thread-resume.json
  codex-turn-lifecycle.json
  tui-authorization.json
```

模块扩展方式见 [架构说明](docs/architecture.md)，原始设想与阶段规划见
[路线图](docs/roadmap.md)。本地 Codex 核心功能的多链路验证结果见
[Codex 核心功能系统性验证](docs/codex-core-validation.md)。

## 验证

```powershell
cargo fmt --check
cargo test
Get-ChildItem graphs/*.json | ForEach-Object {
  cargo run --quiet -- validate $_.FullName
}
```

浏览器端到端测试使用 Playwright，并自动管理 Rust 服务：

```powershell
python E:/develop/Agent/skills/webapp-testing/scripts/with_server.py `
  --server "cargo run --quiet -- serve" --port 4317 `
  -- python tests/e2e_visualizer.py
```

## 安全边界

HTTP 跳转接口不接受任意文件路径。它只接受调用图 slug、目标类型和目标 ID，服务端
从已加载图中读取 `projectId`，通过项目目录配置解析根路径，并校验规范化源码路径仍
位于对应项目根目录内，再返回
`vscode://` URI。服务端不执行 PowerShell、命令脚本或编辑器进程；外部协议只能由
前端在用户点击后交给浏览器处理。
