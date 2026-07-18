const STATUS = {
  exact: {
    shortLabel: "",
    description: "",
  },
  "virtual-node": {
    shortLabel: "虚拟节点",
    description: "端点包含虚拟节点，没有唯一的源码调用位置。",
  },
  "omitted-nodes": {
    shortLabel: "已省略中间节点",
    description: "该关系跨越多个未展示节点，没有唯一的源码调用位置。",
  },
};

export function resolveEdgeCallSite(edge) {
  const status = edge.callSiteStatus || "exact";
  if (status === "exact" && edge.file && Number(edge.line) > 0) {
    return {
      available: true,
      status,
      file: edge.file,
      line: Number(edge.line),
      compactLabel: `${filename(edge.file)}:${edge.line}`,
    };
  }

  const metadata = STATUS[status] || {
    shortLabel: "调用位置不可用",
    description: "调用位置状态无效或数据不完整。",
  };
  return {
    available: false,
    status,
    shortLabel: metadata.shortLabel,
    note: edge.callSiteNote || metadata.description,
  };
}

function filename(path) {
  return String(path).split(/[\\/]/).at(-1) || path;
}
