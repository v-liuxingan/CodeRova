# 调用边控制流语义

## 目标

`nodes / edges` 是唯一调用图结构。后端生成调用图时，只需要在少数具有控制意义的真实
调用边上补充语义，不需要维护分支组、区域、虚拟汇合点或高亮节点清单。

`kind` 和 `flowKind` 回答不同问题：

- `kind`：这次调用如何发生，例如直接调用、回调、spawn、远程调用或数据流。
- `flowKind`：这条边在一次执行流程中承担什么控制角色。

## Edge 字段

```json
{
  "id": "edge.registry-to-shell",
  "from": "node.registry",
  "to": "node.shell",
  "kind": "direct",
  "flowKind": "branch",
  "condition": "tool_kind == shell"
}
```

`flowKind` 可省略，默认是 `normal`：

- `normal`：普通前向调用。
- `branch`：从决策点进入一个候选分支。
- `fallback`：主路径不可用或失败后的降级分支。
- `merge`：分支完成后进入共享汇合节点。
- `loop-back`：从循环体返回前序节点；布局从主流程外侧绕回。
- `loop-exit`：满足退出条件后离开循环。

`condition` 是可选的面向读者说明。`branch`、`fallback` 和 `loop-exit` 缺少条件时后端
给出警告，但不阻断没有显式条件表达式的真实调用图。

## 表达方式

```text
decision
   ├── branch(condition A) ── path A ── merge ── continuation
   └── fallback(condition B) ─ path B ── merge ── continuation

loop body ── loop-back(condition) ── loop entry
          └─ loop-exit(condition) ── after loop
```

分支由同一节点的多条 `branch / fallback` 出边表达；汇合由进入共享节点的 `merge` 边
表达；循环由 `loop-back` 和 `loop-exit` 表达。普通路径仍由真实调用边自然连接。

## 校验

1. `flowKind` 必须属于支持的枚举。
2. 每条边的 `from / to` 必须引用真实节点。
3. 精确调用边继续提供真实源码位置；控制语义不能绕过证据校验。
4. `branch / fallback / loop-exit` 建议提供 `condition`。
5. 不创建仅用于展示的节点或边。

## 生成建议

Tree-sitter、LSP、SCIP、后端分析器或 AI 生成器都可以产出这些字段。无法可靠判断时保持
`normal`，不要猜测复杂结构；人工修正也只需要调整具体边的两个可选字段。
