// Validate the build-time data contract; scene text is never executable markup.
// This small interpreter implements only the keywords used by our local schema.
export function validateShape(scene, schema) {
  function check(value, rule, path) {
    if (rule.$ref) return check(value, schema.$defs[rule.$ref.split("/").at(-1)], path);
    const fail = (message) => { throw new Error(`${path}: ${message}`); };
    if (rule.oneOf) {
      const candidates = rule.oneOf.map((item) => schema.$defs[item.$ref.split("/").at(-1)]);
      const match = candidates.find((item) => item.properties.type.const === value?.type);
      if (!match) fail("未知步骤类型；使用 message / note / alt / opt / loop / par");
      return check(value, match, path);
    }
    if ("const" in rule && value !== rule.const) fail(`应为 ${rule.const}`);
    if (rule.enum && !rule.enum.includes(value)) fail(`应为 ${rule.enum.join(" / ")}`);
    if (rule.type === "object") {
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("应为对象");
      for (const key of rule.required || []) if (!(key in value)) fail(`缺少 ${key}`);
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(rule.properties, key)) fail(`未知字段 ${key}`);
        check(value[key], rule.properties[key], `${path}.${key}`);
      }
    } else if (rule.type === "array") {
      if (!Array.isArray(value)) fail("应为数组");
      if (value.length < rule.minItems) fail(`至少需要 ${rule.minItems} 项`);
      value.forEach((item, index) => check(item, rule.items, `${path}[${index}]`));
    } else if (rule.type === "string") {
      if (typeof value !== "string" || !value.trim()) fail("应为非空文本");
      if (rule.pattern && !new RegExp(rule.pattern).test(value)) fail("标识符格式无效");
    } else if (rule.type === "integer") {
      if (!Number.isSafeInteger(value) || value < rule.minimum) fail("应为正整数");
    }
  }
  check(scene, schema, "scene");
  return scene;
}

export function validateScene(scene, schema) {
  validateShape(scene, schema);
  const unique = (items, name) => {
    const ids = new Set();
    for (const item of items) {
      if (ids.has(item.id)) throw new Error(`${name}: 重复 ID ${item.id}`);
      ids.add(item.id);
    }
    return ids;
  };
  const participants = unique(scene.participants, "participants");
  const evidence = unique(scene.evidence, "evidence");
  for (const item of scene.evidence) {
    for (const location of item.locations) {
      if (/^(?:[\\/]|[a-z]:)/i.test(location.file)
        || location.file.split(/[\\/]/).includes("..")) {
        throw new Error(`evidence.${item.id}: 源码文件应为项目内相对路径`);
      }
      if (location.endLine && (!location.line || location.endLine < location.line)) {
        throw new Error(`evidence.${item.id}: endLine 需要有效的起止范围`);
      }
    }
  }
  for (const block of walkBlocks(scene.body)) {
    const referenced = block.type === "message" ? [block.from, block.to] : block.over || [];
    for (const id of referenced) {
      if (!participants.has(id)) throw new Error(`body: 不存在的参与者 ${id}`);
    }
    for (const id of block.evidence || []) {
      if (!evidence.has(id)) throw new Error(`body: 不存在的源码依据 ${id}`);
    }
  }
  return scene;
}

export function* walkBlocks(body) {
  for (const block of body) {
    yield block;
    if (block.body) yield* walkBlocks(block.body);
    for (const branch of block.branches || []) yield* walkBlocks(branch.body);
  }
}
