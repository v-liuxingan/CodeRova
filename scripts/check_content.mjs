import { readFile, readdir, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { loadSceneFile, buildScenes } from "./build_scenes.mjs";
import { renderScene } from "../frontend/scenes/render.mjs";
import { walkBlocks } from "../frontend/scenes/validate.mjs";
import { digest, readEvidence, sceneReferences, graphReferences } from "./content/evidence.mjs";

const ROOT = resolve(import.meta.dirname, "..");
async function filesIn(dir, recursive = false) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile()) result.push(resolve(dir, entry.name));
    else if (recursive && entry.isDirectory()) result.push(...await filesIn(resolve(dir, entry.name), true));
  }
  return result;
}
export function validateGraph(file, config) {
  const result = spawnSync("cargo", ["run", "--quiet", "--", "validate", file, "--config", config, "--json"],
    { cwd: ROOT, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  try { return JSON.parse(result.stdout); } catch {
    throw new Error(result.stderr?.trim() || "Rust 校验器未返回 JSON");
  }
}

export async function checkContent({ root = ROOT, project, config = resolve(root, "callgraph.projects.json"), snapshot = false,
  graphValidator = validateGraph } = {}) {
  const diagnostics = [], records = Object.create(null), graphSlugs = new Map();
  const report = { valid: false, graphs: 0, scenes: 0, locations: 0, fingerprintMatches: 0, diagnostics };
  const add = (severity, code, file, field, message) => diagnostics.push({ severity, code, file, field, message });
  const configData = JSON.parse(await readFile(config, "utf8"));
  if (configData.schemaVersion !== "0.1" || !Array.isArray(configData.projects)) throw new Error("项目目录版本或 projects 无效");
  const projects = new Map();
  for (const item of configData.projects) {
    if (!/^[A-Za-z0-9_-]+$/.test(item.id) || projects.has(item.id) || typeof item.root !== "string" || !item.root.trim()) throw new Error("项目目录存在无效或重复 ID / root");
    projects.set(item.id, resolve(dirname(config), item.root));
  }
  if (project && !projects.has(project)) throw new Error(`项目目录没有 ${project}`);
  if (snapshot && !project) throw new Error("更新证据基线必须指定 --project，以限制复核范围");
  const baselines = new Map();
  async function evidence(file, id, references, inputDigest) {
    if (!id || !projects.has(id)) { add("warning", "project-unresolved", file, "project.id", "缺少可解析的项目 ID，未检查源码"); return; }
    if (!records[id]) records[id] = Object.create(null);
    if (!baselines.has(id)) {
      const path = resolve(root, "evidence/baselines", `${id}.json`);
      const baseline = await readFile(path, "utf8").then(JSON.parse).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (baseline && (baseline.schemaVersion !== "1.0" || baseline.projectId !== id || !baseline.records || typeof baseline.records !== "object" || Array.isArray(baseline.records))) throw new Error(`${path}: 无效证据基线`);
      baselines.set(id, baseline);
      if (!baseline && !snapshot) add("warning", "baseline-missing", file, "evidence", `${id} 尚未建立源码指纹基线；位置有效不代表内容正确`);
    }
    for (const reference of references) {
      const key = `${file}#${reference.key}`;
      try {
        const checked = await readEvidence(projects.get(id), reference.location);
        report.locations++;
        const record = { location: reference.location, ...checked, inputDigest };
        records[id][key] = record;
        if (reference.status === "inferred") add("warning", "inferred", file, reference.key, "此结论由作者标为推断，源码位置校验不能证明它");
        if (!snapshot && baselines.get(id)) {
          const previous = baselines.get(id).records[key];
          if (!previous) add("warning", "evidence-new", file, reference.key, "新依据尚未纳入人工复核后的基线");
          else if (JSON.stringify(previous) !== JSON.stringify(record)) add("error", "evidence-stale", file, reference.key,
            `${reference.location.file}:${checked.line} 引用源码、位置或图内容已变化；复核后再更新基线`);
          else report.fingerprintMatches++;
        }
      } catch (error) { add("error", "source-invalid", file, reference.key, error.message); }
    }
  }
  const graphFiles = (await filesIn(resolve(root, "graphs"), true)).filter((file) => file.endsWith(".json"));
  for (const file of graphFiles) {
    const display = relative(root, file).replaceAll("\\", "/");
    try {
      const graph = JSON.parse(await readFile(file, "utf8"));
      const slug = file.split(/[\\/]/).at(-1).slice(0, -5);
      if (graphSlugs.has(slug)) add("error", "duplicate-slug", display, "slug", `与 ${graphSlugs.get(slug)} 重复`);
      graphSlugs.set(slug, graph.projectId);
      if (project && graph.projectId !== project) continue;
      report.graphs++;
      const validation = await graphValidator(file, config);
      for (const error of validation.errors || []) add("error", "graph-invalid", display, "graph", error);
      for (const warning of validation.warnings || []) add("warning", "graph-warning", display, "graph", warning);
      if (validation.valid !== true) { if (!validation.errors?.length) add("error", "graph-invalid", display, "graph", "调用图校验未通过"); continue; }
      await evidence(display, graph.projectId, graphReferences(graph), digest(JSON.stringify(graph)));
    } catch (error) { add("error", "graph-invalid", display, "graph", error.message); }
  }
  const sceneFiles = await filesIn(resolve(root, "scenes"));
  for (const file of sceneFiles.filter((file) => file.endsWith(".mmd"))) {
    if (!sceneFiles.includes(file.slice(0, -4) + ".json")) add("error", "metadata-missing", relative(root, file), "", "缺少同名 JSON");
  }
  for (const file of sceneFiles.filter((file) => file.endsWith(".json"))) {
    const display = relative(root, file).replaceAll("\\", "/");
    try {
      const raw = JSON.parse(await readFile(file, "utf8"));
      if (project && raw.project?.id !== project) continue;
      report.scenes++;
      const { slug, scene } = await loadSceneFile(file);
      if (scene.callgraph && (!graphSlugs.has(scene.callgraph) || (scene.project.id && graphSlugs.get(scene.callgraph) !== scene.project.id))) {
        add("error", "link-invalid", display, "callgraph", "基础跳转必须引用同项目中存在的调用图");
      }
      const messages = [...walkBlocks(scene.body)].filter((block) => block.type === "message");
      const mapped = messages.filter((block) => block.evidence?.length).length;
      if (mapped < messages.length) add("info", "evidence-coverage", display, "body", `${mapped}/${messages.length} 条消息直接关联依据；其余需对照场景表，不强制全部标注`);
      await evidence(display, scene.project.id, sceneReferences(scene), digest(JSON.stringify(scene)));
      const output = resolve(root, "public/scenes", `${slug}.html`);
      const actual = await readFile(output, "utf8").catch((error) => { if (error.code === "ENOENT") return ""; throw error; });
      if (actual.replace(/\r\n/g, "\n") !== renderScene(scene, slug)) add("error", "output-stale", display, "output", "运行 npm run build:scenes 同步页面");
    } catch (error) { add("error", "scene-invalid", display, "scene", error.message); }
  }
  if (!project && !diagnostics.some((d) => d.code === "scene-invalid")) {
    try { await buildScenes({ sourceDir: resolve(root, "scenes"), outputDir: resolve(root, "public/scenes"), check: true }); }
    catch (error) { add("error", "output-stale", "public/scenes", "", error.message); }
  }
  if (!report.graphs && !report.scenes) add("error", "empty-selection", "", "", "没有符合范围的图或场景");
  if (snapshot && !report.locations) add("error", "empty-evidence", "", "", "没有有效源码位置，不能建立空基线");
  for (const [id, baseline] of baselines) {
    if (!snapshot) for (const key of Object.keys(baseline?.records || {})) {
      if (!Object.hasOwn(records[id], key)) add("warning", "evidence-removed", id, key, "旧基线中的依据已删除或未能读取，复核后更新");
    }
  }
  report.valid = !diagnostics.some((d) => d.severity === "error");
  if (snapshot && report.valid) {
    const dir = resolve(root, "evidence/baselines");
    await mkdir(dir, { recursive: true });
    const output = resolve(dir, `${project}.json`), temporary = `${output}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ schemaVersion: "1.0", projectId: project, records: records[project] || {} }, null, 2) + "\n");
    await rename(temporary, output);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  try {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--json") continue;
      if (arg === "--snapshot") options.snapshot = true;
      else if (["--project", "--config"].includes(arg) && args[i + 1] && !args[i + 1].startsWith("--")) options[arg.slice(2)] = arg === "--config" ? resolve(args[++i]) : args[++i];
      else throw new Error(`未知参数或缺少值：${arg}`);
    }
    const result = await checkContent(options);
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`内容检查：${result.graphs} 张调用图，${result.scenes} 张场景，${result.locations} 个源码位置，${result.fingerprintMatches} 个指纹匹配`);
      for (const d of result.diagnostics) console.log(`${d.severity} [${d.code}] ${d.file} ${d.field}: ${d.message}`);
      console.log(result.valid ? "检查通过（警告和人工复核边界见上）" : "检查失败");
    }
    process.exitCode = result.valid ? 0 : 1;
  } catch (error) {
    if (args.includes("--json")) console.log(JSON.stringify({ valid: false, diagnostics: [{ severity: "error", code: "check-failed", message: error.message }] }));
    else console.error(error.message);
    process.exitCode = 1;
  }
}
