# 分析与 AI 自动操作

## 连接现有平台

以下命令在平台仓库执行，示例地址须换成当前服务地址：

```powershell
python -X utf8 scripts/atlas_agent.py --base http://127.0.0.1:4324 request GET /api/health
python -X utf8 scripts/atlas_agent.py --base http://127.0.0.1:4324 request GET /api/graphs
```

客户端只依赖 Python 标准库，自动设置 Origin。请求体写为 UTF-8 JSON，再用 `--data-file` 传入，避免 Shell 引号损坏。
不要使用过期端口或推测 slug。真实图是用户数据；流程演练使用隔离目录/服务或只读操作。

## 从源码创建初始图

读取项目配置和源码，选择能解释目标流程的入口，核对当前文件及函数名行列。行列从 1 开始，列按 UTF-16；不要复用文档里的历史行号。
先检查当前二进制 `analyze --help`。没有可用构建时可从仓库执行：

```powershell
cargo run -- analyze --help
cargo run -- analyze --config callgraph.projects.json --project <project-id> --file <项目内相对文件> --line <函数名行> --column <函数名列> --max-depth 3 --request-budget 200 --output graphs/analysis/<新名称>.json
```

尖括号是待替换参数，不可原样执行。选择与任务相称的初始深度/预算，必要时断点续采；这些示例数字不是完整性上限。
输出不得覆盖已有文件。项目根由可信配置决定，不从浏览器提交绝对路径。
Rust 使用 rust-analyzer；Java 使用 Eclipse JDT LS，配置在服务端 `callgraph.lsp.local.json` 或 `CALLGRAPH_LSP_CONFIG` 指向文件。核对 `src/analysis` 的实际配置契约与本机环境，不猜测 JDK、服务器命令或配置字段。
并发、超时和重试由同一可信本地配置的 collection 控制：concurrency 默认 4，requestTimeoutSeconds 默认 15，maxRetries 默认 3（首次之外，最多 4 次尝试）。CLI 和页面共用采集器。单节点最终失败仍保留 pendingNodes/issues，其他分支继续；不要把任务结束理解为所有节点成功。超时发送取消通知，服务器可能仍在内部计算；迟到响应不得采纳。
仅采项目内可解析关系。项目根外目标可能只有 issues，而不是必定显示一个外部依赖节点。Rust 默认关闭构建脚本/过程宏，不能为补全图静默开启执行。
排除使用可重复 `--exclude-path <项目相对文件或目录>`，不是 glob；说明排除原因，不默认删除 tests/vendor 等目录。

生成后读 `/api/graphs` 获取 slug，检查 `/api/graphs/{slug}` 与 `/validation`。需手工改图时先读 `graphs/AGENTS.md` 和内容规范。

## 默认使用草稿完成多步操作

所有下面的 operation 均 POST `/api/graphs/{slug}/draft`。第一次 read 创建草稿，记录响应中的 draftId；后续携带同一个 ID。

```json
{"operation":{"action":"read"}}
```

```json
{"draftId":"服务返回值","operation":{"action":"analyze","request":{"nodeId":"现存源码节点ID","requestBudget":100,"maxDepth":3,"maxNodes":100}}}
```

| 目的 | operation |
| --- | --- |
| 读取当前草稿 | `{"action":"read"}`；graph 位于响应顶层 |
| 查询任务 | `{"action":"analysisStatus"}`；状态位于 result |
| 请求停止 | `{"action":"stopAnalysis"}` |
| 添加入口 | `{"action":"entry","request":{"fromId":"...","candidateId":"...","note":"源码依据"}}` |
| 关联已有图符号 | `{"action":"link","request":{"fromId":"...","targetGraph":"...","targetId":"...","note":"依据"}}` |
| 撤销人工边 | `{"action":"removeLink","edgeId":"..."}` |
| 减枝预览 | `{"action":"prune","request":{"nodeId":"...","apply":false}}` |
| 提交减枝到草稿 | `{"action":"prune","request":{"nodeId":"...","apply":true,"revision":"预览返回值"}}` |
| 采纳整份草稿 | `{"action":"save"}` |
| 放弃整份草稿 | `{"action":"discard"}` |

不要把 operation 直接当作整个请求体。除首次 read，使用 `{"draftId":"...","operation":{...}}` 包装。
read、dirty、changes 用于审阅当前内容与变化。保存前确认任务不再运行，检查变更与任务范围一致。
save 遇基线冲突应保留草稿并核对磁盘，不强行覆盖。服务重启或过期导致 draftId 失效时，重新读取已保存图，不声称旧草稿仍在。

批量减枝将 request 的 `nodeId` 替换为非空 `nodeIds` 数组，二者互斥。
使用原始符号 ID，不使用画布路径引用 ID；重复 ID 去重，空集合、未知节点或包含根节点时整批拒绝。
先对整个集合预览，再携带同一 revision 应用，不能把批量操作拆成逐节点提交。
集合及其独占下游一起移除，外部仍可达的共享下游保留；应用只改草稿，save 才写磁盘。

旧直接 `/entries`、`/links`、`/prune` 和 `/analysis` 不走这份草稿，可能立即写文件。
`atlas_agent.py collect` 也使用直接持久化检查点，**不是草稿续采助手**；仅在任务明确允许边采边保存时选用。

## 续采策略

从草稿 read 的 nodes 中选择本轮关注的现存源码节点；已查询节点、有出边节点也可作为起点。不要使用前端 view-ref-* 路径引用 ID。
maxDepth 为 1–100，起点是第 0 层；maxNodes 为 1–10000，只限制本轮新增唯一节点。两个字段均可省略，不使用 0 表示不限；requestBudget 仍必填，为 1–1000 的查询保护。
每轮内部去重，历史 queriedNodes 不阻止本轮重新查询。节点按稳定符号 ID 合并，边按调用双方及调用点行列合并；平行调用点、已有说明与人工边保留。重新采集不自动删除历史关系，因此不是源码全量同步。
addedNodes/addedEdges 是本轮相对基线的新增唯一 ID 数，totalNodes/totalEdges 是图总量；completed 是返回的查询数，画布实例数不是新增数。
启动后轮询 analysisStatus；遇全局任务占用，不不断重提，也不停止别人的任务。
任务完成后重新 read，比较 queriedNodes、pendingNodes、issues 与实际新增关系；无进展时定位原因。
受预算、超时和任务范围约束，不盲目循环到 pending 清零。停止可能需等待正在执行的 LSP 请求结束，再检查最终状态。
多态候选单独处理：索引仅找到一个实现时可自动深入；多个实现保留声明及实现方法，用户或 AI 根据源码选择一个待采实现继续。不能将候选数量当作运行时证明。
移除不相关实现使用草稿减枝，并审阅共享下游影响；仅仅删到剩一个候选不等于已证明它是唯一实现。

## 引入异步/消息入口

1. 阅读发送端、注册/订阅关系与接收函数，确认关联依据。
2. GET `/api/graphs/{slug}/source-files` 获取 fileId；GET `/source-files/{fileId}` 读取文件。
3. POST `/entry-check`，请求 `{"fileId":"...","line":42}`；使用实际行号。校验返回 candidateId 与 node。
4. 在同一草稿调用 entry，fromId 使用源符号 ID，note 写明消息、通道或注册关系及源码位置。
5. read 确认新节点/人工边，再从新源码节点 analyze。无需为了续采先保存节点。

拒绝的入口应重新定位，不伪造 candidateId 或手填未经核验的符号。图已有合适符号时可用 link，避免重复生成同一入口。
人工关联的虚线不是 LSP 证明的直接调用；多态边同样可能是虚线，审阅数据区分语义。
路径引用 ID（例如 view-ref-*）只在前端有效；API 使用 sourceId 对应的原始节点/边 ID。

## 验收和交付

- 核对入口、关键同步调用、分支、异步交接、异常/退出位置；无法确认的地方明确标注。
- 检查 pendingNodes、issues、主动排除、prunedNodeIds；空 pending 不等于没有动态/反射调用。
- 保存前核对草稿变更；保存后重新 GET 图及 validation，确认落盘内容和源码证据。
- 浏览器打开 调用图链接，抽查节点与边跳转、分支展开/收起和大图阅读，不以统计数量代替验收。
- 若手工编辑图或场景，按 `docs/graph-authoring.md` 跑对应内容检查；源码指纹不能为消除警告自动刷新。
- 报告生成/续采耗时、实际查询预算、失败与剩余边界；只有实测过才给性能结论。
- 最终说明结果是“已保存”还是“仅草稿”，交付链接以及业务理解结论。不要把异步任务刚启动说成已完成。

## 从页面新建图

主页或左侧目录点击“新建图”，选择已配置项目、填写名称，打开源文件并选择函数所在行。
项目级校验只核对文件和源码位置，返回 verification=source-position，不等待 LSP，也不声称已识别函数。点击“创建图”只保存待解析位置根节点；首次采集由 LSP 确认并替换为真实函数，失败保留位置供重试。随后配置采集深度与新增节点上限并点击“开始采集”；
取消配置仍保留根节点图。采集结果先预览，采纳并保存后才更新图文件。

采集状态读取临时失败时，页面会自动重试只读查询，不自动重发采集、停止或保存请求。
预览和采纳只更新当前画布，保留缩放、当前选择与无关分支的折叠状态；起点下游按当前展示范围展开。
放弃会移除草稿新增内容，不重建整个画布。当前源码位置未变化时保留已打开的源码预览与滚动状态。
失败或停止后仍可预览已完成的结果；保存冲突应先核对外部变更，不用重复采集覆盖它。
AI 可使用项目级 source-files、entry-check 和 POST /api/graphs 接口；请求契约见
`docs/agent-development-boundaries.md` 的“新建根节点图”。不要直接传本机路径替代 fileId。


## 采集后补充描述（单条或批量）

在节点或连线详情点击“编辑描述”。默认编辑单条；展开“批量编辑 JSON”可粘贴数组。
应用只进入草稿，画布不重新适配；点击保存才更新文件。采集进行中不接受描述编辑。
也可供AI使用同一草稿接口：先read取得draftId，然后POST以下操作，之后read核对、save保存。

```json
{"draftId":"read返回的ID","operation":{"action":"describe","edits":[
  {"targetType":"node","id":"真实节点ID","description":"补充的节点职责"},
  {"targetType":"edge","id":"真实边ID","description":"补充的调用说明"}
]}}
```

每批1–5000项，每条描述最多16000字符；同时受HTTP请求体限制。目标不存在、重复目标、
未知字段或类型错误会拒绝整批，不会部分应用。只能改description，源码位置、身份、
关系、调用顺序和采集状态不变。重复路径引用使用原始sourceId，不使用视图生成的ID。
补充描述是采集后动作，采集器不推测业务含义。


### 从页面接入项目与准备 LSP

首页“新建图”→“接入项目”打开本机目录选择器，选择源码目录并确认项目名称。
项目写入启动时所用的项目配置文件，重启后仍可选择；不需要手工填写项目ID。
现有项目在首页“项目设置”、新建图窗口或工作台“语言服务器”工具栏面板中可启动/停止语言服务器；单语言自动识别，
混合Rust/Java项目可切换语言。新接入项目没有图也会显示在首页。

主动启动会在后台准备服务器；新建图的位置校验不等待 LSP。已有图添加人工入口仍执行 LSP 函数校验。
关闭窗口不会停止主动启动的服务器。手动会话不按5分钟空闲回收，自动会话保持原策略；
源码/配置变化、进程异常和缓存资源限制仍可能导致重新启动。当前会话容量为2，
固定会话占满时请先停止一个；使用中需先停止采集或等待校验结束，再停止服务器。
“已启动”不保证整个项目的语义索引全部完成，首次查询仍可能需要等待。
Java仍需在本地LSP配置中安装并配置JDT LS/JDK，Rust需要rust-analyzer可启动。
主动启停不改变采集预算、15秒单次超时、失败边界和显式保存流程。

AI接口：`POST /api/projects/select-directory`返回短期selectionId（本机用户选择目录），
`POST /api/projects`提交`{"selectionId":"选择凭据","name":"项目名称"}`。
仅接受选择凭据，不接受浏览器提交的绝对路径。目录选择器支持 Windows 与 macOS；macOS 目前需从源码编译运行。
`GET /api/projects/{project}/lsp/{rust|java}`读取state/message/serverType；
`POST`同路径提交`{"action":"start"}`或`{"action":"stop"}`。
启动异步返回starting，轮询直到running/failed；重复启动复用，不另起进程。

资料库位置、说明分离和配置变更的生效时机见[配置与备份](configuration.md)。备份必须包含隐藏说明快照，不能只复制图 JSON。

## 反向调用采集

新建图请求可传 `direction: "incoming"`；省略或 `"outgoing"` 为向下。
`analysis.direction` 保存方向，旧图省略时为向下；queriedNodes / pendingNodes 仅表示本图方向。
续采请求不传方向，继承已加载图。CLI 使用 `analyze --direction incoming`。
LSP incomingCalls 的 from 是调用者，fromRanges 属于该调用者文件；真实边仍为 caller → callee。
稳定边 ID 与正向采集相同，不把探索树方向写成事实边方向。部分失败、预算边界、草稿和 CAS 保存保持原契约。
