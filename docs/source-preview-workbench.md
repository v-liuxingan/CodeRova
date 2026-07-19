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
- [Monaco Editor API](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.ICodeEditor.html)
  适合完整编辑器能力，但模型、worker、焦点和生命周期管理更重。当前只读预览不引入它，
  后续若需要大文件虚拟滚动，可作为独立 `SourcePreviewView` 实现接入。

## 当前模块边界

```text
PreviewRequest(graph, target, context)
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
SourcePreviewView ── safe DOM / find / range controls
             │
             ▼
SyntaxHighlighterRegistry ── lightweight language adapters / plain fallback
```

`SourcePreviewer` 不依赖 Rust、LSP 或语法树。当前语言识别只根据扩展名提供展示元数据；
轻量着色器注册表支持 Rust、JavaScript、TypeScript、Python 和 Go，其他语言安全回退到纯文本。

未来的 Tree-sitter、LSP 或 SCIP 支持应实现新的语义信息接口，以进程外、按项目显式配置的方式
运行。基础文件预览在这些能力缺失或失败时仍必须可用。

## 安全预算

- 请求只接受调用图 slug、目标类型、目标 ID 和受上限约束的上下文行数。
- 规范化后的真实文件必须位于配置的项目根目录下，可阻止 `..` 和符号链接逃逸。
- 默认文件上限 4 MiB，上下文最多 40 行，响应最多 240 行，单行最多 4000 个字符。
- 拒绝包含 NUL 的疑似二进制文件和非 UTF-8 文本。
- 源码始终通过 `textContent` / 文本节点写入 DOM；着色器不产生来源于源码的 HTML。
- HTTP 启用 CSP、`nosniff`、禁止嵌入、无 referrer、敏感能力禁用和 `no-store`。
- 连续步进与预览不会执行 shell、编辑器或语言分析器；外部编辑器仍需显式操作。

