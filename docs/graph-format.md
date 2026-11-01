# 图数据格式 0.5

本项目以 JSON 保存调用图，布局继续独立存放在 `layouts/<slug>.layout.json`。
0.5 统一关系方向和来源命名，接近 Graphify 的 `source/target/relation` 概念，
同时遵守本项目 camelCase 契约。它不是 Graphify graph.json 的直接兼容格式。

## 命名映射

| 内容 | 0.2–0.4（仍可读） | 0.5（保存/导出/HTTP 输出） |
| --- | --- | --- |
| 调用方 | edge.from | edge.source |
| 被调用方 | edge.to | edge.target |
| 关系类型 | edge.kind | edge.relation |
| 节点或边的源码文件 | file | sourceFile |
| 数值置信度 | edge.confidence | edge.confidenceScore |

节点的 kind 仍表示符号类型；边的 relation 表示关系。relation 的取值保持 static-call、
trait-dispatch、async-boundary 等原有语义，不把它们全部压成 calls。
保留顶层 edges，Graphify 的 links 由将来的导入适配器处理。
line/endLine 仍是从 1 开始的数字；节点 line 是声明位置，边 line 是调用位置。
sourceFile 是相对于可信项目根的路径，不是浏览器可任意指定的本机绝对路径。
Graphify 的 EXTRACTED/INFERRED/AMBIGUOUS 不是数值概率，不能直接赋给 confidenceScore。
本轮不引入伪造的来源、签名、列号或未知调用位置。

## 示例

```json
{
  "schemaVersion": "0.5",
  "projectId": "sample",
  "title": "启动流程",
  "root": "main",
  "nodes": [
    {"id": "main", "kind": "function", "label": "main", "sourceFile": "main.rs", "line": 1, "role": "入口"},
    {"id": "run", "kind": "function", "label": "run", "sourceFile": "main.rs", "line": 5, "role": "执行"}
  ],
  "edges": [
    {"id": "call-1", "source": "main", "target": "run", "relation": "static-call", "sourceFile": "main.rs", "line": 2, "callSiteStatus": "exact", "confidenceScore": 1.0},
    {"id": "call-2", "source": "main", "target": "run", "relation": "static-call", "sourceFile": "main.rs", "line": 3, "callSiteStatus": "exact", "confidenceScore": 1.0}
  ]
}
```

相同 source/target 可以有多条边，调用点和 ID 不因字段更名而合并。
节点 ID、关系 ID、root、证据和采集状态均保留，已有布局继续按原 ID 工作。

## 兼容策略

- 0.2–0.4 文件继续读取；读取或打开页面不改写原文件。
- 后端保存、CLI 导出及 HTTP 图响应输出 0.5 和新字段。
- 新旧字段同时出现会拒绝，避免静默选择不同路径或调用目标；未知字段仍拒绝。
- 未知 schemaVersion 不自动降级成 0.5，由校验器报告不支持。
- 前端和内容证据工具通过 `public/js/graph-format.js` 统一适配，渲染器内部字段暂不迁移。
- 外部 API 使用者应更新字段名；源码预览、导航和 HTTP 请求参数不在本次更名范围。
- 原有著述文档中标记 0.4 的示例仍然有效，新产物以本文件和 schema 为准。

## 文件职责与后续边界

图文件继续承载当前单入口图及采集状态。布局文件只保存坐标，不承载调用事实。
本轮不改变用户的保存、隐藏、删除语义，也不引入跨文件保存事务。
共享分析文件、多视图文件、结构化起止列和逐关系 provenance 留待独立版本设计，
不能仅通过命名迁移宣称已经具备这些能力。
