# Callgraph Visualizer

本地源码执行流程工作台。按项目组织调用图与场景地图，通过源码证据理解入口、调用分支和异步交接。

## 进入平台

```powershell
cargo run -- serve --port 4324
```

访问 `http://127.0.0.1:4324/`，在项目资料库点击调用图或场景地图直接阅读。
平台只有一个 G6 工作台，不再提供经典版本或版本切换。

- `/`：所有项目的内容入口，支持搜索、亮色和深色主题。
- `/?graph=<slug>`：调用图阅读、源码预览、采集与编辑。
- `/scenes/<slug>.html`：场景时序图。
- 旧 `/v2/?graph=<slug>` 书签自动归一化为根链接，不加载旧实现。

## 使用手册

[工作台 Skill](docs/skills/callgraph-workbench/SKILL.md) 是当前操作入口：

- [页面操作](docs/skills/callgraph-workbench/references/workbench.md)：目录、分支、隐藏、删除、侧栏与保存。
- [分析与自动化](docs/skills/callgraph-workbench/references/analysis.md)：生成初始图、断点续采、异步节点与验收。
- [IDEA 本机配置](docs/skills/callgraph-workbench/references/idea-setup.md)：编辑器跳转的协议关联。
- [AI 操作协议](docs/ai-operations.md)：HTTP 与草稿 API。

## 当前能力

- G6 调用路径图，共享方法引用、按需展开、分支收起、缩略图、横纵布局。
- 项目目录与分组管理、调用图归档及恢复；回收站内再次删除才删除图配置文件。
- 节点及调用点源码预览，VS Code / IntelliJ IDEA 跳转；外部编辑器需配置本机协议关联。
- Rust rust-analyzer 与 Java Eclipse JDT LS 项目内静态分析、请求预算、停止及断点续采。
- 人工异步入口、多态实现选择、减枝，均可在草稿中审阅后统一保存。
- 临时隐藏不写文件；收起与隐藏回收空位并保留操作上下文。
- Mermaid 时序文本与元数据交给共享渲染器，模型无需生成页面或几何坐标。

静态关系不等于运行轨迹，LSP 查询成功不等于动态分派、反射和业务流程完整。
当前手动拖动节点位置不持久保存。主题、目录偏好和侧栏宽度保存在浏览器。

## 环境与配置

使用已编译程序及配套 `public` 资源时，无需 Node.js。源码分析需相应语言服务器、工具链和项目依赖。
源码构建需要 Rust/Cargo 与 Node.js/npm；Python 操作客户端仅依赖标准库，浏览器测试额外需要 Playwright。

- `callgraph.projects.json`：可信项目根目录与名称。
- `callgraph.lsp.local.json` / `CALLGRAPH_LSP_CONFIG`：本机 Java LSP 配置，不提交。
- `graphs/`：调用图数据；`scenes/`：独立时序图输入。
- `frontend/workbench/`：当前工作台实现；`public/workbench/`：主页与样式。
- `public/vendor/workbench/`、`public/vendor/monaco/`：构建生成的本地资源，不依赖 CDN。

## 开发与验证

```powershell
npm ci
npm run build:frontend
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
python tests/run_e2e.py
```

浏览器门禁使用临时项目和图文件，不操作用户数据。真实 Java LSP 集成测试见
`tests/java_lsp_test.py`、`tests/java_polymorphism_test.py`，需要本机 JDT LS 配置。
内容生成和源码证据验收见 [图内容生成](docs/graph-authoring.md) 与 [证据检查](docs/content-verification.md)。
不要自动刷新源码指纹来消除过期证据警告。

## 设计与边界

[产品战略](docs/product-strategy.md) · [开发边界](docs/agent-development-boundaries.md) ·
[系统设计](docs/system-design.md) · [开发进度](docs/development-status.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

历史设计/验收文档可能记录已退役界面，当前使用方式以上述 Skill 为准。
