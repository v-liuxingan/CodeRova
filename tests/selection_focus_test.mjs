import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GraphState } from "../public/js/graph-state.js";
import {
  computeEdgeSelectionFocus,
  computeSelectionFocus,
} from "../public/js/selection-focus.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const graph = fixtureGraph();

testBranchAndMergeFocus();
testGraphStateSelectionBoundary();
testDirectAndMergeEdgeFocus();
testLoopBackEdgeFocusDoesNotExpand();
testBranchAnchorContext();
testSiblingSelectionReplacesPreviousHighlight();
testRunTurnKeepsTheCurrentIncomingBranch();
testRealTurnLoopDoesNotExpandThroughNextIteration();
console.log("SelectionFocus: all assertions passed");

function testBranchAndMergeFocus() {
  const focus = computeSelectionFocus("branch-a", graph.nodes, graph.edges);
  assert.equal(focus.active, true);
  assert.deepEqual(focus.focusNodeIds, new Set([
    "root",
    "decision",
    "branch-a",
    "merge",
    "tail",
  ]));
  assert.equal(focus.focusNodeIds.has("branch-b"), false);
  assert.equal(focus.focusNodeIds.has("foreign"), false);
  assert.deepEqual(focus.focusEdgeIds, new Set([
    "root-decision",
    "decision-a",
    "a-merge",
    "merge-tail",
    "tail-decision-loop",
  ]));
  assert.equal(
    focus.focusEdgeIds.has("root-tail-cross"),
    false,
    "an edge is not focused merely because both endpoints are focused",
  );

  const empty = computeSelectionFocus(null, graph.nodes, graph.edges);
  assert.equal(empty.active, false);
  assert.equal(empty.focusNodeIds.size, 0);
}

function testGraphStateSelectionBoundary() {
  const state = new GraphState(graph);
  state.select({ type: "node", id: "branch-a" });
  const nodeFocus = state.getVisibleGraph();
  assert.equal(nodeFocus.nodes.length, graph.nodes.length);
  assert.equal(nodeFocus.edges.length, graph.edges.length);
  assert.equal(nodeFocus.selectionFocus.focusNodeIds.has("branch-b"), false);

  state.select({ type: "edge", id: "decision-a" });
  const edgeFocus = state.getVisibleGraph().selectionFocus;
  assert.equal(edgeFocus.active, true);
  assert.equal(edgeFocus.originEdgeId, "decision-a");
  assert.equal(edgeFocus.focusNodeIds.has("branch-b"), false);
  assert.equal(edgeFocus.focusEdgeIds.has("decision-b"), false);
  state.select(null);
  assert.equal(state.getVisibleGraph().selectionFocus.active, false);
}

function testDirectAndMergeEdgeFocus() {
  const direct = computeEdgeSelectionFocus(
    "decision-a",
    graph.nodes,
    graph.edges,
  );
  assert.equal(direct.active, true);
  assert.equal(direct.originNodeId, null);
  assert.equal(direct.originEdgeId, "decision-a");
  assert.deepEqual(direct.focusNodeIds, new Set([
    "root",
    "decision",
    "branch-a",
    "merge",
    "tail",
  ]));
  assert.equal(direct.focusNodeIds.has("branch-b"), false);
  assert.equal(direct.focusEdgeIds.has("decision-a"), true);
  assert.equal(direct.focusEdgeIds.has("decision-b"), false);

  const merge = computeEdgeSelectionFocus(
    "a-merge",
    graph.nodes,
    graph.edges,
  );
  assert.equal(merge.focusNodeIds.has("branch-b"), false);
  assert.equal(merge.focusEdgeIds.has("b-merge"), false);
  assert.equal(merge.focusNodeIds.has("tail"), true);
}

function testLoopBackEdgeFocusDoesNotExpand() {
  const loop = computeEdgeSelectionFocus(
    "tail-decision-loop",
    graph.nodes,
    graph.edges,
  );
  assert.deepEqual(loop.focusNodeIds, new Set(["tail", "decision"]));
  assert.deepEqual(loop.focusEdgeIds, new Set(["tail-decision-loop"]));
  assert.equal(loop.originEdgeId, "tail-decision-loop");
}

function testBranchAnchorContext() {
  const state = new GraphState(graph);
  state.select({ type: "node", id: "branch-a" });

  state.select(
    { type: "node", id: "decision" },
    { preserveFocusAnchor: true },
  );
  let focus = state.getVisibleGraph().selectionFocus;
  assert.equal(focus.anchorNodeId, "branch-a");
  assert.equal(focus.originNodeId, "decision");
  assert.equal(focus.focusNodeIds.has("branch-b"), false);
  assert.equal(focus.focusEdgeIds.has("decision-b"), false);
  assert.equal(focus.focusEdgeIds.has("root-tail-cross"), false);

  state.select(
    { type: "node", id: "root" },
    { preserveFocusAnchor: true },
  );
  focus = state.getVisibleGraph().selectionFocus;
  assert.equal(focus.anchorNodeId, "branch-a");
  assert.equal(focus.focusNodeIds.has("branch-b"), false);
  assert.equal(focus.focusEdgeIds.has("decision-b"), false);

  state.select({ type: "node", id: "branch-b" });
  focus = state.getVisibleGraph().selectionFocus;
  assert.equal(focus.anchorNodeId, "root");
  assert.equal(focus.focusNodeIds.has("branch-a"), false);
  assert.equal(focus.focusEdgeIds.has("decision-a"), false);
  assert.equal(focus.focusNodeIds.has("branch-b"), true);
}

function testSiblingSelectionReplacesPreviousHighlight() {
  const siblingGraph = {
    root: "A",
    nodes: ["A", "B", "C", "D"].map((id) => ({
      id,
      state: "expanded",
    })),
    edges: [
      { id: "A-B", from: "A", to: "B", kind: "direct", flowKind: "branch" },
      { id: "A-C", from: "A", to: "C", kind: "direct", flowKind: "branch" },
      { id: "C-D", from: "C", to: "D", kind: "direct", flowKind: "normal" },
    ],
  };
  const state = new GraphState(siblingGraph);
  state.setSelectedNodes(["D"]);
  state.select({ type: "node", id: "D" });
  state.select({ type: "node", id: "B" });

  const visible = state.getVisibleGraph();
  assert.deepEqual(visible.selectionFocus.focusNodeIds, new Set(["A", "B"]));
  assert.equal(
    state.selectedNodeIds.has("D"),
    false,
    "a normal node selection must clear stale layout multi-selection",
  );
}

function testRunTurnKeepsTheCurrentIncomingBranch() {
  const endToEndGraph = readGraph(
    "overview",
    "codex-end-to-end-agent-loop.json",
  );
  const state = new GraphState(endToEndGraph);
  state.select({ type: "node", id: "e2e.turn-start-client" });
  state.select({ type: "node", id: "e2e.turn-steer-client" });
  let focus = state.getVisibleGraph().selectionFocus;
  assert.equal(focus.focusNodeIds.has("e2e.turn-start-client"), false);

  state.select({ type: "node", id: "e2e.run-turn" });
  focus = state.getVisibleGraph().selectionFocus;
  assert.equal(focus.anchorNodeId, "e2e.turn-steer-client");
  assert.equal(focus.focusNodeIds.has("e2e.turn-steer-client"), true);
  assert.equal(
    focus.focusNodeIds.has("e2e.turn-start-client"),
    false,
    "selecting run_turn must not reopen the inactive turn_start entry branch",
  );
}

function testRealTurnLoopDoesNotExpandThroughNextIteration() {
  const turnGraph = readGraph("session", "codex-turn-lifecycle.json");
  const loopEdge = turnGraph.edges.find(
    (edge) => edge.id === "turn.drain-back-to-loop",
  );
  assert.equal(loopEdge.flowKind, "loop-back");
  assert.equal(loopEdge.condition, "needs_follow_up");

  const state = new GraphState(turnGraph);
  state.select({ type: "node", id: "core.handle-output-item" });
  let focus = state.getVisibleGraph().selectionFocus;
  assert.equal(focus.focusNodeIds.has("core.model-client-stream"), false);
  assert.equal(focus.focusEdgeIds.has("turn.try-to-model-stream"), false);
  assert.equal(
    focus.focusEdgeIds.has("turn.drain-back-to-loop"),
    true,
    "loop-back remains visible when both endpoints are on the focused chain",
  );

  state.select(
    { type: "node", id: "core.try-sampling-request" },
    { preserveFocusAnchor: true },
  );
  focus = state.getVisibleGraph().selectionFocus;
  assert.equal(focus.anchorNodeId, "core.handle-output-item");
  assert.equal(focus.focusNodeIds.has("core.model-client-stream"), false);
  assert.equal(focus.focusEdgeIds.has("turn.try-to-model-stream"), false);

  state.select(
    { type: "node", id: "core.run-turn" },
    { preserveFocusAnchor: true },
  );
  focus = state.getVisibleGraph().selectionFocus;
  assert.equal(focus.anchorNodeId, "core.handle-output-item");
  assert.equal(focus.focusNodeIds.has("core.model-client-stream"), false);
  assert.equal(focus.focusEdgeIds.has("turn.try-to-model-stream"), false);

  const shellGraph = readGraph("tools", "codex-shell-tool-execution.json");
  const shellLoop = shellGraph.edges.find(
    (edge) => edge.id === "shell.drain-to-turn",
  );
  assert.equal(shellLoop.flowKind, "loop-back");
  assert.equal(shellLoop.condition, "needs_follow_up");
}

function readGraph(category, file) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "graphs", category, file), "utf8"),
  );
}

function fixtureGraph() {
  const nodes = [
    "root",
    "decision",
    "branch-a",
    "branch-b",
    "merge",
    "tail",
    "foreign",
  ].map((id) => ({ id, state: "expanded" }));
  const edge = (id, from, to, flowKind = "normal") => ({
    id,
    from,
    to,
    kind: "direct",
    flowKind,
  });
  return {
    root: "root",
    nodes,
    edges: [
      edge("root-decision", "root", "decision"),
      edge("decision-a", "decision", "branch-a", "branch"),
      edge("decision-b", "decision", "branch-b", "fallback"),
      edge("a-merge", "branch-a", "merge", "merge"),
      edge("b-merge", "branch-b", "merge", "merge"),
      edge("merge-tail", "merge", "tail"),
      edge("tail-decision-loop", "tail", "decision", "loop-back"),
      edge("foreign-root-loop", "foreign", "root", "loop-back"),
      edge("root-tail-cross", "root", "tail"),
    ],
  };
}
