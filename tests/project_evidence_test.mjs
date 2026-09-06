import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = resolve(root, "graphs/project");
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let anchors = 0;
for (const filename of readdirSync(directory).filter((name) => name.endsWith(".json"))) {
  const graph = JSON.parse(readFileSync(resolve(directory, filename), "utf8"));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const lines = (file) => readFileSync(resolve(root, file), "utf8").split(/\r?\n/);
  for (const node of graph.nodes) {
    const symbol = escapeRegex(node.label.split("::").at(-1));
    const source = lines(node.file);
    const declaration = node.file.endsWith(".rs")
      ? new RegExp(`^\\s*(?:pub )?(?:async )?fn ${symbol}(?:\\(|<)`)
      : new RegExp(`^\\s*(?:export )?(?:async )?(?:function )?${symbol}\\(`);
    assert.match(source[node.line - 1], declaration, `${filename}: ${node.id} definition moved`);
    assert.equal(source[node.endLine - 1].trim(), "}", `${filename}: ${node.id} range moved`);
    anchors += 1;
  }
  for (const edge of graph.edges.filter((edge) => edge.callSiteStatus === "exact")) {
    const callee = escapeRegex(nodes.get(edge.to).label.split("::").at(-1));
    assert.match(lines(edge.file)[edge.line - 1], new RegExp(`\\b${callee}\\(`),
      `${filename}: ${edge.id} no longer points at its callee`);
    anchors += 1;
  }
}
console.log(`Project evidence: ${anchors} definition and call-site anchors match source symbols`);
