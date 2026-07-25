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
| `GET /api/graphs/{slug}/layout` | 路径 slug | `GraphLayout` | `schema/layout.schema.json` |
| `PUT /api/graphs/{slug}/layout` | `GraphLayout` | 保存后的 `GraphLayout` | 共享 |
| `GET /api/graphs/{slug}/validation` | 路径 slug | `ValidationReport` | 后端 |
| `POST /api/open` | `{ graph, targetType, id }` | `{ uri, path, line, column }` | 共享 |
| `POST /api/preview` | `{ graph, targetType, id, contextLines?, scope? }` | `SourcePreview` | 共享 |

浏览器访问统一封装在 `public/js/api.js`。Rust 序列化模型位于 `src/model.rs`，图、项目和
布局的持久化契约分别以 `schema/*.schema.json` 为准。API 字段统一使用 `camelCase`。

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

调用图 0.4 可提供带布局顺序的 `phases`，节点通过单个可选 `phaseId` 归属场景阶段。
阶段用于回答“当前执行到哪一部分”并支持语义缩放、场景拓扑和视口定位。前端必须从真实
边两端节点的 `phaseId` 确定性聚合跨阶段关系。拓扑默认展示连续阶段主干以及具有明确
`flowKind` 的分支、汇合、回环和退出；普通非相邻捷径保留在完整调用图中，避免概览重复
主图的全部连线。`phase.order` 仅是稳定布局提示，不代表严格线性执行。

场景拓扑不得引入 `phaseLinks`、虚拟节点、分组边、第二套调用关系或阶段专属高亮清单。
阶段定位必须保留当前缩放比例，不得重排节点。点击真实节点时，路径聚焦仍只依据原始
`nodes / edges`，不能改用阶段聚合关系。

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
