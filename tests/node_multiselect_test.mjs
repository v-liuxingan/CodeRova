import assert from "node:assert/strict";
import { GraphState } from "../public/js/graph-state.js";
import {
  nodeIdsWithinRectangle,
  normalizeScreenRectangle,
} from "../public/js/marquee-selection.js";

testRectangleSelectionInEveryDirection();
testIndependentSelectionState();
testBatchPositionsNotifyOnce();
testHiddenNodesLeaveLayoutSelection();
console.log("Node multiselect: all assertions passed");

function testRectangleSelectionInEveryDirection() {
  const nodes = [
    { id: "inside-a", centerX: 20, centerY: 25 },
    { id: "inside-b", centerX: 80, centerY: 70 },
    { id: "outside", centerX: 110, centerY: 50 },
  ];
  const forward = normalizeScreenRectangle(
    { x: 10, y: 10 },
    { x: 90, y: 90 },
  );
  const reverse = normalizeScreenRectangle(
    { x: 90, y: 90 },
    { x: 10, y: 10 },
  );
  assert.deepEqual(forward, reverse);
  assert.deepEqual(
    nodeIdsWithinRectangle(forward, nodes),
    new Set(["inside-a", "inside-b"]),
  );
}

function testIndependentSelectionState() {
  const state = new GraphState(fixtureGraph());
  state.select({ type: "node", id: "root" });
  state.setSelectedNodes(new Set(["left", "right", "missing"]));
  assert.deepEqual(state.selected, { type: "node", id: "root" });
  assert.deepEqual(state.selectedNodeIds, new Set(["left", "right"]));

  state.toggleSelectedNode("left");
  assert.deepEqual(state.selectedNodeIds, new Set(["right"]));
  state.toggleSelectedNode("left");
  assert.deepEqual(state.selectedNodeIds, new Set(["right", "left"]));
  const reasons = [];
  state.subscribe((_state, reason) => reasons.push(reason));
  state.clearInteractionSelection();
  assert.equal(state.selectedNodeIds.size, 0);
  assert.equal(state.selected, null);
  assert.deepEqual(reasons, ["selection"]);
}

function testBatchPositionsNotifyOnce() {
  const state = new GraphState(fixtureGraph());
  const reasons = [];
  state.subscribe((_state, reason) => reasons.push(reason));
  state.setNodePositions({
    left: { x: 10.26, y: -4.44 },
    right: { x: 30, y: 40 },
    missing: { x: 99, y: 99 },
  });
  assert.deepEqual(reasons, ["position"]);
  assert.deepEqual(state.getNodePositions(), {
    left: { x: 10.3, y: -4.4 },
    right: { x: 30, y: 40 },
  });
}

function testHiddenNodesLeaveLayoutSelection() {
  const state = new GraphState(fixtureGraph());
  state.setSelectedNodes(["left", "right"]);
  state.toggleCollapse("root");
  state.getVisibleGraph();
  assert.equal(state.selectedNodeIds.size, 0);
}

function fixtureGraph() {
  return {
    root: "root",
    nodes: ["root", "left", "right"].map((id) => ({
      id,
      state: "expanded",
    })),
    edges: [
      { id: "root-left", from: "root", to: "left", kind: "direct" },
      { id: "root-right", from: "root", to: "right", kind: "direct" },
    ],
  };
}
