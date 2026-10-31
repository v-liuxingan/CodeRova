import assert from "node:assert/strict";
import { selectProject, validateSceneCatalog } from "../public/js/project-navigation.js";
const projects = [{ id: "a" }, { id: "b" }, { id: "empty" }];
const graphs = [{ slug: "one", projectId: "a" }, { slug: "two", projectId: "b" }];
const select = (query, saved) => selectProject(projects, graphs, new URLSearchParams(query), saved);
assert.equal(select("graph=two&project=a", "a"), "b");
assert.equal(select("project=empty", "a"), "empty");
assert.equal(select("", "b"), "a", "legacy preference does not determine project context");
assert.equal(select("project=unknown", "missing"), "a");
assert.equal(select("graph=missing&project=b"), "b");
const item = { slug: "scene", projectId: "a", projectLabel: "A", title: "Scene", summary: "Summary", callgraph: "one" };
const catalog = (scenes) => ({ schemaVersion: "1.0", scenes });
assert.equal(validateSceneCatalog(catalog([item])).length, 1);
assert.throws(() => validateSceneCatalog(catalog([item, item])), /重复/);
for (const patch of [{ slug: "../outside" }, { projectId: undefined }, { callgraph: "javascript:alert(1)" }, { title: "" }]) {
  assert.throws(() => validateSceneCatalog(catalog([{ ...item, ...patch }])), /无效/);
}
console.log("Project navigation: URL context, ignored legacy preferences, empty projects and scene manifest validation passed");
