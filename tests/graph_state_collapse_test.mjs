import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GraphState,
  exclusiveForwardControlDescendants,
} from "../public/js/graph-state.js";
import {
  hasCollapsibleChildren,
} from "../public/js/renderers/svg-renderer.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

testBranchMergeBoundary();
testInternalMultipleParents();
testNonControlAndLoopBackEdges();
testMultipleCollapsedRoots();
testGraphStateSelectionAndFilterBoundary();
testRealAgentLoopRegression();
testCollapseControlAvailability();
console.log("GraphState collapse: all assertions passed");

function testBranchMergeBoundary() {
  const graph = fixtureGraph();
  const hidden = collapse(graph, ["branch-a"]);
  assert.deepEqual(hidden, new Set(["private-a"]));
  assert.equal(hidden.has("merge"), false, "shared merge remains visible");
  assert.equal(hidden.has("tail"), false, "propagation stops at shared merge");
}

function testInternalMultipleParents() {
  const graph = graphOf(
    ["root", "left", "right", "join", "tail"],
    [
      edge("root-left", "root", "left"),
      edge("root-right", "root", "right"),
      edge("left-join", "left", "join"),
      edge("right-join", "right", "join"),
      edge("join-tail", "join", "tail"),
    ],
  );
  assert.deepEqual(
    collapse(graph, ["root"]),
    new Set(["left", "right", "join", "tail"]),
  );
}

function testNonControlAndLoopBackEdges() {
  const graph = graphOf(
    ["root", "child", "data-only", "upstream"],
    [
      edge("root-child", "root", "child"),
      edge("child-data", "child", "data-only", {
        kind: "data-flow",
      }),
      edge("child-upstream-loop", "child", "upstream", {
        flowKind: "loop-back",
      }),
    ],
  );
  assert.deepEqual(collapse(graph, ["root"]), new Set(["child"]));
}

function testMultipleCollapsedRoots() {
  const graph = fixtureGraph();
  assert.deepEqual(
    collapse(graph, ["branch-a", "branch-b"]),
    new Set(["private-a", "merge", "tail"]),
  );
}

function testGraphStateSelectionAndFilterBoundary() {
  const graph = fixtureGraph();
  const state = new GraphState(graph);
  state.select({ type: "node", id: "private-a" });
  state.toggleKind("callback");
  state.toggleCollapse("branch-a");
  const collapsed = state.getVisibleGraph();

  assert.equal(state.selected, null, "selection clears when collapse hides it");
  assert.equal(state.selectionFocusNodeId, null);
  assert.equal(
    collapsed.nodes.some((node) => node.id === "branch-a"),
    true,
    "collapse root remains visible",
  );
  assert.equal(
    collapsed.nodes.some((node) => node.id === "merge"),
    true,
    "disabled edge kinds do not change structural ownership",
  );

  state.toggleCollapse("branch-a");
  assert.equal(state.getVisibleGraph().nodes.length, graph.nodes.length);

  const anchoredState = new GraphState(graph);
  anchoredState.select({ type: "node", id: "private-a" });
  anchoredState.select({ type: "node", id: "branch-a" });
  anchoredState.toggleCollapse("branch-a");
  const anchoredFocus = anchoredState.getVisibleGraph().selectionFocus;
  assert.deepEqual(anchoredState.selected, { type: "node", id: "branch-a" });
  assert.equal(anchoredFocus.anchorNodeId, "branch-a");
  assert.equal(anchoredFocus.active, true);
}

function testRealAgentLoopRegression() {
  const graph = JSON.parse(
    fs.readFileSync(
      path.join(
        ROOT,
        "graphs",
        "overview",
        "codex-end-to-end-agent-loop.json",
      ),
      "utf8",
    ),
  );
  const hidden = collapse(graph, ["e2e.http-stream"]);
  assert.equal(hidden.has("e2e.responses-http"), true);
  assert.equal(hidden.has("e2e.handle-output"), false);
  assert.equal(hidden.has("e2e.websocket-stream"), false);
  assert.equal(hidden.has("e2e.model-stream"), false);
}

function testCollapseControlAvailability() {
  const edges = [
    edge("data-only", "data-parent", "data-child", { kind: "data-flow" }),
    edge("loop-only", "loop-parent", "loop-child", { flowKind: "loop-back" }),
    edge("control", "control-parent", "control-child"),
  ];
  assert.equal(hasCollapsibleChildren("data-parent", edges), false);
  assert.equal(hasCollapsibleChildren("loop-parent", edges), false);
  assert.equal(hasCollapsibleChildren("control-parent", edges), true);
}

function fixtureGraph() {
  return graphOf(
    ["decision", "branch-a", "private-a", "branch-b", "merge", "tail"],
    [
      edge("decision-a", "decision", "branch-a"),
      edge("decision-b", "decision", "branch-b"),
      edge("a-private", "branch-a", "private-a"),
      edge("private-merge", "private-a", "merge"),
      edge("b-merge", "branch-b", "merge", { kind: "callback" }),
      edge("merge-tail", "merge", "tail"),
    ],
  );
}

function graphOf(nodeIds, edges) {
  return {
    root: nodeIds[0],
    nodes: nodeIds.map((id) => ({ id, state: "expanded" })),
    edges,
  };
}

function edge(id, from, to, options = {}) {
  return {
    id,
    from,
    to,
    kind: "direct",
    flowKind: "normal",
    ...options,
  };
}

function collapse(graph, roots) {
  return exclusiveForwardControlDescendants(
    new Set(roots),
    graph.nodes,
    graph.edges,
  );
}
