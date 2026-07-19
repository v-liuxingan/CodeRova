# Callgraph Visualizer

面向任意本地源码仓库的调用链浏览器。它把带证据的调用关系保存为标准 JSON，通过
Rust 服务校验源码位置，再用可交互 SVG 展示节点、调用方向和间接调用边界。数据模型
不限定编程语言、框架或仓库。

仓库当前附带一条 Codex TUI 授权链作为真实世界示例，该示例基于提交
`23899f7cb63a1510e53fddd68740dfc325853e3b` 核验。

## 功能

- 标准 `callgraph.json` 数据模型和 JSON Schema。
- 节点、连线、职责、证据和置信度展示；精确调用位置直接标注在连线上。
- 连线与标签分层渲染，标签按曲线真实位置偏移为信息卡，不遮挡字符或制造断线错觉。
- 上游、下游、完整路径聚焦。
- 节点折叠、隐藏、恢复和调用类型筛选。
- 节点可拖动自定义排版，位置按调用图及纵/横方向保存到独立布局配置。
- 横向/纵向分层布局、缩放、拖动和适配视口。
- 节点跳到定义位置；连线提供宽点击热区，选中后可跳到精确调用位置。
- 可手动开启“点击跳转”，直接点击节点或精确调用边即可打开源码；该模式默认关闭。
- 固定源码步进器和 `←` / `→` 共用“节点 → 调用位置 → 节点”状态机，不会再跳过精确调用边。
- 连续步进会在检查器内更新只读源码工作台并保持浏览器焦点；相邻节点和调用点会提前预取。
- 右侧工作台提供“详情 / 源码”双视图；源码默认占满侧栏高度，支持拖拽调宽、一键宽屏和
  整栏折叠，折叠后调用图会自动回收可用空间。
- 预览节点完整定义范围或边的调用行，可切换上下文、就地查找、复制位置，并展示语言、
  文件规模、目标范围和裁剪状态。
- 默认代码面采用与 AntV G6 示例站相同技术路线的本地 Monaco 只读编辑器，支持真实行号、
  代码折叠、查找、自动换行和字体缩放；装载失败时自动回退到安全 DOM 预览。
- 详情侧栏支持拖拽调宽、键盘调宽和双击复位；源码预览可进入宽屏专注模式。
- 预览核心不依赖特定语言分析器；轻量语言着色可注册，未知语言安全回退为纯文本。
- 多分支节点可按目标、关系与调用位置显式选择下游分支，输入控件聚焦时方向键自动避让。
- 虚拟节点或省略中间节点的抽象连线不伪造调用位置，并显示不可用原因。
- Rust CLI 校验图结构和真实源码位置。
- 后端校验后由浏览器触发 `vscode://` 外部协议，不创建 shell 或编辑器进程。
- 可注册、可持久化切换的界面主题；默认 `Halo` 明亮科技主题，并提供 `Aether` 深色与 `Signal` 经典主题。

## 启动

要求 Rust 1.85+。仓库已提交构建后的前端资源，直接运行：

```powershell
cargo run -- serve
```

然后访问 <http://127.0.0.1:4317>。

修改 Monaco 入口或升级依赖后，需要 Node.js 20+ 并重新生成本地资源：

```powershell
npm ci
npm run build:frontend
```

默认使用：

- 项目目录配置：`callgraph.projects.json`
- 源码跳转协议：`vscode://file/...:line:column`
- 调用图目录：`graphs`
- 手工布局目录：`layouts`
- 静态页面目录：`public`

默认配置已经把仓库自带的 Codex 示例映射到 `../codex`：

也可以覆盖项目配置、端口和数据目录：

```powershell
cargo run -- serve --config E:/path/to/callgraph.projects.local.json `
  --graphs E:/path/to/graphs --layouts E:/path/to/layouts --port 4317
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

节点拖动不会改写调用图。服务会按图谱生成 `layouts/<slug>.layout.json`，并将纵向、横向
位置分开保存：

```json
{
  "schemaVersion": "0.1",
  "graph": "tui-authorization",
  "positions": {
    "vertical": {
      "cli.main": { "x": 120.5, "y": 36 }
    }
  }
}
```

“自动排版”只清除当前方向的手工位置，另一个方向不受影响。

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
  layout_store.rs      LayoutStore 接口与手工节点位置文件仓储
  model.rs             领域数据模型
  navigation.rs        SourceLinkBuilder 接口与 VSCode URI 实现
  project_catalog.rs   ProjectCatalog 接口与项目根路径配置
  source_preview.rs    受限源码上下文读取接口与文件实现
  validation.rs        图一致性与源码位置校验
  server.rs            HTTP API 和静态资源适配层
  main.rs              serve / validate / open CLI
public/js/
  graph-state.js       隐藏、折叠、聚焦和筛选状态
  click-navigation-policy.js
                       默认关闭的图元点击跳转策略
  source-preview-controller.js
                       网页内源码预览取消、缓存、预取与异步竞态控制
  source-preview-view.js
                       上下文范围、查找、元数据与代码面调度
  source-code-surface-registry.js
                       可替换代码面注册表；Monaco 默认、DOM 安全回退
  source-surfaces/     Monaco 隔离框控制器、编辑器运行时与 DOM 实现
  inspector-workbench-controller.js
                       详情/源码视图、宽屏和整栏折叠状态
  layout-persistence-controller.js
                       节点位置防抖保存与图谱切换前刷新
  resizable-panel-controller.js
                       CSP 兼容的离散宽度侧栏拖拽与专注模式
  syntax-highlighter.js
                       可注册轻量语言着色与纯文本回退
  trace-navigator.js   上游节点、调用位置和下游节点的连续源码步进
  layouts/             与渲染器无关的布局算法
  renderers/           可替换渲染器；当前为 SVG
  renderer-registry.js 渲染器插件注册
  theme-registry.js    可注册主题与本地持久化切换
schema/
  callgraph.schema.json  调用图 0.2
  projects.schema.json   项目目录配置 0.1
  layout.schema.json     手工节点位置配置 0.1
graphs/
  codex-shell-tool-execution.json
  codex-thread-resume.json
  codex-turn-lifecycle.json
  tui-authorization.json
layouts/
  *.layout.json          运行时按需生成的手工排版配置
frontend/
  monaco-preview-entry.js
                         固定依赖范围的 Monaco 本地构建入口
scripts/
  build_frontend.mjs     生成编辑器、Worker 与许可证资源
public/vendor/monaco/    可离线运行的固定版本 Monaco 产物
```

模块扩展方式见 [架构说明](docs/architecture.md)，预览工作台的竞品取舍与安全预算见
[源码预览工作台设计](docs/source-preview-workbench.md)，原始设想与阶段规划见
[路线图](docs/roadmap.md)。本地 Codex 核心功能的多链路验证结果见
[Codex 核心功能系统性验证](docs/codex-core-validation.md)。前后端智能体的文件所有权、
API 契约和并行协作门禁见 [前后端智能体开发边界](docs/agent-development-boundaries.md)。

## 验证

```powershell
cargo fmt --check
cargo test
npm ci
npm run build:frontend
Get-ChildItem graphs/*.json | ForEach-Object {
  cargo run --quiet -- validate $_.FullName
}
```

浏览器端到端测试使用 Playwright。项目测试入口直接管理 Rust 服务进程，不经过
PowerShell、`cmd.exe` 或 `shell=True`；每次自动选择独立临时端口，避免干扰已在 4317
运行的开发服务，并在结束后确认临时端口已经释放：

```powershell
python tests/run_e2e.py
```

## 安全边界

HTTP 跳转和预览接口都不接受任意文件路径。它们只接受调用图 slug、目标类型和目标 ID，服务端
从已加载图中读取 `projectId`，通过项目目录配置解析根路径，并校验规范化源码路径仍
位于对应项目根目录内。预览接口只读最多 4 MiB 的 UTF-8 文本，拒绝疑似二进制内容，并对
上下文、响应总行数和单行长度分别设限。主页面保持不允许内联脚本和样式的严格 CSP；
Monaco 被隔离在独立同源预览页中，只有该页允许编辑器布局所需的内联样式，同时仍禁止
远程连接、表单、对象和跨站嵌入。页面还使用禁止 MIME 猜测、无 referrer 和 `no-store`
减少本地源码泄漏面。接口返回节点定义范围或调用点附近的有限上下文；
跳转接口返回 `vscode://` URI。服务端不执行 PowerShell、命令脚本或编辑器进程；外部协议
只能由显式的编辑器打开操作或用户手动启用的“点击跳转”交给浏览器处理。
