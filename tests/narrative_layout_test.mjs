import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GraphState } from "../public/js/graph-state.js";
import { NarrativeLayout } from "../public/js/layouts/narrative-layout.js";
import { computeEdgeGeometry } from "../public/js/renderers/svg-renderer.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const layout = new NarrativeLayout();

await testAllRealGraphs();
await testVisibleScenarioCompleteness();
testDeterministicBranchPlacement();
testExplicitExecutionOrderPrecedesEdgeIds();
testCycleSafetyAndDataFallback();
testPositionOverrides();
console.log("NarrativeLayout: all assertions passed");

async function testAllRealGraphs() {
  const graphFiles = (await readdir(join(root, "graphs"), { recursive: true }))
    .filter((file) => file.endsWith(".json"))
    .sort();
  assert.ok(graphFiles.length >= 7);
  for (const file of graphFiles) {
    const graph = JSON.parse(await readFile(join(root, "graphs", file), "utf8"));
    for (const orientation of ["vertical", "horizontal"]) {
      const first = layout.compute(graph, orientation);
      const second = layout.compute(graph, orientation);
      assert.equal(first.nodes.size, graph.nodes.length, `${file} ${orientation} node count`);
      assert.deepEqual(snapshot(first), snapshot(second), `${file} ${orientation} deterministic`);
      for (const entry of first.nodes.values()) {
        assert.ok(Number.isFinite(entry.x), `${file} ${entry.node.id} finite x`);
        assert.ok(Number.isFinite(entry.y), `${file} ${entry.node.id} finite y`);
      }
      const entriesByLevel = new Map();
      for (const entry of first.nodes.values()) {
        if (!entriesByLevel.has(entry.level)) entriesByLevel.set(entry.level, []);
        entriesByLevel.get(entry.level).push(entry);
      }
      for (const entries of entriesByLevel.values()) {
        const orderedCross = [...entries]
          .map((entry) => orientation === "vertical" ? entry.x : entry.y)
          .sort((a, b) => a - b);
        const nodeSpan = orientation === "vertical"
          ? layout.nodeWidth
          : layout.nodeHeight;
        for (let index = 1; index < orderedCross.length; index += 1) {
          assert.ok(
            orderedCross[index] - orderedCross[index - 1] >= nodeSpan,
            `${file} ${orientation} same-level nodes do not overlap`,
          );
        }
      }
      const spine = [...first.nodes.values()]
        .filter((entry) => entry.narrativeRole === "spine");
      assert.ok(spine.length >= 1, `${file} has a narrative spine`);
      const alignedSpine = spine.filter((entry) => !entry.orderedSiblingBand);
      const crossCoordinates = alignedSpine.map((entry) =>
        orientation === "vertical" ? entry.x : entry.y);
      assert.ok(
        new Set(crossCoordinates).size <= 1,
        `${file} ${orientation} unordered spine aligned`,
      );
      assert.ok(Number.isFinite(first.bounds.width) && first.bounds.width > 0);
      assert.ok(Number.isFinite(first.bounds.height) && first.bounds.height > 0);
      for (const entry of first.edges) {
        if (entry.routingRole === "feedback") continue;
        assert.ok(
          entry.to.level > entry.from.level,
          `${file} ${orientation} ${entry.edge.id} must move forward`,
        );
      }
      const opposite = layout.compute(
        graph,
        orientation === "vertical" ? "horizontal" : "vertical",
      );
      assert.deepEqual(
        feedbackIds(first),
        feedbackIds(opposite),
        `${file} feedback classification is orientation independent`,
      );
    }
  }
}

async function testVisibleScenarioCompleteness() {
  const graph = JSON.parse(
    await readFile(
      join(root, "graphs", "overview", "codex-end-to-end-agent-loop.json"),
      "utf8",
    ),
  );
  const state = new GraphState(graph);
  const visible = state.getVisibleGraph();
  const result = layout.compute(visible);
  assert.equal(result.nodes.size, visible.nodes.length, "every visible node is placed");
  assert.ok(
    result.edges.every((entry) => entry.from && entry.to),
    "every visible edge has placed endpoints",
  );
  assert.deepEqual(feedbackIds(result), [
    "e2e.compacted-history-to-prompt",
    "e2e.history-back-to-prompt",
  ]);
  assert.ok(
    result.edges
      .filter(({ routingRole }) => routingRole === "forward")
      .every(({ from, to }) => to.level > from.level),
    "all default scenario non-feedback edges move forward",
  );
}

function testDeterministicBranchPlacement() {
  const graph = {
    root: "root",
    nodes: ["root", "main", "branch-a", "branch-b", "branch-c"]
      .map((id) => ({ id })),
    edges: [
      edge("edge-1-main", "root", "main"),
      edge("edge-2-a", "root", "branch-a"),
      edge("edge-3-b", "root", "branch-b"),
      edge("edge-4-c", "root", "branch-c"),
    ],
  };
  for (const orientation of ["vertical", "horizontal"]) {
    const result = layout.compute(graph, orientation);
    const cross = (id) => {
      const entry = result.nodes.get(id);
      return orientation === "vertical" ? entry.x : entry.y;
    };
    assert.equal(cross("root"), 0);
    assert.equal(cross("main"), 0);
    const branchCoordinates = ["branch-a", "branch-b", "branch-c"].map(cross);
    assert.ok(branchCoordinates.some((value) => value < 0), `${orientation} left branch`);
    assert.ok(branchCoordinates.some((value) => value > 0), `${orientation} right branch`);
  }
}

function testExplicitExecutionOrderPrecedesEdgeIds() {
  const graph = {
    root: "caller",
    nodes: ["caller", "first", "second"].map((id) => ({ id })),
    edges: [
      { ...edge("a-second", "caller", "second"), order: 2, line: 30 },
      { ...edge("z-first", "caller", "first"), order: 1, line: 20 },
    ],
  };
  const result = layout.compute(graph);

  assert.deepEqual(result.narrative.orderedNodeIds.slice(0, 2), [
    "caller",
    "first",
  ]);
  assert.deepEqual(
    result.edges.map(({ edge: graphEdge }) => graphEdge.id),
    ["z-first", "a-second"],
  );
  assert.ok(
    result.nodes.get("first").x < result.nodes.get("second").x,
    "same-level ordered calls must read from left to right",
  );
  assert.equal(
    (result.nodes.get("first").x + result.nodes.get("second").x) / 2,
    result.nodes.get("caller").x,
    "the ordered sibling band remains centered on its caller",
  );
  const horizontal = layout.compute(graph, "horizontal");
  assert.ok(
    horizontal.nodes.get("first").y < horizontal.nodes.get("second").y,
    "horizontal ordered calls must read from top to bottom",
  );

  const overridden = layout.compute(graph, "vertical", {
    first: { x: 812.5, y: 196 },
  });
  assert.equal(
    overridden.nodes.get("first").x,
    812.5,
    "manual positions remain authoritative",
  );
  assert.equal(
    overridden.nodes.get("second").x,
    result.nodes.get("second").x,
    "dragging one ordered sibling must not reshuffle the remaining band",
  );
}

function testCycleSafetyAndDataFallback() {
  const graph = {
    root: "a",
    nodes: ["a", "b", "c", "data"].map((id) => ({ id })),
    edges: [
      edge("control-a-b", "a", "b"),
      edge("control-b-c", "b", "c"),
      edge("control-c-a", "c", "a"),
      edge("data-c-data", "c", "data", "data-flow"),
    ],
  };
  const result = layout.compute(graph);
  assert.equal(result.nodes.size, 4);
  assert.deepEqual(result.narrative.orderedNodeIds, ["a", "b", "c", "data"]);
  assert.equal(result.narrative.edgeIds.has("data-c-data"), true);
  assert.deepEqual(feedbackIds(result), ["control-c-a"]);
  assert.ok(
    result.edges
      .filter(({ routingRole }) => routingRole === "forward")
      .every(({ from, to }) => to.level > from.level),
  );
  const horizontal = layout.compute(graph, "horizontal");
  assert.deepEqual(feedbackIds(horizontal), ["control-c-a"]);
  assert.ok(
    horizontal.edges
      .filter(({ routingRole }) => routingRole === "forward")
      .every(({ from, to }) => to.level > from.level),
  );
}

function testPositionOverrides() {
  const graph = {
    root: "a",
    nodes: ["a", "b"].map((id) => ({ id })),
    edges: [edge("a-b", "a", "b")],
  };
  const result = layout.compute(graph, "vertical", { b: { x: 812.5, y: -48 } });
  assert.equal(result.nodes.get("b").x, 812.5);
  assert.equal(result.nodes.get("b").y, -48);
  assert.equal(result.nodes.get("b").level, 1);
  assert.equal(result.edges[0].routingRole, "forward");
  const geometry = computeEdgeGeometry(result.edges[0], "vertical");
  assert.equal(geometry.routingRole, "feedback");
  assert.match(geometry.pathData, / H .* V .* H /);
}

function snapshot(result) {
  return {
    nodes: [...result.nodes].map(([id, entry]) => [
      id,
      entry.x,
      entry.y,
      entry.narrativeRole,
      entry.branchSide,
    ]),
    edges: result.edges.map(({ edge, narrativeRole }) => [edge.id, narrativeRole]),
    spine: result.narrative.orderedNodeIds,
  };
}

function feedbackIds(result) {
  return result.edges
    .filter(({ routingRole }) => routingRole === "feedback")
    .map(({ edge }) => edge.id)
    .sort();
}

function edge(id, from, to, kind = "direct") {
  return { id, from, to, kind };
}
