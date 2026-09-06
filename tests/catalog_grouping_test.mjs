import assert from "node:assert/strict";
import {
  DEFAULT_CATEGORY,
  DEFAULT_CATEGORY_ID,
  GRAPH_CATEGORY_PRIORITY,
  groupGraphCatalog,
} from "../public/js/catalog-grouping.js";

testKnownPriorityAndFallback();
testCustomCategoryFirstAppearance();
console.log("Catalog grouping: all assertions passed");

function testKnownPriorityAndFallback() {
  const graphs = [
    graph("tool", "让 Codex 操作项目"),
    graph("blank", "  "),
    graph("overview", "先看这里"),
    graph("missing"),
    graph("session", "提交与继续任务"),
    graph("context", "设置与长对话"),
  ];
  const groups = groupGraphCatalog(graphs);
  assert.deepEqual(
    groups.map((group) => group.category),
    [...GRAPH_CATEGORY_PRIORITY, DEFAULT_CATEGORY],
  );
  assert.equal(groups.at(-1).categoryId, DEFAULT_CATEGORY_ID);
  assert.deepEqual(
    groups.at(-1).graphs.map((item) => item.slug),
    ["blank", "missing"],
  );
  assert.equal(groups[0].graphs[0].slug, "overview");
  assert.equal(
    groups.flatMap((group) => group.graphs).length,
    graphs.length,
  );
}

function testCustomCategoryFirstAppearance() {
  const groups = groupGraphCatalog([
    graph("custom-z", "自定义乙"),
    graph("other", "其他"),
    graph("known", "让 Codex 操作项目"),
    graph("custom-a", "自定义甲"),
    graph("custom-z-2", "自定义乙"),
  ]);
  assert.deepEqual(
    groups.map((group) => group.category),
    ["让 Codex 操作项目", "自定义乙", "其他", "自定义甲"],
  );
  assert.deepEqual(
    groups[1].graphs.map((item) => item.slug),
    ["custom-z", "custom-z-2"],
  );
}

function graph(slug, category) {
  const categoryIds = {
    "先看这里": "overview",
    "提交与继续任务": "session",
    "让 Codex 操作项目": "tools",
    "设置与长对话": "context",
    "其他": "other",
    "自定义乙": "custom-z",
    "自定义甲": "custom-a",
  };
  return { slug, category, categoryId: categoryIds[category] };
}
