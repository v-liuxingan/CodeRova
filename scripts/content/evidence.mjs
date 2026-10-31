import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";

export const digest = (text) => createHash("sha256").update(text).digest("hex");
// A local build-time reader, never exposed through HTTP. Follow symlinks before checking bounds.
export async function readEvidence(root, location) {
  if (typeof location.file !== "string" || /^(?:[\\/]|[a-z]:)/i.test(location.file)
    || location.file.split(/[\\/]/).includes("..")) throw new Error("源码文件必须是项目内相对路径");
  const base = await realpath(root), file = await realpath(resolve(base, location.file));
  const rel = relative(base, file);
  if (!rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    throw new Error("源码路径或符号链接越过项目根目录");
  }
  const info = await stat(file);
  if (!info.isFile() || info.size > 4 * 1024 * 1024) throw new Error("源码应为不超过 4 MiB 的普通文本文件");
  const content = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(file)).replace(/\r\n/g, "\n");
  if (content.includes("\0")) throw new Error("源码包含二进制内容");
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const start = location.line ?? 1, end = location.endLine ?? location.line ?? lines.length;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > lines.length) {
    throw new Error(`源码范围无效：${start}–${end}（文件共 ${lines.length} 行）`);
  }
  const excerpt = lines.slice(start - 1, end).join("\n");
  if (location.anchor && !excerpt.includes(location.anchor)) throw new Error(`源码锚点失效：${location.anchor}`);
  return { sha256: digest(excerpt), line: start, endLine: end };
}

export function sceneReferences(scene) {
  return scene.evidence.flatMap((item) => item.locations.map((location, i) => ({
    key: `evidence.${item.id}.locations[${i}]`, location, claim: item.claim,
    status: item.status ?? "unspecified",
  })));
}

export function graphReferences(graph) {
  return [
    ...graph.nodes.map((node) => ({ key: `nodes.${node.id}`, location: { file: node.file, line: node.line, ...(node.endLine ? { endLine: node.endLine } : {}) }, claim: `${node.label}\n${node.description ?? ""}` })),
    ...graph.edges.filter((edge) => (!edge.callSiteStatus || edge.callSiteStatus === "exact") && edge.file && edge.line)
      .map((edge) => ({ key: `edges.${edge.id}`, location: { file: edge.file, line: edge.line }, claim: edge.description ?? edge.label ?? "" })),
  ];
}
