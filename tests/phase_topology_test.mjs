import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildPhaseTopology } from "../public/js/phase-navigator.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const graph = JSON.parse(
  await readFile(
    join(root, "graphs", "overview", "codex-end-to-end-agent-loop.json"),
    "utf8",
  ),
);
const topology = buildPhaseTopology(graph);

assert.equal(topology.phases.length, 8);
assert.equal(topology.relations.length, 15);
assert.equal(topology.displayRelations.length, 10);
assert.equal(topology.columns, 4);
assert.equal(topology.rows, 2);
assert.deepEqual(
  topology.phases.map((phase) => phase.position),
  [
    { column: 0, row: 0 },
    { column: 1, row: 0 },
    { column: 2, row: 0 },
    { column: 3, row: 0 },
    { column: 2, row: 1 },
    { column: 1, row: 1 },
    { column: 0, row: 1 },
    { column: 3, row: 1 },
  ],
);
assert.deepEqual(
  topology.phases.map((phase) => phase.id),
  [
    "input-routing",
    "context-preparation",
    "model-request",
    "output-routing",
    "tool-execution",
    "result-feedback",
    "compact-or-finish",
    "turn-finish",
  ],
);
assert.deepEqual(
  topology.phases.map((phase) => phase.topologyRole),
  [
    "entry",
    "action",
    "action",
    "decision",
    "branch",
    "loop",
    "loop",
    "terminal",
  ],
);
assert.equal(
  topology.phases.find((phase) => phase.id === "model-request").routeHint,
  "3 条回环在此重试",
);
assert.equal(
  topology.phases.find((phase) => phase.id === "tool-execution").routeHint,
  "模型请求工具",
);
assert.equal(
  topology.phases.find((phase) => phase.id === "compact-or-finish").routeHint,
  "上下文超限",
);
assert.equal(
  topology.phases.find((phase) => phase.id === "turn-finish").routeHint,
  "完成本轮",
);

const outputToTools = relation("output-routing", "tool-execution");
assert.equal(outputToTools.layoutKind, "spine");
assert.equal(outputToTools.primaryFlowKind, "branch");
assert.equal(outputToTools.edgeIds.length, 2);
assert.equal(outputToTools.displayLabel, "模型请求工具");
assert.deepEqual(outputToTools.conditions, [
  "模型请求 MCP 工具（tool_kind == mcp）",
  "模型请求 Shell 工具（tool_kind == shell）",
]);

const feedbackToModel = relation("result-feedback", "model-request");
assert.equal(feedbackToModel.layoutKind, "feedback");
assert.equal(feedbackToModel.primaryFlowKind, "loop-back");
assert.equal(feedbackToModel.displayLabel, "携带工具结果继续");

const compactToModel = relation("compact-or-finish", "model-request");
assert.equal(compactToModel.layoutKind, "feedback");
assert.equal(compactToModel.primaryFlowKind, "loop-back");
assert.equal(compactToModel.displayLabel, "使用压缩上下文重试");

const hookToModel = relation("output-routing", "model-request");
assert.equal(hookToModel.layoutKind, "feedback");
assert.equal(hookToModel.primaryFlowKind, "loop-back");
assert.equal(hookToModel.displayLabel, "携带 Hook 要求继续");

const decisionToCompact = relation("output-routing", "compact-or-finish");
assert.equal(decisionToCompact.primaryFlowKind, "branch");
assert.deepEqual(decisionToCompact.conditions, [
  "上下文达到压缩阈值（token_limit_reached）",
]);

const decisionToFinish = relation("output-routing", "turn-finish");
assert.equal(decisionToFinish.layoutKind, "outcome");
assert.equal(decisionToFinish.primaryFlowKind, "loop-exit");
assert.equal(decisionToFinish.displayLabel, "完成本轮");
assert.deepEqual(decisionToFinish.conditions, [
  "Stop Hook 未提供有效续跑要求，且任务未被取消",
]);

const modelPhase = topology.phases.find((phase) => phase.id === "model-request");
assert.ok(modelPhase.signals.includes("branch"));
assert.ok(modelPhase.signals.includes("fallback"));

assert.deepEqual(buildPhaseTopology({ nodes: [], edges: [] }), {
  phases: [],
  relations: [],
  displayRelations: [],
  columns: 0,
  rows: 0,
});

console.log("PhaseTopology: all assertions passed");

function relation(from, to) {
  const result = topology.relations.find(
    (candidate) => candidate.from === from && candidate.to === to,
  );
  assert.ok(result, `missing phase relation ${from} -> ${to}`);
  return result;
}
