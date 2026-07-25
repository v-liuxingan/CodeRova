import assert from "node:assert/strict";
import { TraceNavigator } from "../public/js/trace-navigator.js";

testExplicitCallOrderControlsBranchesAndNextStep();
testPhaseFocusResetsTraceToPhaseEntry();
console.log("TraceNavigator order: all assertions passed");

function testExplicitCallOrderControlsBranchesAndNextStep() {
  const graph = {
    root: "caller",
    nodes: ["caller", "first", "second", "unknown"].map((id) => ({
      id,
      label: id,
    })),
    edges: [
      edge("z-second", "second", 2, 30),
      edge("unsequenced", "unknown", null, 10),
      edge("a-first", "first", 1, 20),
    ],
  };
  const navigator = new TraceNavigator(graph);
  const snapshot = navigator.snapshot();

  assert.equal(snapshot.callEdge.id, "a-first");
  assert.equal(snapshot.nextNode.id, "first");
  assert.deepEqual(
    snapshot.branches.map(({ edge }) => edge.id),
    ["a-first", "z-second", "unsequenced"],
  );
  assert.deepEqual(navigator.next(), { type: "node", id: "first" });
}

function testPhaseFocusResetsTraceToPhaseEntry() {
  const graph = {
    root: "root",
    nodes: ["root", "phase-entry", "phase-child", "other"].map((id) => ({
      id,
      label: id,
    })),
    edges: [
      { id: "root-entry", from: "root", to: "phase-entry", kind: "direct" },
      { id: "entry-child", from: "phase-entry", to: "phase-child", kind: "direct" },
      { id: "root-other", from: "root", to: "other", kind: "direct" },
    ],
  };
  const navigator = new TraceNavigator(graph);
  navigator.syncSelection({ type: "node", id: "other" });
  assert.deepEqual(
    navigator.focusNodes(["phase-entry", "phase-child"]),
    { type: "node", id: "phase-entry" },
  );
  assert.equal(navigator.snapshot().currentNode.id, "phase-entry");
  assert.equal(navigator.snapshot().nextNode.id, "phase-child");
}

function edge(id, to, order, line) {
  return {
    id,
    from: "caller",
    to,
    kind: "direct",
    file: "src/lib.rs",
    line,
    ...(order ? { order } : {}),
  };
}
