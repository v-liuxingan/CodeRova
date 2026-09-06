# 前后端智能体开发边界

## 目的

当前项目继续保持单仓库和单一交付物，但把工作划分为两个可独立迭代的实现域：

```text
Rust backend ── stable HTTP / JSON contracts ── browser frontend
      │                                             │
      └── project root / source / persistence       └── graph / workbench / editor
```

现阶段不移动目录，避免一次纯结构迁移同时影响 Cargo、静态资源路由、测试和 Git 历史。
根目录与子目录的 `AGENTS.md` 已把文件所有权写成机器可读的工作约束。后续若物理迁移为
`backend/` 与 `frontend/`，必须保持本文件中的接口和安全不变量。

## 文件所有权

| 领域 | 后端智能体 | 前端智能体 | 共享/集成 |
| --- | --- | --- | --- |
| 主要目录 | `src/**`, `Cargo.*` | `public/**`, `frontend/**`, `package*.json`, `scripts/build_frontend.mjs` | `schema/**`, `graphs/**`, `docs/**`, `tests/**` |
| 数据与状态 | 图读取、项目根目录、布局存储、源码预览 | 图状态、导航游标、工作台状态、主题 | JSON Schema、示例图 |
| 可替换实现 | Store、Catalog、Previewer、LinkBuilder | Layout、Renderer、SourceCodeSurface、Theme | HTTP/JSON 契约 |
| 安全责任 | 路径边界、请求校验、读取上限、响应头 | 文本渲染、点击策略、iframe 隔离 | 跨边界 E2E |

共享文件不是任一智能体的附带修改区。涉及共享契约时，应先形成一个小型契约提交，再让
前后端实现分别依赖它；仅调整内部实现时，不应修改对方的主要目录。

## 当前 HTTP 契约

| 方法与路径 | 请求 | 成功响应 | 所有者 |
| --- | --- | --- | --- |
| `GET /api/health` | 无 | 服务状态与已解析项目 | 后端 |
| `GET /api/graphs` | 无 | 调用图摘要数组 | 后端模型，前端消费 |
| `GET /api/graphs/{slug}` | 路径 slug | `CallGraph` | `schema/callgraph.schema.json` |
| `GET /api/scenarios` | 无 | 架构场景摘要数组 | 后端模型，前端消费 |
| `GET /api/scenarios/{slug}` | 路径 slug | `ArchitectureScenario` | `schema/architecture-scenario.schema.json` |
| `GET /api/graphs/{slug}/layout` | 路径 slug | `GraphLayout` | `schema/layout.schema.json` |
| `PUT /api/graphs/{slug}/layout` | `GraphLayout` | 保存后的 `GraphLayout` | 共享 |
| `GET /api/graphs/{slug}/validation` | 路径 slug | `ValidationReport` | 后端 |
| `POST /api/open` | `{ graph, targetType, id }` | `{ uri, path, line, column }` | 共享 |
| `POST /api/preview` | `{ graph, targetType, id, contextLines?, scope? }` | `SourcePreview` | 共享 |

浏览器访问统一封装在 `public/js/api.js`。Rust 序列化模型位于 `src/model.rs`，图、项目和
布局的持久化契约分别以 `schema/*.schema.json` 为准。API 字段统一使用 `camelCase`。

`ArchitectureScenario` 是保留给旧实现 / Atlas 实验页的数据协议；主工作台不再请求
`/api/scenarios`，独立场景页也不依赖该协议。已有 API 的请求、响应和校验保持兼容。
它是调用图之上的有界架构阅读路径，不从单张调用图的边推导。
它以 `participants`、`steps`、`links` 表达跨应用、broker 和外部系统的协作；每个 step
可选地提供一个或多个 drilldown。drilldown 只能引用已加载调用图的
`projectId + graphSlug + targetIds`，后端会校验项目、图和目标均存在。它不携带文件系统路径，
也不会改变 `/api/open` 与 `/api/preview` 的图目标安全边界。

`scope` 可取 `target` 或 `file`，省略时保持原有 `target` 行为。`target` 返回定义/调用点及
受限上下文；`file` 按用户显式操作返回目标所在完整文本文件，并在响应中回传实际 `scope`。
整文件请求仍不能携带路径，继续经过调用图目标解析、项目根目录边界、4 MiB 文件上限、
UTF-8/二进制检查、单行长度和整文件行数预算。浏览器不得为相邻目标自动预取 `file` 响应。

目前没有把 API 伪装成任意文件服务：`/api/open` 与 `/api/preview` 都只接受图目标，
实际路径由后端从图和项目目录配置中解析。这个不变量不能由前端便利性需求绕过。

## 调用边控制流语义

`nodes / edges` 始终是唯一图结构。调用边的 `kind` 描述调用机制；可选的 `flowKind` 描述
控制流角色，支持 `branch`、`fallback`、`merge`、`loop-back` 和 `loop-exit`，可选
`condition` 给出分支或退出条件。详细约束见 `docs/control-flow-semantics.md`。

同一调用者内能够确认先后的普通调用，可在边上提供从 `1` 开始的可选 `order`。前端使用
它稳定排列同级关系、显示步骤序号并决定默认“下一步”；没有 `order` 时保持旧有确定性
布局，不能宣称存在严格运行时顺序。互斥分支和完成顺序不确定的并发调用不应填写
`order`。

控制流字段不携带文件系统路径，也不生成虚拟节点或第二套连线。`/api/open` 与
`/api/preview` 仍只接受真实 node/edge ID。后端负责枚举、端点和源码证据校验；前端基于
真实有向边计算所选节点的上游和下游，不依赖额外分支配置。

调用图 0.4 可提供带布局顺序的 `phases`，节点通过单个可选 `phaseId` 归属调用图内部阶段。
阶段保留为调用图内部的可选说明与兼容数据，主工作台不再用它生成场景地图、切换页面、
自动聚焦阶段或定位视口。`phase.order` 仅是稳定布局提示，不代表严格线性执行。
点击真实节点时，路径聚焦仍只依据原始 `nodes / edges`。

## 独立场景页面

本次页面集成将原先同一工作区内的「场景 / 调用图」切换改为普通页面链接：

- `/` 始终是调用图与源码工作台，不等待场景目录 API，不挂载阶段 / 架构场景控制器。
- `/scenes/index.html` 是静态场景目录；`/scenes/*.html` 是独立 HTML / SVG 时序文档。
  场景文件无需 JavaScript、GraphState、调用图 JSON、阶段映射或选择状态即可完整显示。
- 两页只通过普通 `href` 往返。场景可链接 `/?graph=<slug>`；工作台仅从已加载的图目录
  中选择此 slug，未知值提示后回退首张图。不会将 URL 参数作为源码路径或目标 ID 使用。
- 场景按自身叙事维护参与者、消息、条件与源码依据；不要求与节点、边或 phase 一一对应。
  不维护点击联动、跨页选中状态、缩放状态或下钻映射。
- 新文件由现有静态文件服务托管，没有新增 HTTP / JSON 协议。复用本地
  `/scenes/scenes.css`，保持现有 CSP，不加载 CDN、内联脚本或内联样式块。

前端拥有页面与样式；场景叙事属于需要源码核对的集成内容。独立生成规范见
[`scenario-authoring.md`](scenario-authoring.md)。旧 API 与实验页的退出迁移另行处理。

场景生成现改为构建期数据契约：模型原先直接维护 `public/scenes/*.html`，现在只维护
`scenes/*.json`，由 `schema/sequence-scene.schema.json` 约束参与者、消息、嵌套控制流和
源码依据。`frontend/scenes/` 校验引用并自动排版，`scripts/build_scenes.mjs` 生成页面与目录；
生成文件不手工修改。此 JSON 不通过 HTTP 提交，不增加 Rust 模型或浏览器 API 适配器。
后端继续只托管生成的静态文件，现有 `/api/scenarios` 和调用图协议保持兼容。
数据与 Schema 属于集成内容；共用渲染器和构建脚本由前端拥有。测试覆盖可重复生成、
无效输入保留旧页面和静态阅读，模型无需承担布局或完整绘图 skill 的执行负担。

场景输入再次扩展：旧入口为完整 `scenes/<slug>.json`；新推荐入口为同名 `.mmd` 时序文本
与 `.json` 元数据（`schema/mermaid-scene.schema.json`）。Mermaid 仅支持文档列明的子集，
未知语法带文件和行号失败；元数据不能重复声明 participants/body。两种入口在构建期
归一到同一个 sequence-scene 数据模型，复用校验和渲染器，不新增运行时依赖或 HTTP API，
因此不涉及 Rust 序列化或 public/js/api.js 变更。原有完整 JSON、静态 URL 和基础跳转兼容。
集成测试从统一加载入口读取两种输入，覆盖控制流保真、失败时保留旧页面和浏览器静态阅读。

所有图均由 `NarrativeLayout` 展示。点击任意节点只改变阅读强调层级，不隐藏节点、不重排
布局，也不重置 viewport。循环回边参与绘制和强调，但不作为上下游遍历的扩散通道。
详细交互约束见 `docs/node-path-focus.md`。

## 前端内部边界

```text
CallgraphApi
    ├── GraphState / TraceNavigator
    ├── Layout adapter ── LayeredLayout
    ├── RendererRegistry ── SvgRenderer
    ├── ThemeRegistry
    └── SourcePreviewController
              └── SourcePreviewView
                       └── SourceCodeSurfaceRegistry
                              ├── Monaco iframe
                              └── safe DOM fallback
```

图形实现、布局算法和代码预览实现互不拥有对方状态。新增 G6、Canvas、WebGL、Tree-sitter
或 LSP 时，应注册新实现或新增适配器，不得把依赖写入 `GraphState`、`TraceNavigator`
或基础文件预览器。

## 后端内部边界

```text
HTTP / CLI
    ├── GraphStore
    ├── LayoutStore
    ├── ProjectCatalog
    ├── SourcePreviewer
    ├── SourceLinkBuilder
    └── validation
```

HTTP 层负责组合这些接口，不负责分析特定语言。语言分析能力以后应作为新的显式接口接入，
并允许基础源码预览在分析器未安装、超时或失败时继续工作。

## 并行迭代流程

1. 两个智能体分别使用独立 Git worktree。
2. 非契约功能只修改各自主要目录和对应测试。
3. 契约变化先更新本文件、模型或 Schema，并增加失败用例。
4. 后端实现并通过 Rust 门禁；前端实现可先用固定 JSON/路由 Mock 开发。
5. 合并后运行真实 Rust 服务上的 Playwright E2E，而不是只验证 Mock。
6. 运行四份 Codex 示例图校验，防止通用化改动破坏真实数据。

## 完成定义

- 没有越过角色文件所有权进行顺手重构。
- 接口变化有契约说明、后端校验和前端消费测试。
- 前端可在后端失败时显示错误，代码面可回退到 DOM 实现。
- 后端不依赖浏览器实现、Monaco、SVG 或特定语言分析器。
- 本地构建不依赖 CDN，不提交用户运行时布局。
- 组合应用通过 Rust 测试、Clippy、前端构建、调用图校验和 Playwright E2E。

场景配色契约：完整 JSON 与 Mermaid 元数据都可选填 theme，取 editorial / halo / aether /
signal，省略时使用 editorial。此字段仅控制生成 HTML 的主题属性；根据参与者、消息类型
与控制流类型自动分色，不改变执行语义。仍为静态构建输入，无 HTTP/API 变化，后端仅托管
产物。主题选择独立于工作台的运行时选中状态，不需要脚本或跨图同步。
