## 多语言采集边界首轮重构（2026-11-14）

内部后端重构及集成回归任务：适配器统一解析调用事实，共享符号索引，服务器档案隔离 JDT
兼容规则；客户端增加会话标识和协议序列锁。HTTP、图 schema、配置文件、节点/边 ID 和
草稿保存契约均不变，不迁移已有数据。源码变化与歧义声明明确留为未完成，不能静默合并。
统一协议测试加入 tests/run_e2e.py；真实 Rust/Java 回归与后端门禁共同验证兼容。
已实施与后续边界见 [LSP 采集扩展边界](lsp-adapter-design.md)。

## 多语言采集扩展设计（2026-11-14）

新增语言/服务器前阅读 [LSP 采集扩展边界](lsp-adapter-design.md)。该节记录初始设计任务；
后续实施状态见上方重构记录，公开 HTTP、图 schema 与启动配置仍不变。
后续优先默认标准 LSP 实现、共享身份解析与统一契约测试；协议兼容规则按服务器实现隔离，
不得向采集调度、合并和前端散布语言分支。身份格式或公开配置若发生变化，仍走下文契约变更流程。

## 向上调用采集（2026-11-06）

显式前后端契约任务：新建图 POST /api/graphs 新增可选 direction，严格枚举
outgoing / incoming，省略仍为 outgoing。持久化到 analysis.direction，历史图默认向下。
方向是图的探索属性，续采继承该方向，不在同一图中切换查询状态的含义。
queriedNodes / pendingNodes 均指本图方向，节点及边的事实结构保持不变。
CLI analyze 同步支持 --direction。incoming 使用 LSP incomingCalls，调用点属于返回的
from 方法；真实边始终 caller -> callee，稳定 ID 与正向查询一致，不翻转事实边。
画布、收起、搜索定位与减枝沿探索方向；根节点是探索锚点，不声称业务入口。
新建图选定源码后选择方向，采集设置复用深度/数量和草稿机制；空结果不证明没有调用者。
验证覆盖协议、调用点、重复合并、循环/共享、持久化、默认兼容与方向错误拒绝。
理解验收：从一个方法追溯上游并核验调用源码；真人十分钟任务另行验收。

## 多选节点隐藏与删除（2026-11-06）

显式前后端集成任务：原 prune 请求接受单个 `nodeId`；现在兼容该字段，并新增
互斥的非空 `nodeIds` 数组。缺失、同时提供两种字段、未知节点或包含根节点均拒绝。
数组去重后，对整个集合计算独占下游和外部共享引用；响应字段保持不变。
预览不修改数据，apply 继续要求 revision，一次 checkpoint 应用整个集合。
draft 的 prune 操作复用同一契约，保存/放弃行为不变；不新增浏览器文件路径输入。
前端过滤受保护的入口并明确提示，隐藏仅更新会话可见性，删除经预览确认后进入草稿。

## 节点阅读指引（2026-11-05）

本轮为前端交互与组合回归集成任务，无 HTTP、图 schema 或存储格式变更。
打开图默认选中根节点，读取现有源码预览，不隐式启动 LSP。详情栏复用 Bootstrap
Badge 与既有动作行展示采集状态；不增加顶部状态区或调用方/被调用方列表。
状态依据原始符号的 pendingNodes/queriedNodes 与原始出边，不依据画布折叠结果。
历史 issues 仅作为折叠记录，不推断当前仍失败；未记录下游不等于业务执行结束。
无分析报告和导入图保持未知/导入边界，不补造业务描述或调用关系。

当前路径的来路入口只指向该路径引用的入边；有精确调用点时展示其源码，无调用点
的多态/人工关系展示已有关系依据。来路不代表唯一运行时调用者。顶部前后节点
明确按搜索列表浏览，不声称是执行顺序。诊断按图建立索引、每次展开 20 条并限制高度。
浏览器验收覆盖初次进入、折叠、历史失败恢复、共享引用、精确与非精确证据、亮暗与窄屏；
理解目标是让读者辨认定义与调用点，并不把采集边界误读为流程终点，真人复述待验收。

## 采集阅读连续性（2026-11-05）

本轮为前端可靠性与组合回归集成任务，不改变 HTTP、图 schema 或存储契约。
旧行为：一次状态读取错误终止轮询，结果预览/保存/放弃重新创建画布并重置阅读状态。
新行为：只读状态请求失败后按 1.5–10 秒退避恢复，切图/新任务隔离旧响应；停止请求
响应不确定时读取状态确认，不自动重放写操作。结果刷新复用 G6 实例和路径引用，
保留视口、选择、无关分支折叠及未变源码位置的编辑器；起点下游按当前展示范围展开。
临时源码位置解析后的根 ID 替换保持屏幕锚点；放弃草稿移除不再存在的路径引用。
已有失败分支保留、增量合并和 CAS 保存行为不变。

验收使用隔离资料库与真实 rust-analyzer，覆盖状态传输失败恢复、视口/源码面保留、
预览不写磁盘、放弃、采纳和外部修改冲突；加入标准组合门禁。Rust/Java 协议故障
测试继续覆盖部分成功和迟到响应，不据此宣称真实 Spring 历史问题已全部解决。
理解收益是减少采集后的阅读迷失；真人十分钟复述任务仍需独立验收。

## macOS 源码兼容（2026-11-03）

后端兼容性与文档集成任务，不改变 HTTP 请求/响应或浏览器适配器。
旧行为：非 Windows 调用系统选择器返回“不支持”；新行为：macOS 通过系统
`/usr/bin/osascript` 打开原生文件/目录对话框，取消仍返回 cancelled=true。
项目路径仅来自服务端目录，通过进程 argv 传入固定脚本，不插值到脚本或 shell。
不在 Tokio 工作线程直接调用依赖 AppKit 主线程事件循环的对话框。
选择结果继续经过目录枚举和项目边界校验；校验在已信任的项目根目录停止，
允许 macOS /var 等项目根上方的系统别名，项目内部的符号链接仍拒绝。
新增 Unix 路径别名/内部符号链接回归测试与 Mac 双架构源码 CI；不制作发布包。

系统对话框参考：[Apple 文件/目录选择文档](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/PromptforaFileorFolder.html)。
CI runner 选择参考：[GitHub runner 文档](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

## 资料库存储、重命名与图视图服务控制（2026-11-03）

本轮是明确的跨边界集成任务。旧存储把说明混在图文件中，空分组仅在浏览器保存。
新保存格式保持图事实 JSON，使用 `_annotations` 指向同目录 `.annotations-<slug>/`
中的不可变说明快照；说明、节点职责/阶段/视图状态和边说明独立存储。先完整写说明，
再原子发布图引用，崩溃不会发布半份图。API 仍返回合成后的原有图结构；旧文件读取兼容，
只在用户保存时分离，不批量改写历史图。源码位置、符号、调用关系与证据仍属于事实。

资料库默认仍为 `graphs`，空分组及目录显示名持久化到 `.coderova/library.json`，
不再依赖浏览器。`coderova.storage.json`（项目配置旁）允许设置 root；相对路径相对该配置。
显式 --graphs 优先。GET /api/storage 返回当前/下次启动位置；POST 只接受服务器原生
选择器发出的 selectionId，保存配置后下次启动生效，不移动或删除原资料库。
GET/POST /api/library 读取/修改目录显示名与分组；POST 使用 action 和稳定标识，拒绝未知字段。
PUT /api/graphs/{slug}/title 修改图标题（非 slug），继续使用 CAS 避免覆盖草稿。
目录、分组重命名不修改源码目录、ID或链接。页面/配置文件均可维护资料库目录。

图视图复用现有 LSP 状态与启动/停止接口，不改变采集协议。展示设置按触发按钮和视口定位。
验收覆盖旧格式读取、保存分离、恢复/移动、重命名跨刷新、配置优先级与非法路径拒绝。

本地配置示例（`coderova.storage.json`）：

```json
{"root": "D:/CodeRovaLibrary"}
```

目录结构（移动/备份时复制完整资料库，包括隐藏目录）：

```text
graphs/
  .coderova/library.json          # 目录别名和分组，包括空分组
  <categoryId>/
    <slug>.json                   # 节点、关系、源码证据和说明快照引用
    .annotations-<slug>/<ref>.json # 描述、职责、阶段、阅读状态
```

现有根目录中的图仍受支持。重命名修改显示名，稳定 ID、图文件 slug 和链接不变；
移动分组才改变物理分类目录。`library.json` 的结构为
`{"directories":{"projectId":"显示名称"},"groups":[{"project":"projectId","id":"groupId","name":"分组名称"}]}`。
旧说明快照保留，避免并发读取或发布失败时丢失说明；不自动清理历史文件。
CLI `analyze --output` 是可携带的完整图导出，仍使用合并 JSON；工作台保存时转换为独立说明。
页面只配置下次启动位置，不搬迁资料；显式 `--graphs` 优先时页面会提示移除参数后再重启。

## 采集边界与顶部导航（2026-11-03）

analysis / draft analyze 请求新增可选 maxDepth（1–100）与 maxNodes（1–10000）。
深度相对本轮起点，起点为0；maxNodes限制本轮新增唯一节点，不包含已有节点，两者同时生效。
requestBudget保留作为兼容及服务端查询保护。串行合并保证并发响应不会突破节点上限；
截断的调用方仍为pending，允许从部分已采集节点续采，未返回关系不伪装为完整。
顶部整合节点搜索、按搜索列表顺序的前后导航及当前节点居中；右栏移除调用方/被调用方列表。

## 创建流程二次验收（2026-11-03）

首页默认居中的创建入口，项目资料库改为页签（view=projects）；入口校验和创建为同一位置的
互斥主按钮。待解析根节点只显示短标题和文件/行号，不伪造方法或类型事实。

修复 JDT 返回含中文的 file IRI 无法反序列化为 lsp_types::Uri 的问题：在调用层级解码边界
将顶层 uri、to.uri、from.uri 转换为标准 URI，绝不改写 opaque data；项目路径校验不变。
新增 Windows 可执行文件 manifest，启用 Common Controls v6 及 PerMonitorV2 DPI，文件/目录
继续由同一个系统 Common Item Dialog 提供，不用页面样式假冒系统文件管理器。
参考：[Microsoft visual styles](https://learn.microsoft.com/windows/win32/controls/cookbook-overview)。

## 创建流程验收修复（2026-11-03）

本轮为用户明确要求的跨边界集成修复。项目级新建入口校验原先启动 LSP 确认函数；现在仅检查
服务端文件目录中的 fileId、源码行范围和非空内容，返回待确认的源码位置（node.id
以 entry-position- 开头），响应增加 verification=source-position。不声称已经解析到函数。
首次采集时才通过 LSP 确认该位置所属函数，并原子替换节点及图内引用；失败保留位置供重试。
源码变化检查、候选凭据、保存和项目边界不变。已有图添加节点仍执行 LSP 函数校验。采集仍只使用 LSP。

新增 POST /api/projects/{project}/select-file 与 /api/graphs/{slug}/select-file，空请求体，
服务端从项目目录设置原生选择器初始路径，返回目录中匹配的 {id,name} 或 {cancelled:true}。
浏览器不传任意路径；项目外文件、符号链接及排除目录仍拒绝。Windows 目录与文件都使用
同一现代系统选择器。规范化路径保留用于校验，对外显示和传给外部 LSP 时移除设备路径前缀。
LSP 状态增加 serverType，标明 rust-analyzer 或 Eclipse JDT LS，启动后仍显示。

验收关注首次创建时的无效点击、当前步骤是否可理解及入口确认延迟；完整北极星理解任务
仍须真人复述执行流程和源码证据，本轮自动化检查不能代替它。

## CodeRova 工程命名统一（2026-11-02）

Cargo包、crate、源码二进制统一为coderova；Windows源码产物为coderova.exe，
CLI版本/帮助、日志target、Windows打包默认输入与测试程序定位同步更新。
前端导出API类由CallgraphApi改为CodeRovaApi，仓库内调用方同步迁移；HTTP接口不变。
Logo源文件改为public/brand/coderova-mark.svg，页面、生成源和打包检查同步更新。
配置文件callgraph.*、CALLGRAPH_*变量、浏览器偏好键、图ID/格式维持兼容；
GitHub链接和真实源码checkout目录保留实际名称，不将真实路径替换成不存在的新路径。

## 项目接入与主动 LSP 生命周期（2026-11-02）

显式跨边界集成任务。新增 POST /api/projects/select-directory，由服务端打开Windows
本机目录选择器，返回selectionId/name/root；取消返回cancelled=true。凭据10分钟有效，
同一时刻只开一个目录选择器。POST /api/projects仅接受selectionId/name，持久化到
服务启动时加载的项目配置；浏览器不能提交root、命令或任意路径。ID由服务端生成，
重复目录返回已有项目。原先只有配置文件接入，现支持页面接入；配置原有条目保留。

GET /api/projects/{project}/lsp/{language}返回state/message；language仅rust/java。
POST同一路径仅接受action=start/stop；启动后台执行并立即返回starting，状态可轮询，
失败返回failed及原因。运行中重复start复用并固定会话；启动中stop取消并等待任务退出。
采集或入口校验使用中的会话拒绝stop。手动启动会话不会按5分钟空闲回收，也不被普通
缓存逐出；缓存已被固定会话占满时需先停止一个。应用关闭取消预热、停止缓存会话。
状态running表示服务器已启动并完成适配器当前就绪等待，不保证整个项目已完整索引。
自动入口校验/采集仍可按原规则启动，未改变查询预算/超时/重试或草稿保存协议。

前端适配在api.js，首页项目设置和新建图复用控制器；新项目没有图也可从首页访问。
HTTP/stdio测试验证幂等启动、复用、固定容量、启动取消、使用保护；项目目录持久化
单元验证重启恢复/去重，浏览器测试目录选择部分使用桩，不把它当作真实原生对话框验收。

## 批量描述编辑和目录读取（2026-11-02）

集成任务：新增草稿 operation describe，edits 为1–5000项，项只接受 targetType
(node/edge)、id、description（最多16000字符）。未知字段、重复目标、缺失目标拒绝；
整批原子应用，不改变源码位置和拓扑，不直接写文件；采集中拒绝编辑。结果返回 updated，
随后 read 查看草稿、save 显式保存。原接口无此动作；原有请求/响应字段不变。
public/js/api.js 暴露 describeGraph，e2e验证整批回滚、磁盘隔离及字段限制。
目录接口响应不变；存储逐张释放完整图，只累积摘要，保持原解析校验。

## 有界并发与失败隔离（2026-11-02）

本轮为后端采集与集成验证任务，不改变 HTTP 字段或图 schema。
本地 callgraph.lsp.local.json 增加 collection：concurrency 默认 4（1–32）、
requestTimeoutSeconds 默认 15（1–300）、maxRetries 默认 3（0–3，首次之外的重试）。
只允许可信本地配置，不接受浏览器传入命令或路径。
LSP 独立读写循环按请求 ID 分发，超时发送取消通知并丢弃迟到响应；不将单请求超时视为坏帧。
每节点只在本轮调度一次，失败保留 pendingNodes/issues；成功关系继续合并，未知下游不伪造节点。
传输断开终止该会话未完成查询，已完成检查点保留。配置变化使热会话失效。
并发调度保持预算和来源证据，图合并与保存串行；不将响应到达顺序解释为执行顺序。
验证并发 4/8/16、乱序、迟到/无响应、重试上限、取消与成功结果保留。

## 单一 LSP 采集流程（2026-11-02）

新建、入口校验和续采仅使用语言服务器，按入口文件选择 Rust / Java 适配器。
旧 entry-check 的可选 engine 字段移除；请求现在只接受 fileId/line。
旧续采 maxDepth 字段移除；继续使用 requestBudget/nodeId。未知字段返回 422，
包括旧 engine=coderova/lsp；更新后需刷新旧浏览器页面，不静默回退。
历史 AST 图仍可读取、编辑和保存，但不允许续采或在其上校验新采集入口。
前后端按 LSP provider 白名单判断能力；不修改旧图 provider，不删除已有数据。
新建根节点、草稿采纳、显式保存、单任务和停止语义不变。
Python 进程桥接、引擎分流及其专用配置不再是应用依赖。

## 图格式 0.5：关系与来源字段统一（2026-11-01）

本轮是显式跨边界格式迁移。旧图 0.2–0.4 的 edge.from/to/kind/confidence
分别改为 source/target/relation/confidenceScore；节点与边的 file 改为 sourceFile。
保留 nodes/edges、节点 kind、数值 line/endLine、边 ID 和 callSiteStatus；不把
提取方式标签解释为概率，也不改变 relation 的既有枚举值。
HTTP 图及候选节点响应、保存和 CLI 导出统一输出新字段；旧字段作为只读别名，
重复新旧字段和未知字段仍拒绝。已知旧版本序列化为 0.5，未知版本不伪装成新版本。
浏览器 api.js 在边界统一转换为现有内部模型，内容证据工具使用同一适配器。
源码读取、草稿 CAS、采纳/保存规则不变；读取旧图不写文件，不批量迁移用户数据。
布局已独立保存 layouts/<slug>.layout.json，本轮保持布局契约与节点 ID 稳定。
本轮不引入共享分析视图或数据库。
验收：旧图读取、新格式输出/回读、多调用点保留、别名冲突拒绝、源码预览、草稿保存和布局隔离。

## 采集反馈与返回起点（2026-11-01）

前端主提示仅展示本轮新增节点数，不再把 completed 称为 LSP 请求数，也不展示连线数。
启动成功后按图记录本轮起点的路径实例及源符号；预览/采纳重新加载后定位选中该起点。
不可见时复用 PathWindow.reveal 展开路径；采纳或放弃后清除记录，取消配置不覆盖起点。
这是当前页面会话内的导航状态，不写入图文件或浏览器持久存储。HTTP 契约不变。

## 采集结果统计（2026-11-01）

任务状态响应新增 camelCase 字段 addedNodes、addedEdges，表示本轮已完成检查点相对启动时新增的节点/连线数。
启动为 0，停止或失败保留已完成统计；不包含开始前的草稿修改。completed 仍是处理数量，不是节点数。
前端运行中显示旋转指示和阶段消息，终态显示新增数、剩余待采数量与待采纳状态；旧服务缺字段时仅显示处理数，不虚构零增长。
动效遵守 prefers-reduced-motion；采纳/放弃流程不变。

## LSP 热会话与查询复用（2026-10-31）

本轮以后端为主，并更新生命周期集成回归；HTTP 字段不变，状态 message 增加准备/复用提示。
`analysis/session_cache.rs` 独立管理项目根、语言、源码/构建文件和本机 LSP 配置指纹。
最多保留两个热会话（2026-11-02 更新），按最近归还顺序淘汰；每个会话空闲 5 分钟回收，超过 32 MiB 已打开源码不回存。
入口校验与续采共享同一租约协议：仅正常完成归还；错误/取消时随租约销毁进程，
独立读循环保证帧完整；单查询超时不破坏会话，任务取消仍销毁租约。切回缓存内项目可复用；源码/构建配置变化、进程死亡时重新初始化。
正常服务退出清理缓存；强制杀进程不能依赖 Rust 的析构/关闭钩子。
源码指纹使用实际文件内容，阻塞读取转移到 blocking 线程；符号缓存仅限单轮采集。
源文件/构建配置之外的外部依赖更新不属于指纹范围，需要重启服务或等待会话淘汰。
同轮复用 LSP 已返回的 CallHierarchyItem，保留 opaque data；Java 的必要声明重准备仍由语言适配器负责。
维持逐节点图校验和草稿检查点以保留停止恢复语义，不批量延迟持久化。
INFO 日志记录内容指纹、初始化和总采集耗时；DEBUG 记录 LSP 各方法耗时。
验证目标：校验→采集不重复启动索引，源码变化不使用旧身份，停止后可以再次采集。

## 根节点选行编辑器修复（2026-10-31）

前端复用 `/monaco-preview.html` 隔离表面，避免将需要动态主题样式的 Monaco 挂到主页面。
不放宽主页面 CSP，不修改 HTTP API。父页面仅通过同源、指定 iframe 的消息桥调用 mount/find；
编辑器通过 selection 消息回传选区起始行（点击行号选整行时不能取下一行的光标终点）。
轻量选行模式关闭静态证据装饰、空白字符提示及滚动动画，主题映射 light/dark；
保留原生只读、行高亮、选区、折叠和搜索。销毁 iframe 时释放消息监听、超时和待处理请求。
验收覆盖选行、行号点击、跨行拖选后行号保留、容器高度稳定、搜索和根节点采集链路。

## 新建根节点图（2026-10-31）

过去只能针对已有图选取入口；现在新增项目级源码选择 API：
- GET `/api/projects/{project}/source-files` → `[{id,name}]`
- GET `/api/projects/{project}/source-files/{fileId}` → `{name,text}`
- POST `/api/projects/{project}/entry-check`，`{fileId,line}` → `{candidateId,node,message}`
- POST `/api/graphs`，`{projectId,candidateId,title}` → `{slug,nodeId}`

客户端只传目录中的项目 ID、服务器返回的文件 ID 和校验令牌；后端重新校验源码未变化，
令牌绑定项目并在创建成功后消费。拒绝未知字段、跨项目令牌和覆盖已有图（含回收站）。
“创建图”明确保存仅含根节点的图；选行/校验不写图文件，不启动下游采集。
创建成功后打开预算配置，用户点击开始采集后才提交任务；结果沿用内存草稿/预览/采纳保存协议。
本轮为前后端与文档的集成任务。理解目标：无需 CLI 即可从可核验的源码入口开始探索。
验收：主页创建、选行校验、根节点落盘、预算配置、取消和刷新，且没有未授权下游查询。

## 唯一工作台与统一首页（2026-10-31）

本轮为明确的前端及测试/文档集成迁移，HTTP 数据契约不变。旧根页面替换为项目资料库：
`/` 列出全部项目的调用图与场景，`/?graph=<slug>` 加载唯一 G6 工作台，
`/scenes/<slug>.html` 阅读独立场景。旧 `/v2/?graph=...` 通过静态托管的根页面 fallback
归一化为根链接，仅保留书签兼容，无旧版本页面或渲染器。
源码入口由 `frontend/v2` 迁至 `frontend/workbench`，静态资源迁至 `public/workbench`、
`public/vendor/workbench`；保留旧浏览器偏好键避免主题、侧栏宽度和目录偏好丢失。
删除旧 SVG 渲染器和独占控制器，保留仍被源码预览与 G6 使用的公共模块；同时退役独立 Atlas 实验入口及其 React Flow/ELK 依赖。
验收使用统一首页到目标流程的一次点击、源码核验、返回目录及站内未保存保护；不改变用户图文件。
测试入口 `tests/run_e2e.py` 改为当前工作台门禁，退役旧界面专属测试，保留 LSP 协议和草稿隔离回归。

## V2 项目目录移入回收站（2026-10-31）

最外层项目目录现在也提供删除，复用分组的顺序归档、未保存检查与失败核对流程。
成员取完整项目目录，包含所有分类与搜索隐藏项；确认后调用既有单图归档 API。
不改变 API、项目根配置或源码目录。删除成功后，空项目目录的隐藏偏好保存在浏览器；
恢复或生成调用图、新建分组时目录重新可见。批量失败保留未处理图，不隐藏非空目录。
集成回归使用临时图文件，覆盖跨分组、搜索、取消、刷新和恢复，不修改用户图数据。

## V2 整组移入回收站（2026-10-31）

用户明确扩大删除范围：项目下的分组可连同全部调用图删除，覆盖此前仅空组可删除的限制。
本轮为前端功能与集成验证：复用现有单图 DELETE 接口，不改变 HTTP 或文件存储契约。
按完整目录而非搜索结果确定该项目/分组的成员；确认展示完整数量。组内任一未保存图或
正在提交编辑时，整组请求前置拒绝。成功后移除本地空组偏好，图在回收站中可分别恢复。
顺序批处理不是原子事务：失败停止后续请求，重新读取目录与回收站，报告成功数量并保留剩余项。
当前图被删除后沿用单图删除的页面导航逻辑；源码、布局与其他项目同名分组不受影响。

## V2 源码跳转恢复（2026-10-31）

复用 V1 ClickNavigationPolicy：默认只选中，开启点击跳转后仅节点与精确调用边打开编辑器。
V2 路径引用必须还原 sourceId。非精确边不猜测位置；拖拽、展开按钮不触发外部协议。
原 /api/open 有效字段与响应保持不变；之前忽略的未知请求字段现在拒绝；草稿协议新增只读 action=open，request 与 OpenRequest 相同，
必须属于当前草稿 slug，复用后端目录及路径校验，返回原 OpenResponse 于 result。
未保存节点通过草稿生成链接，不写入图文件、不接受浏览器提供的文件路径。

## 类型信息与候选实现（2026-10-31）

本轮为显式跨边界集成。旧节点仅有 kind；新节点增加可选 symbol 对象：ownerKind、
ownerName、modifiers、tags。字段为语言中立事实，未知信息不猜测；旧图保持兼容。
复用现有边 kind=trait-dispatch，表示 LSP 报告的候选实现，不是调用点或运行时分支。
此边必须使用 callSiteStatus=omitted-nodes，file 为空、line=0，以目标节点源码作为核对入口。
本次实现查询去重后只有一个项目内目标时自动入队（仍计深度/预算且遵守排除）；多个目标进入 pendingNodes，显式选择后才能继续。删去其他候选不等于 LSP 只找到一个实现。
跨任务无 seed 的批量续采仍保守跳过只有候选入边的待采节点；预算中断后可显式选择续采。隐藏、删除、草稿预览和保存继续使用原接口。
浏览器适配器消费新增元数据与关系类型，不根据 Java 文件名推断类型。Java 的符号识别和
implementation 协议封装在专属适配器，调度层只处理语言中立节点和候选结果。
验收关注读者能否区分声明与候选实现、找到源码并选择续采；节点数量不作为完整度指标。

## Java LSP 采集（2026-10-31）

显式跨边界集成：原采集、入口校验、续采只使用 rust-analyzer；新增按入口扩展名选择
Rust 或 Eclipse JDT LS。HTTP 请求字段不变，不接受服务器路径、命令或任意源码路径。
Java 启动参数仅从服务端本地 callgraph.lsp.local.json（或 CALLGRAPH_LSP_CONFIG）读取。
图 analysis.provider 区分 rust-analyzer 与 eclipse-jdtls，均沿用项目内调用点与 pendingNodes。
浏览器适配器统一识别支持的 provider，文件选择器支持 Java；采集结果仍遵循草稿预览、
显式保存和放弃。Java 导入依赖与动态分派的不完整性必须保留，不声明运行时全覆盖。
源码预览沿用已有 language=java；Monaco 本地包和浏览器语言白名单补齐 Java 语法支持。

## V2 文件树与可恢复删除（2026-10-27）

本轮为显式前后端集成任务。旧版只有分类移动；新版增加：
- `DELETE /api/graphs/{slug}` → `{slug, archived:true}`，原 JSON 同目录改名为 `.deleted`，不删源码或布局。
- `GET /api/graph-trash` → GraphSummary 数组，列出可恢复的图。
- `POST /api/graph-trash/{slug}/restore` → `{slug, archived:false}`，恢复原目录，遇同名活动图拒绝覆盖。
- `DELETE /api/graph-trash/{slug}` → `{slug, deleted:true}`，永久删除本机归档图文件；不能删除活动图。界面二次确认，源码和布局保留。
服务端仅接收经过校验的 slug，路径由图索引决定，回收站不在静态文件托管目录。
前端通过 CodeRovaApi 使用这些接口；拖动跨分组复用已有 category PUT 接口并真实移动配置。
项目归属不变，不允许通过树拖拽修改 source projectId。展开状态、同组排序和空分组仅保存在
当前浏览器，写入失败明确提示。删除项目和非空分组不提供批量操作。
目标是减少目录扫描与切换成本；验证折叠、键盘访问、移动、恢复、刷新、错误恢复与选中上下文。

# V2 首个垂直切片（2026-10-27）

本轮是显式跨边界集成任务：先实现后端分析模块，再实现前端 G6 阅读器，统一验证。
旧行为：调用图仅由离线内容作者供给。新行为：CLI `analyze` 作为 LSP 客户端，启动
rust-analyzer，通过 stdio JSON-RPC 分析可信 CLI 指定的项目目录和入口。HTTP 不启动
进程、不接收任意源码路径；源码预览的安全边界不变。V2 页面位于 `/`，沿用
`GET /api/graphs`、`GET /api/graphs/{slug}`、`POST /api/preview`。

CallGraph 0.4 新增可选 `analysis`：provider、scope、maxDepth、requestBudget、
queriedNodes、pendingNodes、issues。旧图不带此字段，序列化时不输出 null。
queriedNodes 只表示收到调用层级数组，不代表证明没有动态调用；pendingNodes 包含
深度、请求预算、null 结果和失败边界。issues 记录跨项目目标及无法解析的关系。
预算可由 CLI 调整，限制计算工作而非内容完整性；前端始终显示分析覆盖说明。
新增边 kind `static-call` 表示分析器报告的调用，机制尚未分类，不冒充 direct 或运行时调用顺序。
`nodes/edges` 仍是唯一结构。第一阶段只支持 rust-analyzer 出向调用；未建立稳定的
跨源码版本符号身份、增量缓存、浏览器分析任务或自动业务解释。不得宣称已完成这些能力。

解决的问题是手工生成调用关系成本与来源不确定。验收为真实 LSP 生成、调用点源码验证、
G6 阅读与源码联动，以及旧版回归；最终理解效果仍使用 10 分钟北极星任务评估。

# 前后端智能体开发边界

## 调用图连线与拖拽性能

连线避障由前端 `renderers/edge-router.js` 根据已有节点坐标和真实边计算：分配独立端口，
搜索避开节点的正交路径，以共享线段的拥挤代价分散通道；回边保留外侧通道。
标签避让同时考虑节点与标签，用细引线说明对应路径。交叉点用背景描边区分，交叉不表示汇合。
不修改调用图 JSON、布局存储格式、模型生成要求或 HTTP API。手工重叠节点可能使端口被封闭，
这种情况下保留可选择的连线；不能保证任意人为堆叠布局完全无重叠。

拖动事件按动画帧合并，通过节点邻接索引只更新相关连线，其他标签保持稳定。
移动中采用临时连线，释放后重新避障并走原布局保存入口；取消拖动恢复位置。
平移不重新计算路线；移动期间关闭 SVG 模糊阴影。相同节点坐标和拓扑复用路线缓存。
本轮前端集成范围为回归测试、本文档及项目自身受源码位移影响的证据锚点，无后端契约变更。

理解问题是读者无法区分被遮挡的分支、以及拖动画布寻找证据时失去连续性。
自动验收覆盖真实图双方向的路径避障、平行边、自环、标签、取消/完成拖动和大图更新量。
人工效果仍需按 `product-strategy.md` 的 10 分钟任务检验：辨认主干/分支/回环并定位证据，
记录错误追线与反复缩放次数；浏览器性能测试不替代该理解效果评估。

## 项目导航与静态场景目录

主页 `/` 仍展示全部项目和内容；进入阅读后，左侧项目目录与右侧内容共用一个工作台。
旧实现通过完整页面跳转打开场景；新实现将 `/?scene=<slug>` 和 `/?graph=<slug>` 作为
浏览器端阅读路由，点击入口直接切换右侧内容，使用 History API 支持前进、后退和刷新。
项目目录每次展开一个项目，保留所有项目标题；移除重复的项目定位按钮和中间场景目录入口。
上方阅读视图仅列出当前调用图与关联场景的直接入口，不同步节点、阶段或模型生成状态。
`/?project=<id>` 仍定位全量主页；原 `/?graph=<slug>` 和独立 `/scenes/<slug>.html` 链接兼容。
独立场景仍由同一构建器输出 HTML；工作台按受限 slug 加载，导入允许的静态 HTML/SVG 标记，
移除脚本、事件属性、外部资源及重复导航，在 Shadow DOM 内复用样式，并跟随工作台主题。
不使用 iframe，不变更 Rust 响应或安全头，不增加 HTTP API 或模型交付字段。
路由切换先保存布局，失败保留当前内容；过期请求不能覆盖较新选择。场景滚动位置及最近
调用图的选择、视口在视图往返时保留。页面加载失败通过统一提示反馈，可重新点击入口重试。
场景构建新增自动生成的 /scenes/catalog.json：schemaVersion=1.0、generatedBy=build:scenes、
scenes 数组，每项含 slug、projectId（旧输入可为 null）、projectLabel、title、summary 和
callgraph（可为 null）。它是静态构建产物，不增加 Rust API 或模型；由浏览器适配器读取。
原场景输入不变，模型无需编写目录或页面。场景目录独立异步加载，失败/超时可重试，不阻断
调用图。构建与检查同步校验目录产物；无 project.id 的旧场景也显示在主页的未关联项目分组。
本轮由前端负责，集成范围为生成脚本、文档、测试及受代码位移影响的项目自身源码锚点。

## 2026-09：生成与证据集成

本轮由前端承担实现，显式集成范围包括 scripts、schema、图内容、项目目录、文档和测试。
旧 Mermaid 输入仅有场景级证据表；新增可选 `%% @evidence id1,id2` 注释，将下一条消息或
Note 关联已有证据。内部 message/note 的 evidence 字段保持原样，不引入跨图映射。
两类场景 JSON 新增可选 project.id（配置目录标识）、location.anchor（行范围内的字面片段）
和 evidence.status（source/inferred，作者对依据的分类，不是自动证明）。旧输入仍有效。
统一 CLI 复用 Rust validate --json 校验调用图；场景源码检查和外置指纹基线只在本机构建期
运行，规范化路径必须位于项目根目录内。基线仅表示引用内容是否变化，不证明业务结论。
没有新增或变更 HTTP 请求/响应、Rust 序列化或浏览器 API；因此本轮无需改动后端与 api.js。
Atlas 保留实验兼容入口与 API，构建从默认前端构建拆为显式 build:atlas；主路径保持独立。

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
CodeRovaApi
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

## 页面断点续采（增量任务）

旧行为：仅 CLI 离线采集，页面无法补齐 pendingNodes。新行为：页面 POST
`/api/graphs/{slug}/analysis`，请求仅 `{requestBudget}`（1–1000），启动服务器内的单个后台任务；
GET 同路径读取 `{status, completed, pending, message}`；DELETE 请求在当前查询完成后停止。
不接收项目路径、命令、服务器路径或 LSP 参数，项目根由已加载图及可信目录配置解析，
服务器固定使用本机 rust-analyzer，构建脚本及过程宏继续关闭。

逐节点重新 prepare 调用层级并核对原始符号身份，不复用跨会话 opaque item。
成功查询后原子保存图作为检查点，已查询节点不重复采集；空结果和 null 明确区分。
更新使用原图内容比较，期间分类/删除/外部编辑冲突时停止，不能覆盖其他修改。
请求预算按本次 outgoing 查询次数计，原始 maxDepth 是初次采集设置，续采通过预算控制。
主动排除边界不自动续采。任务状态只在当前服务进程内，已保存的图检查点可跨重启续采。
这不是源码版本迁移：旧图未记录完整源码指纹，不能证明此前关系仍有效；重新 prepare
仅核对当前待采符号身份，页面必须提示源码变更后应重新分析。

## 人工异步关联与定向续采

POST `/api/graphs/{slug}/links` 接受 `{fromId,targetGraph,targetId,note}`；两端必须来自
已加载图和同一可信项目，目标须为 rust-analyzer 产物中的符号，禁止浏览器提供路径。
保留接收函数真实定义，新增 `async-boundary` 边，明确标记人工关联、置信度未验证，
`callSiteStatus=omitted-nodes`，不伪造发送者直接调用消费者的源码位置。关联说明必填。
已有直接调用、静态证据和节点不得覆盖。新目标进入 pendingNodes，已有已查询目标不重复采集。
DELETE `/api/graphs/{slug}/links/{edgeId}` 仅撤销人工关联边，不删除共享目标与已采结果。
运行中拒绝关联/撤销，保存仍使用原子比较更新。修改操作要求同源并拒绝未知字段。

续采 POST 新增可选 nodeId：必须是此图待采节点，队列从该节点开始，并采集新发现的后续；
已存在的待采下游也纳入，已查询节点保持不变。不接受任意符号或文件。旧请求不变。
页面先保存人工关联，再由明确按钮启动定向采集；采集失败不回滚用户已保存的关系。
首版只支持同项目已有分析图中的目标；不是全项目符号搜索，也不是自动推断消息路由。

## 叶子节点采集与编辑器选行入口

续采 POST 必须提供 nodeId，且该符号属于 pendingNodes、没有原始出边；收起视图不改变
叶子判定。页面全图采集按钮移除，节点右键和侧栏提供同一规则的操作。
GET `/api/graphs/{slug}/source-files` 枚举可信项目内 Rust 文件（不跟随符号链接，不扫描
.git/target/node_modules）；返回不透明 id 和相对名称。GET 后缀 `/{fileId}` 读取已枚举
文件，拒绝未知 id，不接受文件系统路径。编辑器只读，单文件上限 2 MiB，超限明确报错。
POST `/entry-check` 接受 `{fileId,line}`：LSP documentSymbol 确认包含该行的函数/方法，
prepareCallHierarchy 确认可采集身份，返回候选 token 与真实定义。无符号/解析失败不创建图节点。
POST `/entries` 接受 `{fromId,candidateId,note}`，校验候选属于此图且源码未变化，保存
人工入口节点与虚线关系；不得直接提交节点路径或伪造位置。候选只在本服务内存保留，
重启或同图重新校验后旧候选失效。用户必须重新校验；仅支持同项目 Rust 源码。
该流程允许发现尚未进入任何分析图的真实方法；不把人工关联当作静态直接调用。

## AI 操作与持久减枝

本轮为显式集成任务。新增 POST `/api/graphs/{slug}/prune`，严格请求
`{nodeId,apply:false}` 返回 `{revision,removedNodeIds,removedEdgeIds,preservedSharedNodeIds,applied:false}`。
提交传 `{nodeId,apply:true,revision}`；revision 必须匹配当前完整图，运行中的采集拒绝修改。
删除选中原始符号（所有调用位置）及独占下游，保留从候选集合外仍可达的共享下游；
根节点不可删除，环不会导致根被删除。预览与提交使用同一算法，CAS 原子写入。
清理 pending/queried，analysis 新增可选 prunedNodeIds，续采跳过这些符号，避免重新长回。
显式通过 entries/links 重新引入符号可解除该符号排除，其他剪枝记录保留。
非分析图也可减枝，但无自动采集排除元数据。源码文件不变；布局缓存不作为真实图结构。
AI 使用与页面相同 HTTP 契约，可自行预览并提交，无需 UI 确认；客户端需提供本机同源 Origin。
初次图创建仍由 analyze CLI；无需新增任意路径 HTTP 接口。完整操作说明在 ai-operations.md。

## 编辑草稿与显式保存

新增 POST `/api/graphs/{slug}/draft`：`{draftId?,operation:{action,...}}`，action 为 read、
entry（request 为原 entries 请求）、link（原 links 请求）、removeLink（edgeId）、prune
（request 为原 prune 请求）、preview（原 preview 请求）、save、discard。拒绝未知字段。
服务返回 draftId、dirty、graph、result。首次请求从磁盘建立独立内存草稿，之后按 draftId
隔离，不接受浏览器直接上传图或路径。所有编辑复用现有验证，但 checkpoint 只更新内存。
save 才执行 base -> current 的磁盘 CAS，外部修改/删除冲突拒绝写入并保留草稿；discard
释放草稿，不写磁盘。服务重启不保留草稿；页面刷新/离开有未保存变更时提供原生提醒。
界面图切换提供保存/放弃/取消。采集仍是持久检查点；有草稿修改必须先显式保存再启动。
旧直接编辑 API 保留立即写入语义，AI 可选择 draft 协议实现多步编辑后一次提交。
仅本次隐藏在浏览器内存中过滤视图，不更改图、分析排除或草稿；保存不将隐藏写入文件。
目录分类、主题等既有偏好不纳入图内容草稿，本次不引入跨文件事务。

CR 修订：无 draftId 时只允许 read，失败的编辑不能隐式占用草稿。save 保留同一草稿 ID，
更新基线并清除 dirty，以支持丢失响应后的安全重试；discard 才关闭草稿。客户端队列只保留
完成信号，不缓存整图响应；写请求响应不确定时保留未保存提醒，后续读取/重试确认结果。

干净草稿闲置 15 分钟后可回收，未保存草稿不自动回收；客户端已取消的排队请求不创建会话。
## 采集草稿与采纳（2026-10-31）

旧页面直接 POST analysis，将检查点写入正式图；浏览器 loaded-result 标记只隐藏通知。
新页面使用 draft 操作 analyze（request: {nodeId,requestBudget}）、analysisStatus、stopAnalysis。
三个操作复用原有叶子校验、全局单任务和停止逻辑；仅持有相应 draftId 的会话可以查看或停止草稿任务。
检查点写入 DraftStore 内存；预览 read 不写文件，save 才执行 CAS，discard 取消所属任务并释放草稿。
有待处理采集结果（包括运行中）时 dirty=true，即使还没有新增节点，也触发离开提示。
保存成功清除所属任务状态；任务状态新增可选 draftId。直接 analysis API 保留显式持久采集语义供旧 CLI/AI 客户端使用。
页面不在 localStorage/sessionStorage 保存采集结果或采纳标记；旧 loaded-result 标记删除。
采集草稿闲置 30 分钟后可回收，普通编辑草稿保留既有规则。离开页面的 discard beacon 是尽力清理，服务重启会清空内存草稿。
## 任意源码节点续采与去重统计（2026-11-03）

明确的前后端集成修复：同一 LSP 图中的任意现存源码节点均可作为本轮起点，
不再要求属于 pendingNodes。每轮从起点按深度展开，历史 queriedNodes 不阻止本轮查询；
本轮 scheduled 集合保证环路、共享下游只查询一次。项目路径、源码身份、减枝与多实现选择边界不变。
节点按 LSP 稳定符号 ID 合并；边按调用方、目标、调用点行和 UTF-16 列生成的稳定 ID 合并。
不同调用点的平行边保留；已有说明、职责、阶段、阅读状态和人工关系不覆盖、不删除。
重新查询失败的节点重新标为待采，保留已有成功事实；本功能为增量合并，不是删除旧关系的源码全量同步。

analysis 状态 addedNodes/addedEdges 改为相对本轮基线的唯一 ID 集合差，入口位置解析不计新增；
增加 totalNodes/totalEdges 表示已提交检查点中的图总量。completed 仍表示本轮已返回的符号查询数，
不是新增数。前端分别显示本轮新增与图总量，画布调用实例数不参与该统计；旧轮询响应不能覆盖新任务。
验收：已查询根与叶均可再采；重复采集新增为零，重叠下游仅一份；平行调用点、人工说明保留。
理解目标：读者可从当前关注的函数继续探索，不必先理解采集状态；不以重复画出的节点冒充新的源码知识。
