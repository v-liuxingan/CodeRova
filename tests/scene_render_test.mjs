import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { validateScene, walkBlocks } from "../frontend/scenes/validate.mjs";
import { renderScene, wrapText, GENERATED_MARKER } from "../frontend/scenes/render.mjs";
import { buildScenes } from "../scripts/build_scenes.mjs";
import { compileMermaidScene } from "../frontend/scenes/mermaid.mjs";

const root = resolve(import.meta.dirname, "..");
const schema = JSON.parse(await readFile(resolve(root, "schema/sequence-scene.schema.json"), "utf8"));
const base = { ...JSON.parse(await readFile(resolve(root, "tests/fixtures/scene-metadata.json"), "utf8")),
  participants: [{id:"solo",label:"Fixture"}],
  body: [{type:"message",from:"solo",to:"solo",kind:"call",label:"Request",evidence:["e1"]}] };
const message = (from = "solo", to = from) => ({ type: "message", from, to, kind: "call", label: "执行操作" });

function fixtures() {
  const solo = structuredClone(base);
  solo.title = "单参与者与长文本";
  solo.participants = [{ id: "solo", label: "一个很长的参与者职责名称需要自动换行", role: "self-call" }];
  solo.body = [{ ...message(), kind: "return", label: "very_long_unbroken_identifier_".repeat(10) + "中文👩‍💻" },
    { type: "note", over: ["solo"], text: "<script>alert('unsafe')</script> & 引号\"必须作为文本显示" }];
  const dense = structuredClone(base);
  dense.title = "多参与者、分支和消息没有固定数量上限";
  dense.participants = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, label: `参与者 ${i}` }));
  dense.body = Array.from({ length: 48 }, (_, i) => ({
    ...message(`p${i % 12}`, `p${(i + 1) % 12}`), kind: ["call", "async", "return"][i % 3],
    label: `${i} · ${"请求与结果需要保留完整说明".repeat(3)}`, evidence: ["e1"],
  }));
  dense.body.push({ type: "alt", branches: Array.from({ length: 8 }, (_, i) => ({
    condition: `条件 ${i}：${"完整条件说明".repeat(25)}`,
    body: [{ ...message("p11", "p11"), label: `末列自调用 ${i}` }],
  })) });
  const nested = structuredClone(solo);
  nested.title = "深层条件与并发分区";
  nested.body = [message()];
  for (let i = 0; i < 10; i++) nested.body = [{ type: "opt", condition: `嵌套条件 ${i}`, body: nested.body }];
  nested.body = [{ type: "par", branches: [
    { condition: "分区一；不宣称先完成", body: nested.body },
    { condition: "分区二；可交错执行", body: [{ type: "loop", condition: "有待处理输入", body: [message()] }] },
  ] }];
  const themed = Object.fromEntries(["editorial", "halo", "aether", "signal"].map((theme) =>
    [`theme-${theme}`, { ...structuredClone(base), theme }]));
  const flat = { ...structuredClone(base),
    participants: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, label: `角色 ${i}` })),
    body: [message("p0", "p3")],
  };
  return { solo, dense, nested, flat, ...themed };
}

if (process.argv.includes("--fixtures")) {
  console.log(JSON.stringify(Object.entries(fixtures()).map(([slug, scene]) => ({
    slug, theme: scene.theme || "editorial", html: renderScene(validateScene(scene, schema), slug),
    messages: [...walkBlocks(scene.body)].filter((b) => b.type === "message").length,
    fragments: [...walkBlocks(scene.body)].filter((b) => !["message", "note"].includes(b.type)).length,
  }))));
} else {
  const authoring = await readFile(resolve(root, "docs/scenario-authoring.md"), "utf8");
  compileMermaidScene(JSON.parse(authoring.match(/```json\r?\n([\s\S]*?)\r?\n```/)[1]),
    authoring.match(/```mermaid\r?\n([\s\S]*?)\r?\n```/)[1], schema,
    JSON.parse(await readFile(resolve(root, "schema/mermaid-scene.schema.json"), "utf8")), "document-example.mmd");
  for (const [slug, scene] of Object.entries(fixtures())) {
    const before = structuredClone(scene);
    validateScene(scene, schema);
    const html = renderScene(scene, slug);
    assert.equal(renderScene(scene, slug), html, "layout is deterministic");
    assert.deepEqual(scene, before, "validation and rendering do not mutate input");
    assert.equal((html.match(/class="exchange"/g) || []).length,
      [...walkBlocks(scene.body)].filter((block) => block.type === "message").length);
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes(" style="));
  }
  const long = "unbroken_identifier中文👩‍💻".repeat(20);
  assert.equal(wrapText(long, 120).join(""), long);
  const rejects = (mutate, pattern) => {
    const scene = structuredClone(base); mutate(scene);
    assert.throws(() => validateScene(scene, schema), pattern);
  };
  rejects((s) => { s.coordinates = []; }, /未知字段 coordinates/);
  rejects((s) => { s.theme = "unknown"; }, /editorial/);
  rejects((s) => { s.participants.push(s.participants[0]); }, /重复 ID/);
  rejects((s) => { s.body = [message("missing")]; }, /不存在的参与者/);
  rejects((s) => { s.body = [{ type: "note", text: "note", over: ["missing"] }]; }, /不存在的参与者/);
  rejects((s) => { s.body[0].evidence = ["missing"]; }, /不存在的源码依据/);
  rejects((s) => { s.body = [{ type: "alt", branches: [{ condition: "x", body: [message()] }] }]; }, /至少需要 2/);
  rejects((s) => { s.body = [{ type: "loop", body: [message()] }]; }, /缺少 condition/);
  rejects((s) => { s.body = [{ type: "html", text: "raw" }]; }, /未知步骤类型/);
  rejects((s) => { s.evidence[0].locations[0].file = "../secret"; }, /相对路径/);
  rejects((s) => { s.evidence[0].locations[0].endLine = 1; }, /起止范围/);
  rejects((s) => { s.callgraph = "javascript:alert(1)"; }, /标识符/);
  const temp = await mkdtemp(resolve(tmpdir(), "callgraph-scene-build-test-"));
  try {
    const sourceDir = resolve(temp, "input"), outputDir = resolve(temp, "output");
    await mkdir(sourceDir);
    await writeFile(resolve(sourceDir, "test.json"), JSON.stringify(base));
    await buildScenes({ sourceDir, outputDir });
    const html = await readFile(resolve(outputDir, "test.html"), "utf8");
    const manifest = await readFile(resolve(outputDir, "catalog.json"), "utf8");
    assert.deepEqual(JSON.parse(manifest).scenes, [{ slug: "test", projectId: base.project.id || null,
      projectLabel: base.project.label, title: base.title, summary: base.summary, callgraph: base.callgraph || null }]);
    await writeFile(resolve(outputDir, "catalog.json"), JSON.stringify({ scenes: [] }));
    await assert.rejects(buildScenes({ sourceDir, outputDir }), /不会覆盖手写内容/);
    assert.equal(await readFile(resolve(outputDir, "test.html"), "utf8"), html);
    await writeFile(resolve(outputDir, "catalog.json"), manifest);
    await writeFile(resolve(outputDir, "catalog.json"), manifest.replace(base.title, "stale title"));
    await assert.rejects(buildScenes({ sourceDir, outputDir, check: true }), /未同步/);
    await buildScenes({ sourceDir, outputDir });
    await buildScenes({ sourceDir, outputDir, check: true });
    await writeFile(resolve(sourceDir, "invalid.json"), "{");
    await assert.rejects(buildScenes({ sourceDir, outputDir }), /invalid.json/);
    assert.equal(await readFile(resolve(outputDir, "test.html"), "utf8"), html);
    // Invalid data never replaces a previously readable page.
    await rm(resolve(sourceDir, "invalid.json"));
    await writeFile(resolve(outputDir, "test.html"), html + "stale");
    await assert.rejects(buildScenes({ sourceDir, outputDir, check: true }), /未同步/);
    await buildScenes({ sourceDir, outputDir });
    await writeFile(resolve(outputDir, "test.html"), html.replace(/\n/g, "\r\n"));
    await buildScenes({ sourceDir, outputDir, check: true });
    // A collision anywhere in the batch must preserve every existing output.
    const catalog = await readFile(resolve(outputDir, "index.html"), "utf8");
    for (const collision of ["test.html", "index.html"]) {
      await writeFile(resolve(outputDir, collision), "handwritten content");
      await assert.rejects(buildScenes({ sourceDir, outputDir }), /不会覆盖手写内容/);
      assert.equal(await readFile(resolve(outputDir, collision), "utf8"), "handwritten content");
      const other = collision === "test.html" ? "index.html" : "test.html";
      assert.equal((await readFile(resolve(outputDir, other), "utf8")).replace(/\r\n/g, "\n"),
        other === "index.html" ? catalog : html);
      await writeFile(resolve(outputDir, collision), collision === "index.html" ? catalog : html);
    }
    await writeFile(resolve(outputDir, "manual.html"), "handwritten page");
    await writeFile(resolve(outputDir, "old-generated.html"), html.replace(GENERATED_MARKER,
      "<!-- Generated by build:scenes; edit scenes/*.json instead. -->"));
    await rm(resolve(sourceDir, "test.json"));
    await assert.rejects(buildScenes({ sourceDir, outputDir, check: true }), /未同步/);
    await buildScenes({ sourceDir, outputDir });
    assert.deepEqual((await readdir(outputDir)).sort(), ["catalog.json", "index.html", "manual.html"]);
    assert.deepEqual(JSON.parse(await readFile(resolve(outputDir, "catalog.json"), "utf8")).scenes, []);
  } finally {
    assert.equal(dirname(temp), resolve(tmpdir()));
    assert.ok(basename(temp).startsWith("callgraph-scene-build-test-"));
    await rm(temp, { recursive: true });
  }
  await buildScenes({ check: true });
  console.log("Scene data: validation, escaping, lossless layout, scale, nesting, deterministic build and stale output checks passed");
}
