<p align="center">
  <img src="public/brand/callgraph-mark.svg" width="80" height="80" alt="CodeRova Logo">
</p>
<h1 align="center">CodeRova</h1>
<p align="center">从入口理解调用流程，在源码中验证每一步。</p>
<p align="center"><a href="#快速开始">快速开始</a> · <a href="#lsp-配置">LSP 配置</a> · <a href="docs/skills/callgraph-workbench/SKILL.md">使用手册</a> · <a href="LICENSE">MIT License</a></p>

本地运行的源码调用图工作台。使用 Rust / Java 语言服务器生成调用关系，再通过按需展开、源码预览、分支整理和异步入口补充，把陌生项目整理成可验证的执行路径。人和 AI 均可操作。

## 页面预览

**项目资料库** — 按项目统一浏览调用图与场景地图。

![项目资料库](docs/images/project-library.jpg)

**调用图工作台** — 从入口逐层展开，结合调用位置、缩略图与源码定位理解分支。

![调用图工作台](docs/images/callgraph-workbench.jpg)

截图来自本地实际运行页面；项目列表和已采集内容取决于你的本机数据。

## 能做什么

| 功能 | 使用方式 |
| --- | --- |
| 从源码创建调用图 | 选择项目、文件和方法所在行，创建根节点，再配置采集范围 |
| LSP 采集与续采 | 支持 Rust rust-analyzer、Java Eclipse JDT LS；可停止任务、从未采集的叶子节点继续 |
| 阅读大图 | 按需展开、收起分支、横纵布局、缩略图、链路高亮与调用位置标注 |
| 补充与整理 | 添加异步入口；保留多态方法与实现供选择；隐藏或删除节点及下游分支 |
| 验证源码 | Monaco 源码预览、搜索与行选择；跳转 VS Code / IntelliJ IDEA |
| 审阅后保存 | 采集结果先预览，新增与删除在草稿中整理，确认后保存；离开未保存页面会提示 |
| 管理图谱 | 项目目录、可折叠分组、拖拽、回收站恢复；侧栏可收起和调整宽度 |
| 场景时序图 | Mermaid 文本与元数据由共享渲染器生成页面，无需手写页面或布局坐标 |
| AI 操作 | 提供工作台 Skill、HTTP API 和操作脚本，可生成、续采、整理并保存图谱 |

> 调用图是静态分析结果，不是运行时轨迹。反射、框架回调、动态分派、宏等可能需要补充或人工确认；调用位置也不等于实际执行次数。

## 快速开始

### Windows 免安装版（推荐）

1. 打开 [GitHub Releases](https://github.com/v-liuxingan/callgraph-visualizer/releases/latest)，下载 `coderova-v版本号-windows-x64.zip`（不是 Source code）。
2. **完整解压**到可写目录，双击 `Start.cmd`。启动器自动选择空闲本机端口，服务就绪后打开浏览器。
3. 保持启动窗口打开；结束使用时按 `Ctrl+C` 停止服务。

无需安装 Rust、Node.js 或 Python。包内自带前端资源，初始项目列表为空，不包含作者的本机数据。
编辑包内 `callgraph.projects.local.json` 添加源码项目，重启后即可新建图；格式见下文。
采集功能仍需配置相应 LSP 和目标项目工具链；免安装的是工作台本身。

压缩包旁提供 SHA-256 校验文件。当前包面向 Windows x64，未进行代码签名。
如果 Windows 策略阻止 PowerShell 脚本，请遵循管理员策略；也可在解压目录的终端直接启动：

```powershell
.\coderova.exe serve --port 4324 --config callgraph.projects.local.json
```

然后手动访问 http://127.0.0.1:4324/ 。

**升级：** 解压新版到新目录，再复制原来的 `graphs/`、`layouts/`、`callgraph.projects.local.json` 和可选的 `callgraph.lsp.local.json`。不要用包内空配置覆盖已有数据。无需重新编译。

以下是源码构建方式。

### 1. 准备环境

- Git。
- [Rust / Cargo](https://www.rust-lang.org/tools/install)：当前 stable 工具链；项目使用 Rust 2024 edition。Windows 使用 MSVC 工具链时还需 Visual Studio C++ Build Tools。
- [Node.js](https://nodejs.org/en/download)：22 或更新版本，带 npm，用于构建前端。
- **只阅读已有图不需要 LSP**；采集 Rust / Java 时再安装下文对应的语言服务器和目标项目工具链。

### 2. 克隆并启动

在 PowerShell、Git Bash 或终端执行：

```sh
git clone https://github.com/v-liuxingan/callgraph-visualizer.git
cd callgraph-visualizer
npm ci
npm run build:frontend
cargo run --locked -- serve --port 4324
```

打开 **http://127.0.0.1:4324/**。首次启动会编译 Rust，后续启动可复用构建结果。终端保持运行，按 `Ctrl+C` 停止。

仓库自带示例图。可先查看 **CodeRova** 项目；其他示例的源码目录需要按下一步映射到本机。所有前端资源在本地提供，无需 CDN；首次安装 npm / Cargo 依赖需要联网。

### 3. 配置自己的项目

在仓库根目录新建 `callgraph.projects.local.json`：

```json
{
  "schemaVersion": "0.1",
  "projects": [
    {
      "id": "callgraph-visualizer",
      "name": "CodeRova",
      "root": "."
    },
    {
      "id": "my-app",
      "name": "我的项目",
      "root": "E:/projects/my-app"
    }
  ]
}
```

将 `my-app` 的路径替换成**已存在的源码项目根目录**，不需要它时删除该项。Linux / macOS 可用 `/home/me/projects/my-app` 等路径。

- `id` 是图数据引用的项目标识，创建图后应保持稳定。
- `root` 支持绝对路径或相对于**配置文件所在目录**的路径；Java 通常指向 Maven / Gradle 根项目，Rust 指向 Cargo 工作区。
- Windows JSON 路径推荐 `/`；使用反斜杠时需写成 `\\`。
- 源码必须位于所选项目根目录内，支持任意层级子目录。此范围用于源码读取校验与 LSP 工作区定位。
- 此本机配置文件已被 Git 忽略，避免提交个人路径。它不会自动覆盖默认配置，启动时需显式传入：

```sh
cargo run --locked -- serve --port 4324 --config callgraph.projects.local.json
```

图默认写入 `graphs/`；若不想混用仓库示例，可以先创建自己的目录，再指定 `--graphs <目录>`。主题、侧栏等界面偏好与图文件分开保存。

### 4. 创建第一张图

1. 完成对应语言的 [LSP 配置](#lsp-配置)，重启服务。
2. 首页点击 **新建图**，选择项目并输入图名。
3. 选择或输入项目内的源文件，在编辑器中搜索目标方法，点击其声明所在行。
4. 校验入口后创建根节点，设置采集深度、预算和排除目录，再开始采集。
5. 任务完成后查看新增节点数，加载结果审阅；确认需要保留的改动后点击 **保存**。
6. 需要深入时，在未采集的叶子节点上右键选择 **继续采集**。收起的节点不一定是未采集的叶子节点。

采集深度控制本轮分析范围；展示深度只控制画布展开范围，两者不同。临时隐藏不写入图文件；删除属于草稿改动，需要保存后生效。已有图的编辑不会因为刷新页面自动保存。

### 编译后运行

```sh
cargo build --release --locked
```

从仓库根目录启动，确保相对资源路径正确：

```powershell
# Windows PowerShell
.\target\release\callgraph-visualizer.exe serve --port 4324 --config callgraph.projects.local.json
```

```sh
# Linux / macOS；Windows Git Bash 则使用 .exe 后缀
./target/release/callgraph-visualizer serve --port 4324 --config callgraph.projects.local.json
```

部署时需携带 `public/` 及所需配置、图数据；单独复制可执行文件不包含前端。已编译程序运行不需要 Node.js。默认监听 `127.0.0.1`，面向本机使用；不传 `--port` 时默认端口为 `4317`。

## LSP 配置

### Rust：rust-analyzer

```sh
rustup component add rust-analyzer rust-src
rust-analyzer --version
cargo metadata --format-version 1 --no-deps
```

最后一条在**待分析项目根目录**运行，用于检查 Cargo 工作区。启动平台的终端必须能找到 `rust-analyzer`，仅在编辑器中安装扩展不保证命令可用。项目若指定 `rust-toolchain.toml`，也需为对应工具链安装所需组件。参见 [rust-analyzer 安装说明](https://rust-analyzer.github.io/book/installation.html)。

Rust 无需另建 LSP JSON 配置。当前默认关闭构建脚本和过程宏执行，因此依赖这些能力的调用关系可能缺失。

### Java：Eclipse JDT LS

1. 下载并解压 [JDT LS milestone 发行包](https://download.eclipse.org/jdtls/milestones/)。
2. 安装该版本要求的运行 JDK。[当前官方说明](https://github.com/eclipse-jdtls/eclipse.jdt.ls#requirements)要求 **JDK 25 或更新版本**启动服务器；目标项目自身仍可能使用其他 JDK，需满足其 Maven / Gradle 构建要求。
3. 将 [配置模板](callgraph.lsp.example.json) 复制为根目录下的 `callgraph.lsp.local.json`，修改其中的本机路径：

```json
{
  "java": {
    "command": "E:/tools/jdk-25/bin/java.exe",
    "args": [
      "-Declipse.application=org.eclipse.jdt.ls.core.id1",
      "-Dosgi.bundles.defaultStartLevel=4",
      "-Declipse.product=org.eclipse.jdt.ls.core.product",
      "-Xmx2G",
      "--add-modules=ALL-SYSTEM",
      "--add-opens", "java.base/java.util=ALL-UNNAMED",
      "--add-opens", "java.base/java.lang=ALL-UNNAMED",
      "-jar", "E:/tools/jdtls/plugins/org.eclipse.equinox.launcher_REPLACE_WITH_ACTUAL_VERSION.jar",
      "-configuration", "E:/tools/jdtls/config_win",
      "-data", "{workspace}"
    ],
    "workspaceRoot": "E:/caches/callgraph-jdtls",
    "settings": {}
  }
}
```

**需要修改的部分：**

| 字段 | 填写要求 |
| --- | --- |
| `command` | 启动 JDT LS 的 Java 可执行文件绝对路径 |
| `-jar` 后的参数 | 解压包中实际存在的 `plugins/org.eclipse.equinox.launcher_*.jar` 文件名；不能保留占位符或使用 `*` |
| `-configuration` 后的参数 | 对应操作系统和架构的配置目录；Windows 示例为 `config_win`，其他平台以解压包为准 |
| `workspaceRoot` | 可写的索引缓存目录；平台为各项目创建独立子目录 |
| `{workspace}` | 原样保留，平台自动替换，不要填源码目录 |
| `settings` | 可选的 JDT LS 设置，如项目 JDK、Gradle / Maven 导入配置 |

配置通过标准输入输出启动独立 JDT LS，不会连接 IDEA 或 VS Code 内部的语言服务器。平台不负责安装 JDK、Gradle、Maven 或项目依赖。

也可通过环境变量指定配置文件，然后从同一终端启动平台：

```powershell
# PowerShell
$env:CALLGRAPH_LSP_CONFIG = 'E:/config/callgraph.lsp.local.json'
```

```sh
# Bash
export CALLGRAPH_LSP_CONFIG=/home/me/config/callgraph.lsp.local.json
```

Java 首次导入大型项目需要建立索引和解析依赖，可能明显慢于后续查询。建议先确认目标项目能通过自身的 Maven / Gradle 导入；不要在依赖尚未下载时开启离线模式。平台可复用安全条件满足的短期 LSP 会话，但源码、配置变化或任务异常时会重新创建。

### 并发、超时与重试

在本地 `callgraph.lsp.local.json` 顶层添加 `collection`（与 `java` 同级），Rust 和 Java 共用：

```json
{
  "collection": {
    "concurrency": 4,
    "requestTimeoutSeconds": 30,
    "maxRetries": 3
  }
}
```

已有 Java 配置保留 `java` 部分，不要用上面片段覆盖整个文件。配置缺省时使用上面的默认值。
并发范围 1–32，查询超时范围 1–300 秒，重试范围 0–3。`maxRetries: 3` 表示首次之外最多重试 3 次，总计最多 4 次；预算按方法计数，不把重试当作新增方法。
超时会结束本次等待、发送 LSP 取消通知，迟到响应不再写入图。服务器不支持取消时可能仍在计算，不能保证物理计算立即停止。
超时及可重试的服务器内部错误使用新的请求 ID 重试；参数/协议错误与断开连接不盲目重试。
达到重试上限的节点保留为未完成并记录原因，其他分支继续，已成功的关系可采纳保存。
主进程仍同时只接受一个采集任务；并发指的是该任务内部的节点查询，不是多个图抢占同一会话。
新任务读取配置，配置变化使原热会话失效；初始化和项目索引等待不使用单次查询的 30 秒上限。

### 分析范围与多态

- 以配置的项目根目录为分析范围，不递归展开第三方依赖内部调用。
- 预算或深度耗尽会保留待采集边界，可继续采集；不要把“本轮完成”理解为“全项目已分析完”。
- 多态方法与实现使用虚线连接。只有一个可确认实现时继续采集；多个实现保留到实现方法一层，由人或 AI 选择需要深入的分支。
- 排除项使用项目相对文件或目录路径，不是任意 glob 表达式。

## 源码跳转

内置源码预览无需外部编辑器。需要在 IDE 中继续阅读时，在工作台选择 **VS Code** 或 **IntelliJ IDEA**。

- VS Code：本机需安装并注册 `vscode://` 协议。
- IntelliJ IDEA：本机需正确关联 `idea://` 协议。按 [IDEA 配置指南](docs/skills/callgraph-workbench/references/idea-setup.md) 配置并验证；仅安装 IDEA 不代表浏览器已能打开该协议。

## 常见问题

| 现象 | 检查方法 |
| --- | --- |
| 首页有示例，但源码打不开 | 示例引用其他项目；检查项目 `id` 和 `root`，并确认启动命令传了 `--config` |
| 提示项目中没有源文件 | 检查所选项目、根目录与文件相对路径；子目录受支持，但根目录外的文件不能读取 |
| Java 入口校验失败或采集很慢 | 检查 Java / launcher JAR / 配置目录是否存在、JDK 版本是否匹配，以及项目依赖是否可解析 |
| 新增节点为 0 | 可能无下游调用、达到预算、被排除或 LSP 尚无法解析；结合任务详情和源码判断 |
| 找不到 rust-analyzer | 在启动平台的同一个终端执行 `rust-analyzer --version`，检查 PATH 和 rustup 工具链 |
| 修改后刷新丢失 | 预览和草稿不会自动写入图文件，保留改动需点击保存 |
| 端口被占用 | 停止原终端中的服务，或换用 `--port 4325` |
| 复制程序后页面打不开 | 同时携带 `public/`，从正确工作目录运行，或显式指定 `--public` |

## 使用手册与 AI 接入

[工作台 Skill](docs/skills/callgraph-workbench/SKILL.md) 是完整操作入口，可供支持 Skill 的 AI 工具阅读：

- [页面操作](docs/skills/callgraph-workbench/references/workbench.md)：目录、分支、隐藏、删除、侧栏与保存。
- [分析与自动化](docs/skills/callgraph-workbench/references/analysis.md)：初始图、断点采集、异步节点与验收。
- [AI 操作协议](docs/ai-operations.md)：HTTP API 与草稿操作。
- [图内容生成](docs/graph-authoring.md)：调用图与 Mermaid 场景地图的统一入口。
- [证据检查](docs/content-verification.md)：验证源码位置、内容和过期证据。

## 开发与验证

```sh
npm ci
npm run build:frontend
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
python -m pip install playwright
python -m playwright install chromium
python tests/run_e2e.py
```

Python 用于测试和可选操作脚本，日常运行服务无需 Python。浏览器测试使用隔离的临时项目和图目录。真实 Java LSP 测试另见 `tests/java_lsp_test.py`、`tests/java_polymorphism_test.py`，需要本机 JDT LS 配置。

| 目录 | 内容 |
| --- | --- |
| `src/` | Rust HTTP 服务、存储、源码校验、LSP 采集 |
| `frontend/workbench/` | G6 渲染、布局与交互 |
| `public/` | 页面、主题、Logo 和构建后的本地资源 |
| `graphs/` | 调用图 JSON |
| `scenes/` | 场景时序图输入，执行 `npm run build:scenes` 生成页面 |
| `schema/` | 数据格式约束 |
| `docs/` | 系统设计、操作手册与开发约定 |

不要手改生成的前端资源，或自动刷新源码指纹来消除过期证据警告。当前节点拖动位置不持久保存；历史设计文档可能描述已退役界面，当前操作以 Skill 为准。

[产品战略](docs/product-strategy.md) · [开发边界](docs/agent-development-boundaries.md) · [系统设计](docs/system-design.md) · [开发进度](docs/development-status.md)

## 发布 Windows 包

GitHub Actions 工作流 [`release-windows.yml`](.github/workflows/release-windows.yml) 在推送 `v*` 标签时执行前后端检查、编译、打包和解压启动测试，通过后上传 ZIP 与 SHA-256 到 GitHub Releases。使用静态 CRT 链接减少额外运行库依赖。

```sh
git tag v0.1.0
git push origin v0.1.0
```

后续发布使用新的版本号。Actions 手动运行只生成可下载的构建产物，不发布 Release。
本地构建后也可执行 `./scripts/package_windows.ps1 -Version v0.1.0`，输出位于 `target/packages/`。打包使用白名单，不收录本机图谱、配置、索引缓存或运行日志。

## 开源许可证

本项目采用 [MIT License](LICENSE)。第三方组件保留各自的许可证和版权声明，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。


### CodeRova 分析

平台统一使用 LSP，按源码语言选择语言服务器，不再提供 AST 分流。取舍与实测边界见 [分析器决策](docs/analyzer-decision.md)。

## 名称与兼容

产品统一命名为 **CodeRova**。Windows 发布包使用 `coderova-<版本>-windows-x64.zip`，包内程序为 `coderova.exe`。
现有 GitHub 仓库地址暂不变；源码构建的 Cargo 包及二进制仍使用 `callgraph-visualizer`，以上源码启动命令可继续使用。
`callgraph.*.json` 配置、`CALLGRAPH_*` 环境变量、项目 ID 和浏览器偏好键保持兼容，无需迁移已有数据。
