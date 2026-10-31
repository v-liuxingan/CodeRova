import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { NarrativeLayout } from "../public/js/layouts/narrative-layout.js";
import { routeEdges } from "../public/js/renderers/edge-router.js";
import { placeEdgeLabels } from "../public/js/renderers/edge-label-placer.js";

const root = new URL("../graphs/", import.meta.url);
let total = 0;
for (const file of readdirSync(root, { recursive: true }).filter((name) => name.endsWith(".json"))) {
  const graph = JSON.parse(readFileSync(new URL(file.replaceAll("\\", "/"), root)));
  for (const orientation of ["vertical", "horizontal"]) {
    const layout = routeEdges(new NarrativeLayout().compute(graph, orientation), orientation);
    const paths = layout.edges.map((entry) => entry.geometry.pathData);
    assert.equal(new Set(paths).size, paths.length, `${file}: distinct edge paths`);
    assertClear(layout);
    routeEdges(layout, orientation);
    assert.deepEqual(layout.edges.map((entry) => entry.geometry.pathData), paths, "stable routing");
    total += layout.edges.length;
  }
}

// Parallel calls, a long skip over a node, self-loop and return to caller.
const nodes = ["a", "b", "c"].map((id) => ({ id, label: id }));
const edges = [
  { id: "ab1", from: "a", to: "b" }, { id: "ab2", from: "a", to: "b" },
  { id: "bc", from: "b", to: "c" }, { id: "ac", from: "a", to: "c" },
  { id: "ca", from: "c", to: "a", flowKind: "loop-back" },
  { id: "bb", from: "b", to: "b", flowKind: "loop-back" },
].map((edge) => ({ kind: "direct", ...edge }));
for (const orientation of ["vertical", "horizontal"]) {
  const layout = routeEdges(new NarrativeLayout().compute({ root: "a", nodes, edges }, orientation), orientation);
  assertClear(layout);
  assert.equal(new Set(layout.edges.map((entry) => entry.geometry.pathData)).size, edges.length);
  const views = layout.edges.map((entry) => ({ entry, geometry: entry.geometry, labelWidth: 120, labelHeight: 32 }));
  const labels = placeEdgeLabels(views, orientation, layout.nodes.values());
  const boxes = [];
  for (const position of labels.values()) {
    const box = { x: position.x - 60, y: position.y - 16, width: 120, height: 32 };
    assert.ok([...layout.nodes.values(), ...boxes].every((node) => !overlap(box, node)), "label clearance");
    boxes.push(box);
  }
}
console.log(`Edge routing: ${total} real-graph routes clear nodes; parallel, loop and label cases passed`);

function overlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function assertClear(layout) {
  for (const entry of layout.edges) {
    const points = entry.geometry.points;
    assert.ok(points.length >= 2);
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1], b = points[i];
      assert.ok(a.x === b.x || a.y === b.y, "orthogonal segment");
      for (const node of layout.nodes.values()) {
        if (node === entry.from || node === entry.to) continue;
        const crosses = a.x === b.x
          ? a.x > node.x && a.x < node.x + node.width && Math.max(a.y, b.y) > node.y && Math.min(a.y, b.y) < node.y + node.height
          : a.y > node.y && a.y < node.y + node.height && Math.max(a.x, b.x) > node.x && Math.min(a.x, b.x) < node.x + node.width;
        assert.equal(crosses, false, `${entry.edge.id} crosses ${node.node.id}`);
      }
    }
  }
}
