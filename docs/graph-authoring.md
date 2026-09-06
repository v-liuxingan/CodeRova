# 场景地图与调用图的生成入口

两类产物分别分析、分别输出数据，项目统一负责渲染。它们只通过基础链接连接，不维护
跨图选中状态或节点映射。生成某一类图时，只读取该类专项规范和相关源码。

| 要生成的内容 | 模型交付 | 必读规范 | 生成/校验 |
| --- | --- | --- | --- |
| 谁在协作、消息和控制权如何传递 | `scenes/<slug>.mmd` + 同名元数据 `.json` | [场景生成规范](scenario-authoring.md) | `npm run build:scenes`、`npm run check:scenes` |
| 函数、调用点及可验证的执行链 | `graphs/<categoryId>/<slug>.json` | [调用图内容规范](callgraph-content-standard.md)、[控制流语义](control-flow-semantics.md)、`graphs/AGENTS.md` | `cargo run -- validate <图文件>` |

场景元数据契约为 `schema/mermaid-scene.schema.json`，内部语义及兼容 JSON 契约为
`schema/sequence-scene.schema.json`；调用图契约为
`schema/callgraph.schema.json`。绘图 skill 的视觉原则由场景渲染器实现，模型无需承担
HTML/SVG 设计或加载完整 skill。无需为了生成独立场景同步修改调用图。

生成任务可以直接使用以下说明：

> 阅读 docs/scenario-authoring.md，根据目标源码分析指定场景，输出 scenes/<slug>.mmd 与同名元数据 JSON。
> 使用规范中支持的 Mermaid 时序语法；不重复生成 participants/body。
> 保留起止边界、条件、循环、并发、重要交接与源码依据；不输出坐标或 HTML/SVG。
> 运行场景构建与检查，报告尚未核验的结论。

> 阅读 graphs/AGENTS.md 及其要求的内容和控制流规范，根据目标源码生成指定调用图。
> 节点解释职责，边解释控制权、数据或条件变化，精确位置核对到对应符号。
> 不以节点数量限制完整性，不从阶段排序推断业务终点。运行图校验并报告未核验证据。

项目共同目标与验收方式见 [产品战略](product-strategy.md)。生成规则需要随着契约、
渲染能力和 CR 结论同步更新；历史审查记录不能替代当前专项规范。
