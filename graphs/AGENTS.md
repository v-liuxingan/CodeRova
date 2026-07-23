# 调用图内容生成要求

创建或修改本目录中的任何 `*.json` 调用图前，必须完整阅读：

1. `../docs/callgraph-content-standard.md`
2. `../docs/control-flow-semantics.md`

节点和关系说明必须同时基于源码事实与整图上下文，不能只复述函数名。修改完成后，通读
整张图检查入口、主干、分支、汇合、回环和终点的叙事是否连续，并运行仓库根
`AGENTS.md` 中的 Contract data 验证命令。
