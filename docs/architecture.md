# 架构与扩展点

## 依赖方向

```text
HTTP / CLI adapters
       │
       ├── GraphStore ─────── FileGraphStore
       ├── LayoutStore ────── FileLayoutStore
       ├── ProjectCatalog ─── FileProjectCatalog
       ├── SourceLinkBuilder ─ VscodeUriLinkBuilder
       ├── SourcePreviewer ─── FileSourcePreviewer
       ├── validation
       └── domain model

UI controller
       ├── GraphState
       ├── TraceNavigator
       ├── Layout ─────────── LayeredLayout
       ├── Renderer ───────── SvgRenderer
       ├── ThemeRegistry ───── Halo / Aether / Signal
       ├── SourcePreviewController
       ├── SourceCodeSurfaceRegistry ─ Monaco / DOM fallback
       ├── InspectorWorkbenchController
       ├── LayoutPersistenceController
       ├── ResizablePanelController
       └── CallgraphApi
```

核心原则是数据模型不依赖存储、HTTP、编辑器或图形技术。

## 后端接口

### `GraphStore`

负责列举和读取调用图。默认 `FileGraphStore` 递归读取 `graphs/**/*.json`，顶层分类目录
使用稳定的 `categoryId`，文件名仍是全局唯一 slug。如果以后需要
SQLite、Git 版本库或实时分析器，可实现相同的 `list` / `load` 边界，HTTP 层无需改变。

### `ProjectCatalog`

负责把调用图中稳定的 `projectId` 映射为当前机器上的项目根目录。默认
`FileProjectCatalog` 读取 `callgraph.projects.json`；其中相对根路径以配置文件所在目录
为基准解析。项目迁移后只需修改目录配置，不需要重写图里的源码位置。

目录解析与图存储彼此独立，因此同一个图目录可以引用多个源码项目，也可以用数据库、
工作区发现器或远程挂载实现替换文件配置。

### `LayoutStore`

负责读取和保存独立于调用图的手工节点位置。默认 `FileLayoutStore` 使用
`layouts/<slug>.layout.json`，按 `vertical` / `horizontal` 保存节点世界坐标。HTTP 层会校验
schema、图谱 slug、方向、节点 ID、节点数量和坐标范围；前端不能指定输出文件路径。

调用图仍是可迁移的事实数据，手工排版是可删除、可重新生成的视图配置。“自动排版”仅清空
当前方向的位置覆盖。

### `SourceLinkBuilder`

负责把已经过验证的源码位置转换成外部编辑器 URI。默认 `VscodeUriLinkBuilder` 生成：

```text
vscode://file/<absolute-path>:<line>:<column>
```

VSCode Insiders、JetBrains、远程开发桥接或仅复制位置的实现都可以替换它。路径规范化
和所选项目根目录的边界校验发生在生成 URI 之前。后端只返回数据，不启动 PowerShell、
`cmd.exe`、编辑器或任何其他子进程；前端在用户明确点击后把 URI 交给浏览器。

### `SourcePreviewer`

负责为已经过项目根目录校验的源码位置读取有限上下文。默认 `FileSourcePreviewer`
返回节点的 `line..endLine` 定义范围或边的单行调用点，并附带语言、总行数、文件大小和
裁剪状态。文件、上下文、响应行数与单行长度都有独立安全预算；疑似二进制文件和非 UTF-8
内容会被拒绝。HTTP 预览接口不接受前端文件路径，与外部编辑器 URI 共用调用图目标解析和
项目根目录边界。

### `validation`

校验分为两层：

1. 图约束：schema 版本、ID 唯一性、端点存在、枚举、置信度、相对路径。
2. 项目约束：`projectId` 能从 `ProjectCatalog` 解析到当前机器上的根目录。
3. 源码约束：文件存在、行号不超过文件长度、路径没有逃逸对应项目根目录。

## 前端接口

### `GraphState`

只管理图的可见性与选择状态，不读写 DOM。折叠、隐藏、边类型筛选和路径聚焦都在这里
计算，因此换渲染器不会丢失交互语义。

`GraphState` 同时持有当前图谱两个方向的手工位置覆盖，但不负责文件写入。
`LayoutPersistenceController` 对拖动结果做防抖保存，并在切换图谱前刷新待写配置。

### `TraceNavigator`

维护独立于渲染器的源码步进游标。它把当前节点映射为上游节点、主调用边和下游节点，
优先使用真实访问历史返回；前进顺序为“节点 → 精确调用边 → 下游节点”，不可跳转的抽象边会自动略过。
分支默认选择可达下游节点最多的边；多分支节点显示下游分支选择器，切换选择或手动选择连线后，
后续前进会沿用户指定分支推进。
步进器只返回节点或连线目标。工具栏按钮和键盘方向键都调用同一 `stepBackward` /
`stepForward` 入口，避免出现一种交互包含边、另一种交互跳过边的状态分叉。

### `SourcePreviewController`

连续步进默认通过 `CallgraphApi` 获取网页内源码上下文，不触发外部协议，因此浏览器持续
持有键盘焦点。控制器负责请求取消、有限 LRU 缓存、异步竞态检查和相邻节点/调用边预取。
`Inspector` 把同一目标适配为详情内容和源码内容，源码 DOM 渲染继续委托给独立的
`SourcePreviewView`。

`SourcePreviewView` 提供上下文范围切换、目标范围高亮、本地查找、位置复制和裁剪提示，
但不持有具体编辑器。`SourceCodeSurfaceRegistry` 默认创建 `MonacoSourceCodeSurface`，并在
装载失败时切换 `DomSourceCodeSurface`。前者通过隔离 iframe 使用本地 Monaco 与 Worker，
提供真实行号、折叠、换行和字体缩放；后者通过 `SyntaxHighlighterRegistry` 和安全文本节点
提供无编辑器依赖的基础能力。基础预览不依赖任何语言分析器，未来 LSP、Tree-sitter 或 SCIP
必须作为可替换适配器接入。切换到 IDE 仍由详情视图中的显式按钮完成。

`ResizablePanelController` 用固定宽度档位调整检查器，避免为了动态内联样式放宽 CSP；
拖动分隔条、左右方向键和双击分别对应调宽、键盘调宽和复位。

`InspectorWorkbenchController` 只管理“详情 / 源码”视图偏好、源码可用性、宽屏与整栏折叠，
并组合 `ResizablePanelController`；它不读取调用图、不请求源码，也不渲染代码。源码视图
默认占满侧栏剩余高度，宽屏临时扩大侧栏，折叠将侧栏收为 44px 并把空间归还调用图。
因此未来可以替换源码视图、尺寸策略或整个工作台外壳，而不修改 `SourcePreviewController`
和调用链导航。

### `ClickNavigationPolicy`

图元点击默认只改变选中状态。用户手动开启“点击跳转”后，节点和 `exact` 边会在选中后立即调用
源码导航；`virtual-node` 与 `omitted-nodes` 边仍只展示不可用说明。该判断封装在
`ClickNavigationPolicy` 中，SVG 渲染器只上报选中目标，不持有跳转模式。

### Layout

`LayeredLayout.compute(graph, orientation)` 输出节点坐标、边端点和边界。它不生成 SVG。
后续可以加入 Sugiyama、力导向或人工固定位置布局。

### Renderer

渲染器约定支持：

- `render(graph, state)`
- `fit()`
- `zoomBy(factor)`
- `setCallbacks(callbacks)`

当前 `SvgRenderer` 把边路径、边标签和节点分成独立图层。标签位置来自三次贝塞尔曲线的真实
中点，并沿主方向偏离路径，以带背景的信息卡展示；源码文字不再使用会遮挡中文笔画的粗描边。
节点拖动在当前 viewport 缩放下换算为世界坐标，只实时更新相连边，释放后通过
`onNodeMove` 提交持久化位置。拖节点和拖画布使用独立指针状态机。

`RendererRegistry` 负责按名称创建实现。当前 `SvgRenderer` 是默认实现；Canvas 或 WebGL
实现可以复用 `GraphState` 和任意布局器。

### Theme

`ThemeRegistry` 负责注册、选择和持久化主题。主题通过 `data-theme` 与语义化 CSS 变量控制
页面及 SVG 的节点、连线和箭头颜色；渲染器不持有固定色值。新增主题只需注册元数据并
提供对应变量覆盖，不需要修改图状态、布局或 API。

## 调用关系语义

图是一般有向图，不强制为树。`direct` 表示确定的调用表达式，间接关系必须使用
`callback`、`trait-dispatch`、`spawn`、`async-boundary` 或 `data-flow`。每条边携带：

- 调用位置状态：`exact`、`virtual-node` 或 `omitted-nodes`；
- `exact` 边携带项目内相对文件和行号，另外两种状态携带不可用说明；
- 人类可读的 evidence；
- 0 到 1 的 confidence。

样例中的 `AuthManager::shared_from_config → ModelClient::current_client_setup` 是跨启动阶段
和请求阶段的数据流，不是直接函数调用，因此显式标记为 `data-flow` 和较低置信度。
它同时使用 `omitted-nodes` 调用位置状态，避免把下游读取位置误表述为上游的直接调用点。
