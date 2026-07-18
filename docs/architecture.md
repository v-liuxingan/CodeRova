# 架构与扩展点

## 依赖方向

```text
HTTP / CLI adapters
       │
       ├── GraphStore ─────── FileGraphStore
       ├── SourceLinkBuilder ─ VscodeUriLinkBuilder
       ├── validation
       └── domain model

UI controller
       ├── GraphState
       ├── Layout ─────────── LayeredLayout
       ├── Renderer ───────── SvgRenderer
       └── CallgraphApi
```

核心原则是数据模型不依赖存储、HTTP、编辑器或图形技术。

## 后端接口

### `GraphStore`

负责列举和读取调用图。默认 `FileGraphStore` 读取 `graphs/*.json`。如果以后需要
SQLite、Git 版本库或实时分析器，可实现相同的 `list` / `load` 边界，HTTP 层无需改变。

### `SourceLinkBuilder`

负责把已经过验证的源码位置转换成外部编辑器 URI。默认 `VscodeUriLinkBuilder` 生成：

```text
vscode://file/<absolute-path>:<line>:<column>
```

VSCode Insiders、JetBrains、远程开发桥接或仅复制位置的实现都可以替换它。路径规范化
和源码根目录边界校验发生在生成 URI 之前。后端只返回数据，不启动 PowerShell、
`cmd.exe`、编辑器或任何其他子进程；前端在用户明确点击后把 URI 交给浏览器。

### `validation`

校验分为两层：

1. 图约束：schema 版本、ID 唯一性、端点存在、枚举、置信度、相对路径。
2. 源码约束：文件存在、行号不超过文件长度、路径没有逃逸源码根目录。

## 前端接口

### `GraphState`

只管理图的可见性与选择状态，不读写 DOM。折叠、隐藏、边类型筛选和路径聚焦都在这里
计算，因此换渲染器不会丢失交互语义。

### Layout

`LayeredLayout.compute(graph, orientation)` 输出节点坐标、边端点和边界。它不生成 SVG。
后续可以加入 Sugiyama、力导向或人工固定位置布局。

### Renderer

渲染器约定支持：

- `render(graph, state)`
- `fit()`
- `zoomBy(factor)`
- `setCallbacks(callbacks)`

`RendererRegistry` 负责按名称创建实现。当前 `SvgRenderer` 是默认实现；Canvas 或 WebGL
实现可以复用 `GraphState` 和任意布局器。

## 调用关系语义

图是一般有向图，不强制为树。`direct` 表示确定的调用表达式，间接关系必须使用
`callback`、`trait-dispatch`、`spawn`、`async-boundary` 或 `data-flow`。每条边携带：

- 调用发生位置；
- 人类可读的 evidence；
- 0 到 1 的 confidence。

样例中的 `AuthManager::shared_from_config → ModelClient::current_client_setup` 是跨启动阶段
和请求阶段的数据流，不是直接函数调用，因此显式标记为 `data-flow` 和较低置信度。
