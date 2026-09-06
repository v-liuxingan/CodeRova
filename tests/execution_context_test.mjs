import assert from "node:assert/strict";
import { edgeReadingNotes, executionOrderNote, nodeExecutionContext, scenarioExecutionContext } from "../public/js/execution-context.js";

const graph = {
  nodes: [{ id: "root", label: "Start" }, ...Array.from({ length: 24 }, (_, index) => ({ id: `n${index}`, label: `Target ${index}` }))],
  edges: Array.from({ length: 24 }, (_, index) => ({
    id: `edge-${index}`, from: "root", to: `n${index}`, kind: "direct", order: 24 - index,
    file: "main.rs", line: index + 1,
  })),
};
const original = JSON.stringify(graph);
const context = nodeExecutionContext(graph.nodes[0], graph);
assert.equal(context.outgoing.length, 24, "All outgoing relationships survive the reading summary");
assert.deepEqual(context.outgoing.map((item) => item.order), Array.from({ length: 24 }, (_, i) => i + 1));
assert.equal(JSON.stringify(graph), original, "Reading context must not reorder or mutate graph facts");
assert.match(context.note, /同一调用者/);
assert.match(context.note, /不代表返回或并发完成顺序/);
const alternatives = [
  { id: "a", from: "root", to: "n0", kind: "spawn", flowKind: "branch", condition: "approved", confidence: 0.6, callSiteStatus: "omitted-nodes", callSiteNote: "compressed" },
  { id: "b", from: "root", to: "n1", kind: "direct", flowKind: "fallback" },
  { id: "loop", from: "n0", to: "root", kind: "direct", flowKind: "loop-back" },
];
const branchContext = nodeExecutionContext(graph.nodes[0], { ...graph, edges: alternatives });
assert.equal(branchContext.incoming[0].id, "loop", "Feedback evidence remains discoverable");
assert.equal(branchContext.outgoing[0].condition, "approved");
assert.match(branchContext.outgoing[0].evidence, /已省略中间节点.*60%/);
assert.match(branchContext.note, /不表示这些路径都会依次执行/);
assert.match(branchContext.note, /列表位置不表示执行先后/);
assert.match(edgeReadingNotes(alternatives[1]).join(" "), /触发条件尚未标注/);
assert.match(edgeReadingNotes({ kind: "async-boundary" }).join(" "), /异步不等于无需等待/);
assert.match(edgeReadingNotes({ kind: "data-flow" }).join(" "), /数据或状态依赖/);
assert.match(executionOrderNote([]), /不等于运行时一定在此结束/);

const scenario = {
  participants: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, label: `Participant ${i}` })),
  steps: graph.nodes.map((node, i) => ({ ...node, participantId: `p${i % 7}` })),
  links: graph.edges.map((edge) => ({ ...edge, kind: "publish", condition: "result available", summary: "Send the result" })),
};
const scenarioContext = scenarioExecutionContext(scenario.steps[0], scenario, { publish: "发布" });
assert.equal(scenarioContext.outgoing.length, 24);
assert.equal(scenarioContext.outgoing[0].condition, "result available");
assert.equal(scenarioContext.outgoing[0].description, "Send the result");
assert.equal(scenarioContext.outgoing[0].order, undefined, "Scenario layout does not invent message order");
assert.equal(scenarioContext.outgoing[0].target.type, "step");
console.log("Execution context: completeness, causal meaning, evidence, and immutable graph checks passed");
