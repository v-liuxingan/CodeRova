# 源码预览工作台设计

## 目标

源码预览不是 IDE 的缩小版，而是调用链阅读过程中的稳定上下文。它优先解决三件事：

1. 全面：同时展示节点定义范围、调用点、语言、文件规模和上下文是否被裁剪。
2. 快捷：连续步进不离开浏览器，相邻调用位置与节点提前预取，并支持预览内查找。
3. 安全：前端不能指定任意路径，后端只读受限文本，不执行源码、语言服务器或命令行。

## 产品参考

- [Sourcegraph Code Navigation](https://sourcegraph.com/docs/code-navigation) 把 hover、定义、引用和
  实现视为不同能力；本项目因此把基础预览与未来的语义导航适配器分离。
- [GitHub Code Navigation](https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github)
  使用符号面板、定义/引用卡片和前后结果导航；本项目先吸收就地查找与稳定位置展示。
- [Visual Studio Peek Definition](https://learn.microsoft.com/en-us/visualstudio/ide/how-to-view-and-edit-code-by-using-peek-definition-alt-plus-f12)
  强调保留原阅读位置，并允许在多个结果间移动；这与调用链步进保持浏览器焦点的目标一致。
- [Monaco Editor](https://github.com/microsoft/monaco-editor) 提供成熟的虚拟滚动、真实行号、
  折叠、查找与键盘交互。当前把固定版本的必要模块构建为本地只读代码面，不依赖 CDN。
- [AntV G6 Dagre 示例](https://g6.antv.antgroup.com/examples/layout/dagre/#antv-dagre-combo)
  使用独立、全高的右侧代码面板，让画布与代码保持并列。进一步检查其站点主题实现后确认
  代码面基于 `@monaco-editor/react`；本项目吸收这条编辑器能力路线，但不用 React、不加载
  AntV 的远程 Monaco loader，也不搬运执行、AI、StackBlitz 或 Riddle 集成。

## 当前模块边界

```text
PreviewRequest(graph, target, context, scope)
             │
             ▼
HTTP target resolver ── project root boundary
             │
             ▼
SourcePreviewer trait ── FileSourcePreviewer
             │             ├─ UTF-8 / binary check
             │             ├─ file / line / response caps
             │             └─ language and truncation metadata
             ▼
SourcePreviewController ── cancellation / LRU cache / neighbor prefetch
             │
             ▼
SourcePreviewView ── find / range controls / surface lifecycle
             │
             ▼
SourceCodeSurfaceRegistry
       ├── MonacoSourceCodeSurface ── isolated iframe / local worker
       └── DomSourceCodeSurface ───── safe fallback / SyntaxHighlighterRegistry
```

页面布局也保持独立：

```text
Inspector ── target details / preview render adapter
     │
     └── InspectorWorkbenchController ── semantic summary + source evidence
                         │                focus / collapse
                         └── ResizablePanelController ── width policy
```

源码不再嵌套在详情长页面中，而是参考图可视化示例的右侧代码面板，作为一级全高工作台。
默认宽度为 520px；可以拖动分隔条、用键盘调整宽度、扩展到窗口允许的最大宽度，或折叠为
44px 窄条。当前目标的语义摘要固定在工作台顶部，源码证据占据剩余高度，两者保持独立
挂载边界并随选择同步更新；仅显式点击打开操作才会触发外部编辑器。

`SourcePreviewer` 不依赖 Rust、LSP 或语法树。当前语言识别只根据扩展名提供展示元数据。
默认 `MonacoSourceCodeSurface` 支持 Rust、JavaScript、TypeScript、Python 和 Go 的基础着色；
未知语言显示为纯文本。Monaco 装载失败时，注册表自动切换 `DomSourceCodeSurface`，后者通过
轻量着色器和文本节点渲染，基础预览不会随编辑器依赖失效。

未来的 Tree-sitter、LSP 或 SCIP 支持应实现新的语义信息接口，以进程外、按项目显式配置的方式
运行。基础文件预览在这些能力缺失或失败时仍必须可用。

## 安全预算

- 请求只接受调用图 slug、目标类型、目标 ID、受上限约束的上下文行数和
  `target` / `file` 预览范围。
- 规范化后的真实文件必须位于配置的项目根目录下，可阻止 `..` 和符号链接逃逸。
- 默认文件上限 4 MiB；`target` 上下文最多 40 行、响应最多 240 行；
  `file` 仅由用户显式触发且不参与相邻目标预取，并设置独立整文件行数预算；
  两种模式的单行都最多返回 4000 个字符。
- 拒绝包含 NUL 的疑似二进制文件和非 UTF-8 文本。
- 源码始终通过 `textContent` / 文本节点写入 DOM；着色器不产生来源于源码的 HTML。
- Monaco、语言模块和 Worker 都从固定版本的本地构建产物加载，不连接 CDN。
- Monaco 运行在独立同源 iframe。主应用 CSP 继续禁止内联样式；只有预览文档允许 Monaco
  布局所需的内联样式，并禁止外部连接、表单、对象和跨站嵌入。
- HTTP 启用 CSP、`nosniff`、嵌入限制、无 referrer、敏感能力禁用和 `no-store`。
- 连续步进与预览不会执行 shell、编辑器或语言分析器；外部编辑器仍需显式操作。
