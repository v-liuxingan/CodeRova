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
仅采项目内可解析关系。项目根外目标可能只有 issues，而不是必定显示一个外部依赖节点。Rust 默认关闭构建脚本/过程宏，不能为补全图静默开启执行。
排除使用可重复 `--exclude-path <项目相对文件或目录>`，不是 glob；说明排除原因，不默认删除 tests/vendor 等目录。

生成后读 `/api/graphs` 获取 slug，检查 `/api/graphs/{slug}` 与 `/validation`。需手工改图时先读 `graphs/AGENTS.md` 和内容规范。

## 默认使用草稿完成多步操作

所有下面的 operation 均 POST `/api/graphs/{slug}/draft`。第一次 read 创建草稿，记录响应中的 draftId；后续携带同一个 ID。

```json
{"operation":{"action":"read"}}
```

```json
{"draftId":"服务返回值","operation":{"action":"analyze","request":{"nodeId":"真实待采叶子ID","requestBudget":100}}}
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

旧直接 `/entries`、`/links`、`/prune` 和 `/analysis` 不走这份草稿，可能立即写文件。
`atlas_agent.py collect` 也使用直接持久化检查点，**不是草稿续采助手**；仅在任务明确允许边采边保存时选用。

## 续采策略

从草稿 read 的 analysis.pendingNodes 中选择原始图无出边的节点；屏幕上无可见子节点并不足够。
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
5. read 确认新节点/人工边，再从新待采叶子 analyze。无需为了续采先保存节点。

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
校验通过后点击“创建图”：此步只保存根节点。随后配置请求预算并点击“开始采集”；
取消配置仍保留根节点图。采集结果先预览，采纳并保存后才更新图文件。
AI 可使用项目级 source-files、entry-check 和 POST /api/graphs 接口；请求契约见
`docs/agent-development-boundaries.md` 的“新建根节点图”。不要直接传本机路径替代 fileId。
