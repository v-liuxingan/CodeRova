import { validateScene, validateShape } from "./validate.mjs";

// A documented subset of Mermaid sequenceDiagram, not a general Mermaid engine.
// Parsing is local and never executes directives, includes, HTML, or JavaScript.
export function parseMermaid(source, filename = "sequence.mmd") {
  const participants = [], byId = new Map(), declared = new Set(), body = [];
  const stack = [{ body }];
  let header = false, pendingEvidence = null;
  const fail = (line, message) => { throw new Error(`${filename}:${line}: ${message}`); };
  function participant(id) {
    if (!byId.has(id)) {
      const actor = { id, label: id };
      byId.set(id, actor); participants.push(actor);
    }
    return byId.get(id);
  }
  const label = (value, line) => {
    if (!value.trim()) fail(line, "消息、说明或条件不能为空");
    if (value.replace(/#(?:\d+|quot|amp|lt|gt);/g, "").includes(";")) {
      fail(line, "每行只写一条语句；文字中的分号请用 #59;");
    }
    return value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/#(\d+|quot|amp|lt|gt);/g, (_, entity) => {
      if (/^\d+$/.test(entity)) {
        const code = Number(entity);
        if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
          fail(line, "字符实体码无效");
        }
        return String.fromCodePoint(code);
      }
      return { quot: '"', amp: "&", lt: "<", gt: ">" }[entity];
    });
  };
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = index + 1, input = raw.trim();
    if (!input) return;
    if (/^%%\s*\{/.test(input)) fail(line, "不支持 Mermaid 配置指令，样式由项目统一控制");
    if (input.startsWith("%%")) {
      if (/^%%\s*@evidence\b/.test(input)) {
        const ids = input.match(/^%%\s*@evidence\s+([A-Za-z0-9_-]+(?:\s*,\s*[A-Za-z0-9_-]+)*)\s*$/);
        if (!header || !ids || pendingEvidence) fail(line, "依据注释格式为 %% @evidence id1,id2，且必须紧接下一条消息或 Note");
        pendingEvidence = { ids: [...new Set(ids[1].split(/\s*,\s*/))], line };
      }
      return;
    }
    if (pendingEvidence && !/^(?:[A-Za-z0-9_]+\s*(?:-->>|->>|-\))|Note\s+over\s)/i.test(input)) {
      fail(line, "依据注释只能标注下一条消息或 Note；控制条件可在 Note 中说明");
    }
    if (!header) {
      if (input !== "sequenceDiagram") fail(line, "第一条语句必须是 sequenceDiagram");
      header = true; return;
    }
    let match;
    const current = () => stack.at(-1).body;
    if ((match = input.match(/^participant\s+([A-Za-z0-9_]+)(?:\s+as\s+(.+))?$/))) {
      if (stack.length !== 1) fail(line, "参与者声明应放在控制流框之外");
      if (declared.has(match[1])) fail(line, `重复参与者声明 ${match[1]}`);
      declared.add(match[1]);
      participant(match[1]).label = match[2] ? label(match[2], line) : match[1];
    } else if ((match = input.match(/^([A-Za-z0-9_]+)\s*(-->>|->>|-\))\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/))) {
      const [, from, arrow, to, value] = match;
      participant(from); participant(to);
      current().push({ type: "message", from, to, kind: arrow === "->>" ? "call" : arrow === "-->>" ? "return" : "async", label: label(value, line), ...(pendingEvidence ? { evidence: pendingEvidence.ids } : {}) });
      pendingEvidence = null;
    } else if ((match = input.match(/^Note\s+over\s+([A-Za-z0-9_]+)(?:\s*,\s*([A-Za-z0-9_]+))?\s*:\s*(.*)$/i))) {
      const over = [match[1], match[2]].filter(Boolean);
      for (const id of over) if (!byId.has(id)) fail(line, `说明引用了尚未出现的参与者 ${id}`);
      current().push({ type: "note", over, text: label(match[3], line), ...(pendingEvidence ? { evidence: pendingEvidence.ids } : {}) });
      pendingEvidence = null;
    } else if ((match = input.match(/^(alt|par|opt|loop)\s+(.+)$/))) {
      const type = match[1], condition = label(match[2], line), nested = [];
      const block = ["alt", "par"].includes(type)
        ? { type, branches: [{ condition, body: nested }] } : { type, condition, body: nested };
      current().push(block); stack.push({ block, body: nested, line });
    } else if ((match = input.match(/^(else|and)\s+(.+)$/))) {
      const frame = stack.at(-1), expected = match[1] === "else" ? "alt" : "par";
      if (frame.block?.type !== expected) fail(line, `${match[1]} 必须位于对应的 ${expected} 框中`);
      if (!frame.body.length) fail(line, "前一个分区不能为空");
      frame.body = [];
      frame.block.branches.push({ condition: label(match[2], line), body: frame.body });
    } else if (input === "end") {
      if (stack.length === 1) fail(line, "多余的 end");
      const frame = stack.pop();
      if (!frame.body.length) fail(line, "控制流区域不能为空");
      if (frame.block.branches?.length < 2) fail(line, `${frame.block.type} 需要至少两个分区；单路可选行为使用 opt`);
    } else {
      fail(line, "不支持的时序语法；支持 participant、->> / -->> / -)、Note over、alt/else、par/and、opt、loop、end。其他箭头、激活、创建/销毁、ref 和样式指令尚未支持");
    }
  });
  if (!header) fail(1, "缺少 sequenceDiagram");
  if (pendingEvidence) fail(pendingEvidence.line, "依据注释后缺少消息或 Note");
  if (stack.length > 1) fail(stack.at(-1).line, "控制流框未闭合，缺少 end");
  if (!body.length) fail(lines.length, "场景没有消息或控制流");
  return { participants, body };
}

export function compileMermaidScene(metadata, source, schema, metadataSchema, filename) {
  validateShape(metadata, metadataSchema);
  const parsed = parseMermaid(source, filename);
  const evidenceIds = new Set(metadata.evidence.map((item) => item.id));
  source.split(/\r?\n/).forEach((line, index) => {
    const match = line.trim().match(/^%%\s*@evidence\s+(.+)$/);
    if (match) for (const id of match[1].split(/\s*,\s*/)) {
      if (!evidenceIds.has(id)) throw new Error(`${filename}:${index + 1}: 不存在的源码依据 ${id}`);
    }
  });
  const roles = new Set();
  for (const item of metadata.participantRoles || []) {
    if (roles.has(item.id)) throw new Error(`participantRoles: 重复 ID ${item.id}`);
    roles.add(item.id);
    const actor = parsed.participants.find((actor) => actor.id === item.id);
    if (!actor) throw new Error(`participantRoles: 不存在的参与者 ${item.id}`);
    actor.role = item.role;
  }
  const { participantRoles, ...rest } = metadata;
  return validateScene({ ...rest, ...parsed }, schema);
}
