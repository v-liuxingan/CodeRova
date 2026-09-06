export const GRAPH_CATEGORY_PRIORITY = [
  "先看这里",
  "提交与继续任务",
  "让 Codex 操作项目",
  "设置与长对话",
];

export const DEFAULT_CATEGORY_ID = "uncategorized";
export const DEFAULT_CATEGORY = "未分类";

export function groupGraphCatalog(graphs) {
  const groups = new Map();
  for (const graph of graphs) {
    const category = normalizeCategory(graph.category);
    const categoryId = normalizeCategoryId(graph.categoryId, category);
    if (!groups.has(categoryId)) {
      groups.set(categoryId, { categoryId, category, graphs: [] });
    }
    groups.get(categoryId).graphs.push({
      ...graph,
      categoryId,
      category,
    });
  }

  const values = [...groups.values()];
  const known = GRAPH_CATEGORY_PRIORITY.flatMap((category) =>
    values.filter((group) => group.category === category));
  const custom = values.filter((group) =>
    group.categoryId !== DEFAULT_CATEGORY_ID
    && !GRAPH_CATEGORY_PRIORITY.includes(group.category));
  const fallback = groups.has(DEFAULT_CATEGORY_ID)
    ? [groups.get(DEFAULT_CATEGORY_ID)]
    : [];
  return [...known, ...custom, ...fallback];
}

function normalizeCategory(category) {
  const normalized = String(category || "").trim();
  return normalized || DEFAULT_CATEGORY;
}

function normalizeCategoryId(categoryId, category) {
  const normalized = String(categoryId || "").trim();
  if (normalized) return normalized;
  return category === DEFAULT_CATEGORY
    ? DEFAULT_CATEGORY_ID
    : `legacy:${category}`;
}
