# AI 操作调用图

任务入口见 [工作台 Skill](skills/callgraph-workbench/SKILL.md)。默认使用本文后半部的
**草稿协议**完成编辑与续采，核验后显式保存；下面的旧直接接口和 `collect` 示例会立即
持久化检查点，仅用于明确需要边采边保存的任务。不要将直接接口当作可放弃的预览。

平台采用 CLI 创建初始图、HTTP 操作已加载图。AI 不必模拟点击；人和 AI 使用相同的数据
校验、源码节点身份检查、检查点和减枝算法。平台不会自行推断消息路由：AI 阅读源码后负责选择
接收入口、提供依据，并检查产出。LSP 查询结束也不等于动态调用或业务语义完整。

## 从源码到可阅读结果

1. 读取 `callgraph.projects.json` 的可信项目配置和入口源码。项目根不通过浏览器提交。
2. 用 `analyze` 创建初始图（参数以 `analyze --help` 为准），例如：
   ```powershell
   .\target\frontend-e2e\debug\coderova.exe analyze --config callgraph.projects.json --project <project-id> --file src/main.rs --line 1 --column 4 --max-depth 1 --request-budget 20 --output graphs/example.json
   ```
3. GET `/api/graphs` 获取真实 slug，再读取图，按目标流程选择现存源码节点继续采集。
4. 遇消息、事件或回调边界，读取源文件，定位接收函数，执行 entry-check，再 entries。
   保存说明必须准确表达推断依据；虚线是人工关联，不是 LSP 证明的直接调用。
5. 对明确不属于目标场景的节点先预览减枝范围，再提交版本。不要仅为了图小就删除真实分支。
6. 自动续采，读取 validation、pendingNodes、prunedNodeIds、issues；报告未解析边界、排除范围
   和源码版本限制，最后交付 `/?graph=<slug>`。预算耗尽时不能宣称已完整分析。

## 不依赖浏览器的客户端

`scripts/atlas_agent.py` 使用 Python 标准库，输出 JSON，不出现交互确认。

```powershell
python -X utf8 scripts/atlas_agent.py --base http://127.0.0.1:4323 request GET /api/graphs
python -X utf8 scripts/atlas_agent.py --base http://127.0.0.1:4323 collect <slug> --max-requests 1000 --batch 100 --timeout 1800
python -X utf8 scripts/atlas_agent.py --base http://127.0.0.1:4323 request POST /api/graphs/<slug>/entry-check --data-file check.json
```

请求体写入 UTF-8 JSON 文件，避免命令行引号损坏。客户端限制为本机 HTTP，自动设置同源
Origin，服务继续拒绝未知字段和任意文件路径。退出码：0 成功，1 请求失败，2 续采未收敛。
`finished=true` 仅表示没有 pendingNodes，不代表无未知动态调用或无主动排除。
自动续采不会无限重试同一个失败叶子。待采非叶子或未解析叶子返回 unresolvedBoundaries；
这是 collect 脚本仍采用的保守选择策略，不是服务器限制；可用草稿 analyze 从现存源码节点定向续采。超时发出停止请求，当前 LSP 请求可能稍后才完成并保存。
任务状态目前是服务内单任务，不支持多个 AI 同时编排；脚本退出后应 GET 状态再决定下一步。

## HTTP 操作表

以下路径均以 `/api/graphs/{slug}` 为前缀；ID 从读取接口获得。

| 操作 | 方法 / 后缀 | 请求或结果 |
| --- | --- | --- |
| 图与覆盖状态 | GET 空后缀 | nodes、edges、analysis |
| 校验结果 | GET /validation | 错误与警告 |
| 源文件列表 | GET /source-files | id、相对 name |
| 完整源文件 | GET /source-files/{fileId} | name、text；只读、最大 2 MiB |
| 验证入口 | POST /entry-check | `{ "fileId":"...", "line":42 }`；返回 candidateId、node |
| 添加人工入口 | POST /entries | `{ "fromId":"...", "candidateId":"...", "note":"源码依据" }` |
| 关联已有图符号 | POST /links | `{ "fromId":"...", "targetGraph":"...", "targetId":"...", "note":"依据" }` |
| 撤销人工关联 | DELETE /links/{edgeId} | 仅删除人工边，保留节点 |
| 启动定向续采 | POST /analysis | `{ "nodeId":"...", "requestBudget":100 }`；任意现存可采源码节点，可另传 maxDepth/maxNodes |
| 查询 / 停止 | GET /analysis、DELETE /analysis | status、completed、pending、message |
| 减枝预览 | POST /prune | `{ "nodeId":"...", "apply":false }` |
| 提交减枝 | POST /prune | `{ "nodeId":"...", "apply":true, "revision":"预览返回值" }` |

批量减枝兼容相同端点：用 `{"nodeIds":["symbol-a","symbol-b"],"apply":false}` 预览，
再携带同一集合、`apply:true` 与返回的 revision 应用。`nodeId` 与 `nodeIds` 必须且只能提供一个；
数组去重，空数组、未知节点、包含根节点或未知请求字段均拒绝整批。
对集合统一计算独占下游和共享引用，不逐项提交；草稿 prune 使用相同 request，保存前不改磁盘。

减枝返回 removedNodeIds、removedEdgeIds、preservedSharedNodeIds、revision、applied。
默认先预览，提交缺少版本或图已改变时失败；AI 可依据预览自主提交，不需人操作页面。
减枝移除该符号的所有调用位置及独占下游，不是某个路径副本的折叠。其他调用方可达的
共享下游保留，根节点保护；源码不删除。目前没有减枝撤销栈，提交前可保存 GET 图快照。
prunedNodeIds 持久保存，后续 LSP 续采不会自动重新引入；显式 entries/links 重新关联某
个符号可解除该符号的排除，但不会恢复此前删除的完整链。独立 analyze 新建图不继承排除。

## 验收

自动测试覆盖预览不写入、取消、版本冲突、根保护、共享下游、环、持久排除以及 AI 无页面
点击的续采。业务验收仍使用 10 分钟理解任务：读者解释目标场景、异步边界及裁剪范围，
并从保留证据定位源码。无需人帮 AI 填参数，不等于无需检查静态分析的能力边界。

## 草稿、保存与临时隐藏

V2 页面现在默认将节点新增、人工关联、减枝及撤销关联暂存在内存草稿；“保存修改”才更新
图文件。“永久删除”表示保存后的语义，保存前可以放弃整份草稿。右键或侧栏的“仅本次隐藏”
不改图数据，刷新后恢复，也可点击“恢复本次隐藏”；它不随保存持久化。

AI 可以使用 POST `/api/graphs/{slug}/draft` 完成多步编辑后一次提交：

```json
{"operation":{"action":"read"}}
```

取得 draftId 后，每次都携带它，例如：

```json
{"draftId":"返回的 ID","operation":{"action":"entry","request":{"fromId":"调用方 ID","candidateId":"校验返回值","note":"关联依据"}}}
```

operation 支持 read、entry、link、removeLink、prune、preview、open、analyze、analysisStatus、stopAnalysis、save、discard。
entry/link/prune/preview 的 request 与原接口相同；removeLink 使用 edgeId。
保存为 `{"draftId":"...","operation":{"action":"save"}}`，放弃将 save 换为 discard。
返回 dirty 与 changes（节点/连线新增、删除数量），read 返回 graph；编辑操作通过 result
返回原接口结果。不同草稿互相隔离。save 检查磁盘图仍与草稿基线一致，冲突保留草稿并拒绝
覆盖。旧直接 API 仍立即写入；需要暂存时必须使用 draft，而不是调用旧 API 后期待回滚。

草稿在服务内存中，服务重启会失效；保存后 draftId 保留并更新基线，支持重试；放弃后 draftId 失效。页面刷新和关闭使用浏览器
原生未保存提醒，站内切换提供保存/放弃/取消。不能在 beforeunload 中异步保存，用户要先
取消离开并点击保存。页面采集使用同一草稿，检查点只更新服务内存，新增节点不必先保存即可继续采集。
本轮草稿保存图内容，主题、目录排序等沿用既有偏好机制；不把临时隐藏混入永久图数据。

暂存采集示例（先 read 获取 draftId）：

```json
{"draftId":"...","operation":{"action":"analyze","request":{"nodeId":"现存源码节点 ID","requestBudget":100}}}
```

轮询 analysisStatus，停止用 stopAnalysis；两者不带 request，状态位于 result。
任务完成后 read 查看草稿，save 采纳整份草稿，discard 放弃整份草稿。运行期间不能保存，
放弃会请求停止本草稿的任务。任务仍为全局单任务；其他草稿不能查看或停止私有采集任务。
预览不会写文件，也不在浏览器保存结果或采纳标记。含采集的草稿闲置 30 分钟自动清理；
页面轮询和检查点更新会续期。服务重启同样清除内存草稿。
旧直接 /analysis 接口和 collect CLI 仍持久写入检查点，适用于明确要求保存的自动化；
需要先审阅后采纳的 AI 流程应使用上述 draft 协议。

## Java 多态候选

读取图的 symbol 可获得所属类型及修饰符。`trait-dispatch` 且
`callSiteStatus=omitted-nodes` 的边表示声明方法到候选实现；不表示每个实现都会执行。
本轮索引仅找到一个实现时自动继续，多个实现停在方法这一层。AI 应先检查声明和实现源码，再通过草稿 analyze 的 nodeId
选择某个候选继续采集；不需要增加人工入口。批量采集不会替 AI 选择仅有候选入边的方法。

不需要的实现用原 prune 协议处理：先请求 apply=false 获取 revision 并审查影响范围，
再带 revision、apply=true 删除，最后 save；discard 可放弃整轮选择。保留接口声明，
不能将人工选择包装成已证明的运行时分派。存在共享下游时沿用减枝的共享节点保护规则。

## 源码跳转链接

已保存图使用 POST /api/open。未保存图使用草稿 operation.action=open，request 为
`{"graph":"当前 slug","targetType":"node 或 edge","id":"原始节点或边 ID"}`。
返回 result.uri/path/line/column；open 是只读操作，不将草稿标记为修改，不保存图。
路径只能由图和服务端项目目录解析，禁止传 path 等额外字段；非精确边返回错误而不猜测位置。

## 创建调用图

1. `GET /api/health` 选择已配置且 `rootExists=true` 的项目。
2. `GET /api/projects/{projectId}/source-files` 获取文件 ID；`GET /api/projects/{projectId}/source-files/{fileId}` 读取源文件。
3. `POST /api/projects/{projectId}/entry-check`，请求 `{ "fileId": "服务器返回的 ID", "line": 1 }`；行号从 1 开始，检查文件内非空源码位置；返回 verification=source-position，不启动 LSP、不确认函数。
4. `POST /api/graphs`，请求 `{ "projectId": "项目 ID", "candidateId": "校验返回的令牌", "title": "流程名称" }`。
   返回 `{ "slug": "新图 ID", "nodeId": "待解析位置节点 ID" }`。该动作明确保存一张只有根节点的图，成功后令牌失效。
5. 使用现有草稿采集接口配置预算，从返回的位置节点开始采集，由 LSP 确认真实函数并更新引用。采集不会因创建而自动启动；采纳/保存仍是独立动作。

不得使用浏览器提供的任意绝对路径代替项目与文件 ID。校验失败或源码变化时重新选行校验，不能自行构造候选令牌。


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

## 定向采集限制与统计

`requestBudget` 必填，范围 1–1000，限制本轮符号查询；重试不算新符号。可选 `maxDepth` 为 1–100（起点第 0 层），`maxNodes` 为 1–10000（仅新增唯一节点）。省略字段解除对应限制，不能用 0 替代。页面允许两项都留空，但仍发送查询保护预算。

```json
{"draftId":"服务返回值","operation":{"action":"analyze","request":{"nodeId":"现存源码节点ID","requestBudget":1000,"maxDepth":3,"maxNodes":100}}}
```

每轮重新查询所选范围，环与共享下游在本轮去重。节点按稳定符号 ID、边按调用方/目标/调用点行列合并；保留已有说明、人工关系和不同调用点的平行边，不自动移除旧事实。失败保留已获证据与待采边界。`addedNodes/addedEdges` 为本轮新增唯一 ID 数，`totalNodes/totalEdges` 为图总量，`completed` 为已返回查询数；不能用画布引用数或入口替换计算新增量。

## 资料库与项目操作

| 操作 | 接口及请求 |
| --- | --- |
| 读取资料库位置 | `GET /api/storage`，含 root、nextRoot、configFile、restartRequired、commandLineOverride |
| 设置下次启动位置 | `POST /api/storage`，`{"selectionId":"系统目录选择凭据"}`；不接受路径、不搬迁旧数据 |
| 读取目录别名与分组 | `GET /api/library` |
| 项目目录显示名 | `POST /api/library`，`{"action":"renameDirectory","projectId":"...","name":"..."}` |
| 创建/重命名分组 | `POST /api/library`，`{"action":"upsertGroup","projectId":"...","groupId":"...","name":"..."}`；使用稳定 ID |
| 删除分组元数据 | `POST /api/library`，`{"action":"deleteGroup","projectId":"...","groupId":"..."}`；不等于归档组内图 |
| 图重命名 | `PUT /api/graphs/{slug}/title`，`{"title":"..."}`；slug 不变，先处理草稿冲突 |
| 本机选择源文件 | `POST /api/projects/{projectId}/select-file` 或 `POST /api/graphs/{slug}/select-file`；返回 id/name 或 cancelled |

目录选择凭据来自 `POST /api/projects/select-directory`。原生选择器需要本机交互；自动化不能伪造路径或 selectionId。文件必须属于项目枚举目录，拒绝符号链接、构建目录和项目外文件。项目注册与 LSP 启停参见 [分析操作](skills/callgraph-workbench/references/analysis.md)。

图 GET 仍返回合成后的事实与说明，API 使用者不直接编辑 `_annotations` 快照引用。磁盘结构、配置优先级与备份见[配置与备份](skills/callgraph-workbench/references/configuration.md)。

## 新建反向调用图

`POST /api/graphs` 接受 `{projectId,candidateId,title,direction?}`，direction 严格为
`outgoing`（默认）或 `incoming`。候选仍由项目 entry-check 获取，不接收客户端路径。
响应仍为 `{slug,nodeId}`。方向保存在 `analysis.direction`；续采与草稿 analyze 继承图方向，
不接受请求级方向切换，历史未标方向的图按 outgoing 处理。
incoming 图的 root 是追溯锚点，节点结构不变；每条调用边仍从 caller 指向 callee，调用点属于 caller。
pendingNodes / queriedNodes 和剪枝均按图方向解释。无调用者不等于程序入口。
