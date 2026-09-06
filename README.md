# Callgraph Visualizer

Callgraph Visualizer 将真实源码转化为可探索、可解释、可验证的执行模型，帮助开发者
快速理解陌生项目的关键流程。

项目的战略目标是：**让开发者面对陌生项目时，能在 10 分钟内建立一个可验证的执行
心智模型。** 它不只展示“谁调用了谁”，还要帮助用户理解流程目的、执行阶段、关键
分支与循环、状态变化及其源码依据。详细的产品定位、衡量方式和取舍原则见
[`docs/product-strategy.md`](docs/product-strategy.md)。

工具面向任意本地源码仓库。它把带证据的调用关系保存为标准 JSON，通过 Rust 服务
校验源码位置，再用可交互 SVG 展示节点、调用方向和间接调用边界。数据模型不限定
编程语言、框架或仓库。

仓库当前附带多张从用户操作出发的 Codex 关键流程图。目录先回答“发送消息后发生什么”，
再分别解释提交与恢复任务、运行命令、修改文件、调用外部工具、读取配置和压缩长对话。
每张图的标题、阶段、节点职责和关系说明都面向第一次接触 Codex 的读者；函数名只作为
回到源码验证的证据。这些示例基于提交
`a68d0a74bd38ddc01361ce42262da689b788afce` 核验。

此外，`项目自身` 分类包含三张自描述图，分别解释图谱发现与加载、格式/源码证据校验，
以及链路高亮和调用步进共享的前端交互回环。它们以本仓库真实源码作为证据，
用于开发者反向理解可视化工具本身。

## 功能

- 标准 `callgraph.json` 数据模型和 JSON Schema。
- 节点默认突出用户场景职责，随缩放从“场景概览 → 关系阅读 → 源码证据”逐级增加代码信息。
- 场景地图由 Mermaid 时序文本与元数据生成静态时序页面，支持嵌套分支、循环、可选和并发区域，
  与调用图通过普通链接互相跳转。模型无需生成坐标或 HTML/SVG。
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
- 源码工作台可在受限目标范围与按需完整文件之间切换；完整文件保持目标高亮，不参与
  相邻节点自动预取。
- 默认代码面采用与 AntV G6 示例站相同技术路线的本地 Monaco 只读编辑器，支持真实行号、
  代码折叠、查找、自动换行和字体缩放；装载失败时自动回退到安全 DOM 预览。
- 详情侧栏支持拖拽调宽、键盘调宽和双击复位；源码预览可进入宽屏专注模式。
- 预览核心不依赖特定语言分析器；轻量语言着色可注册，未知语言安全回退为纯文本。
- 多下游节点按真实语义显示调用顺序、条件路径、异步路径或普通下游路径，并按目标、关系
  与调用位置选择下一步；输入控件聚焦时方向键自动避让。
- 场景页与调用图分别生成、分别阅读，不同步阶段、选中节点或视口。
- 图谱概览只将无出边节点标为结构终点，不从阶段排序推断业务完成。
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
- 场景数据目录：`scenes`，生成页面目录：`public/scenes`

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

调用图 0.2/0.3 通过 `projectId` 引用项目：

```json
{
  "schemaVersion": "0.2",
  "projectId": "codex",
  "categoryId": "tools",
  "category": "让 Codex 操作项目",
  "nodes": [
    {
      "file": "codex-rs/cli/src/main.rs",
      "line": 958
    }
  ]
}
```

可选的 `categoryId` 是稳定的物理分类目录 id，`category` 是面向用户的图谱目录名称。
`FileGraphStore` 会递归扫描 `graphs/<categoryId>/*.json`，文件名仍是全局唯一 slug；目录
与 `categoryId` 不一致时记录警告。缺少分类归属的旧图通过 API 统一呈现为
`uncategorized / 未分类`，不会根据 slug 或标题猜测分类。页面可将图移动到已有分类或
新建分类，服务通过 `PUT /api/graphs/{slug}/category` 原子更新 JSON 并移动物理文件。
布局仍按 slug 保存在平铺的 `layouts/` 中，因此移动图文件不会丢失手工布局。

调用边可通过可选的 `flowKind / condition` 同时表达分支、降级、汇合、循环回边和循环
退出；普通调用无需额外配置。完整契约见
[`docs/control-flow-semantics.md`](docs/control-flow-semantics.md)。前端点击任意节点后，
自动强调其全部上游和下游，完整图始终保留，详见
[`docs/node-path-focus.md`](docs/node-path-focus.md)。

调用图可使用 0.4 `phases` 保留内部阶段说明。每个节点最多归属一个 `phaseId`；阶段
提供布局顺序、标题和摘要，主工作台不再由它生成场景地图或同步跨页状态。
`order` 不代表严格线性执行或业务终点，也不要求调用图提供阶段：

```json
{
  "schemaVersion": "0.4",
  "phases": [
    {
      "id": "model-request",
      "title": "发起模型请求",
      "summary": "装配工具和 Prompt，并选择模型传输。",
      "order": 3
    }
  ],
  "nodes": [
    {
      "id": "turn.run-sampling",
      "phaseId": "model-request"
    }
  ]
}
```

同一方法内存在可靠执行先后的普通调用，可在调用边上填写可选 `order`。图中会以
`[01] / [02]` 标记步骤、按序排列同级关系，并让“下一步”优先进入最早调用；互斥分支、
并发和未知顺序不使用该字段。内容约束见
[`docs/callgraph-content-standard.md`](docs/callgraph-content-standard.md)。

生成或人工维护调用图时，节点和关系说明应同时解释源码事实与整条链路中的作用，避免只
复述函数名。内容写法和模型生成流程见
[`docs/callgraph-content-standard.md`](docs/callgraph-content-standard.md)；`graphs/AGENTS.md`
会要求仓库智能体在修改图文件前先阅读该规范。

## 生成场景地图与调用图

统一入口见 [`docs/graph-authoring.md`](docs/graph-authoring.md)。生成模型分别交付场景
Mermaid 与少量元数据，或调用图 JSON，项目负责显示；无需加载完整绘图 skill。

场景模型只需阅读 [`docs/scenario-authoring.md`](docs/scenario-authoring.md)，按
该规范支持的 Mermaid 子集输出 `scenes/<slug>.mmd`，并按
`schema/mermaid-scene.schema.json` 输出同名元数据 JSON，然后运行：

```powershell
npm run build:scenes
npm run check:scenes
```

构建器将 Mermaid 转为内部语义数据，原有完整 JSON 入口也继续支持。
共用渲染器自动生成页面与目录，访问 `/scenes/index.html` 即可阅读；后续新增场景不需要
修改前端代码。图中参与者、消息、条件、循环和并发由数据表达，布局、换行与配色由项目
实现，不设固定内容数量上限。提交数据及生成的 HTML，不手工维护 SVG 坐标。

调用图的源码校验仍使用 `cargo run -- validate <图文件>`。文件存在与行号有效只是基础
检查，重要证据还需核对符号和调用位置。项目自身图另有 `tests/project_evidence_test.mjs`
防止源码行号偏移后看似校验通过；完整回归统一运行 `python tests/run_e2e.py`。

### 调用位置证据

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
cargo run -- validate graphs/tools/tui-authorization.json
```

输出 JSON 校验报告：

```powershell
cargo run -- validate graphs/tools/tui-authorization.json --json
```

为节点或调用点生成经过校验的 VSCode URI：

```powershell
cargo run -- open graphs/tools/tui-authorization.json `
  --node cli.main

cargo run -- open graphs/tools/tui-authorization.json `
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
  callgraph.schema.json  调用图 0.2/0.3/0.4
  projects.schema.json   项目目录配置 0.1
  layout.schema.json     手工节点位置配置 0.1
graphs/
  context/              设置与长对话
  overview/             第一次阅读入口
  project/              Callgraph Visualizer 自身关键链路
  session/              提交与继续任务
  tools/                Codex 对项目执行的操作
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
Get-ChildItem graphs -Recurse -Filter *.json | ForEach-Object {
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
整文件预览仍受 4 MiB、UTF-8/二进制检查、最大行数和单行长度预算约束；
Monaco 被隔离在独立同源预览页中，只有该页允许编辑器布局所需的内联样式，同时仍禁止
远程连接、表单、对象和跨站嵌入。页面还使用禁止 MIME 猜测、无 referrer 和 `no-store`
减少本地源码泄漏面。接口返回节点定义范围或调用点附近的有限上下文；
跳转接口返回 `vscode://` URI。服务端不执行 PowerShell、命令脚本或编辑器进程；外部协议
只能由显式的编辑器打开操作或用户手动启用的“点击跳转”交给浏览器处理。
