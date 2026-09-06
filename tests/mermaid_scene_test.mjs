import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { parseMermaid, compileMermaidScene } from "../frontend/scenes/mermaid.mjs";
import { renderScene } from "../frontend/scenes/render.mjs";
import { walkBlocks } from "../frontend/scenes/validate.mjs";
import { buildScenes, loadScenes } from "../scripts/build_scenes.mjs";

const root = resolve(import.meta.dirname, "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const schema = await readJson("schema/sequence-scene.schema.json");
const metadataSchema = await readJson("schema/mermaid-scene.schema.json");
const metadata = await readJson("scenes/codex-message-roundtrip.json");
delete metadata.participantRoles;
const source = `sequenceDiagram
    participant client as 客户端
    participant server as 服务端
    client->>server: 提交请求
    par 请求回复
        server-->>client: 已接收
    and 执行任务
        loop 仍有工作
            alt 需要工具
                server-)worker: 派发任务
                worker-->>server: 工具结果
            else 无需工具
                opt 更新状态
                    server->>server: 写入历史
                end
            end
        end
    end
    Note over client,server: 完成#59; 核对<br/>证据#35;1
`;
const msg = (from, to, kind, label) => ({ type: "message", from, to, kind, label });
const expected = {
  participants: [{ id: "client", label: "客户端" }, { id: "server", label: "服务端" }, { id: "worker", label: "worker" }],
  body: [msg("client", "server", "call", "提交请求"),
    { type: "par", branches: [
      { condition: "请求回复", body: [msg("server", "client", "return", "已接收")] },
      { condition: "执行任务", body: [{ type: "loop", condition: "仍有工作", body: [
        { type: "alt", branches: [
          { condition: "需要工具", body: [msg("server", "worker", "async", "派发任务"), msg("worker", "server", "return", "工具结果")] },
          { condition: "无需工具", body: [{ type: "opt", condition: "更新状态", body: [msg("server", "server", "call", "写入历史")] }] },
        ] },
      ] }] },
    ] },
    { type: "note", over: ["client", "server"], text: "完成; 核对\n证据#1" },
  ],
};
assert.deepEqual(parseMermaid(source), expected, "preserve nested control flow, ordering, async dispatch and return");
assert.deepEqual(parseMermaid(`\uFEFF%% comment\r\n${source.replace(/\n/g, "\r\n")}`), expected);
const compiled = compileMermaidScene(metadata, source, schema, metadataSchema, "fixture.mmd");
assert.equal(compileMermaidScene({ ...metadata, theme: "aether" }, source, schema, metadataSchema).theme, "aether");
assert.throws(() => compileMermaidScene({ ...metadata, theme: "unknown" }, source, schema, metadataSchema), /editorial/);
assert.equal(renderScene(compiled, "fixture"), renderScene({ ...metadata, ...expected }, "fixture"));
const before = structuredClone(metadata);
compileMermaidScene(metadata, source, schema, metadataSchema);
assert.deepEqual(metadata, before);
assert.equal(parseMermaid("sequenceDiagram\nA->>B: hello\nparticipant B as 后端").participants[1].label, "后端");

for (const [text, pattern] of [
  ["flowchart TD", /bad.mmd:1:.*sequenceDiagram/],
  ["sequenceDiagram\n%%{init: {}}", /bad.mmd:2:.*配置/],
  ["sequenceDiagram\nA->>+B: activate", /bad.mmd:2:.*不支持/],
  ["sequenceDiagram\nA--)B: dashed async", /bad.mmd:2:.*不支持/],
  ["sequenceDiagram\nA->>B: first; B-->>A: second", /bad.mmd:2:.*每行/],
  ["sequenceDiagram\nparticipant A\nparticipant A", /bad.mmd:3:.*重复/],
  ["sequenceDiagram\nNote over missing: note", /bad.mmd:2:.*尚未出现/],
  ["sequenceDiagram\nloop pending\nA->>B: run", /bad.mmd:2:.*未闭合/],
  ["sequenceDiagram\nend", /bad.mmd:2:.*多余/],
  ["sequenceDiagram\nopt condition\nend", /bad.mmd:3:.*不能为空/],
  ["sequenceDiagram\nopt condition\nA->>B: run\nelse other", /bad.mmd:4:.*对应的 alt/],
  ["sequenceDiagram\nalt condition\nA->>B: run\nend", /bad.mmd:4:.*至少两个/],
  ["sequenceDiagram\nA->>B: #1114112;", /bad.mmd:2:.*字符实体/],
  ["sequenceDiagram\nA->>B:", /bad.mmd:2:.*不能为空/],
]) assert.throws(() => parseMermaid(text, "bad.mmd"), pattern);
assert.throws(() => compileMermaidScene({ ...metadata, body: [] }, source, schema, metadataSchema), /未知字段 body/);
assert.throws(() => compileMermaidScene({ ...metadata, participantRoles: [{ id: "missing", role: "x" }] }, source, schema, metadataSchema), /不存在的参与者/);
assert.throws(() => compileMermaidScene({ ...metadata, participantRoles: [{ id: "client", role: "x" }, { id: "client", role: "y" }] }, source, schema, metadataSchema), /重复 ID/);
const hostile = compileMermaidScene(metadata, 'sequenceDiagram\nA->>B: <script>alert(1)</script> #quot; #amp; #lt;', schema, metadataSchema);
const safeHtml = renderScene(hostile, "hostile");
assert.ok(!safeHtml.includes("<script>"));
assert.ok(safeHtml.includes("&lt;script&gt;"));

// Content grows with the flow; no fixed participant/message/branch count is imposed.
const large = parseMermaid("sequenceDiagram\n" + Array.from({ length: 100 }, (_, i) => `p${i}-)p${i + 1}: step ${i}`).join("\n"));
assert.equal(large.body.length, 100);
assert.equal(large.participants.length, 101);
const scenes = await loadScenes();
const blocks = scenes.filter(({ slug }) => ["codex-message-roundtrip", "codex-agent-turn"].includes(slug))
  .flatMap(({ scene }) => [...walkBlocks(scene.body)]);
assert.equal(blocks.filter((b) => b.type === "message").length, 26, "curated migration retains every message");
assert.equal(blocks.filter((b) => b.type === "note").length, 9);

const temp = await mkdtemp(resolve(tmpdir(), "callgraph-mermaid-test-"));
try {
  const sourceDir = resolve(temp, "input"), outputDir = resolve(temp, "output");
  await mkdir(sourceDir);
  await writeFile(resolve(sourceDir, "fixture.json"), JSON.stringify(metadata));
  await writeFile(resolve(sourceDir, "fixture.mmd"), source);
  await writeFile(resolve(sourceDir, "legacy.json"), JSON.stringify(compiled));
  assert.equal(await buildScenes({ sourceDir, outputDir }), 2, "Mermaid and legacy JSON coexist");
  const html = await readFile(resolve(outputDir, "fixture.html"), "utf8");
  await writeFile(resolve(sourceDir, "fixture.mmd"), source + "break unsupported\n");
  await assert.rejects(buildScenes({ sourceDir, outputDir }), /fixture.mmd:.*不支持/);
  assert.equal(await readFile(resolve(outputDir, "fixture.html"), "utf8"), html, "syntax failure preserves readable output");
  await writeFile(resolve(sourceDir, "fixture.mmd"), source);
  await buildScenes({ sourceDir, outputDir, check: true });
  await writeFile(resolve(sourceDir, "orphan.mmd"), source);
  await assert.rejects(buildScenes({ sourceDir, outputDir }), /orphan.mmd:.*缺少/);
} finally {
  assert.equal(dirname(temp), resolve(tmpdir()));
  assert.ok(basename(temp).startsWith("callgraph-mermaid-test-"));
  await rm(temp, { recursive: true });
}
console.log("Mermaid scenes: control-flow fidelity, strict diagnostics, escaping, migration, JSON compatibility and failure preservation passed");
