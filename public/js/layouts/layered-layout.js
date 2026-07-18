/**
 * Breadth-first layered layout.
 *
 * Layout is intentionally independent from SVG. A future renderer can consume
 * the same {nodes, edges, bounds} result, or a different layout can be passed
 * to the current renderer.
 */
export class LayeredLayout {
  constructor({ nodeWidth = 230, nodeHeight = 92, layerGap = 92, nodeGap = 34 } = {}) {
    this.nodeWidth = nodeWidth;
    this.nodeHeight = nodeHeight;
    this.layerGap = layerGap;
    this.nodeGap = nodeGap;
  }

  compute(graph, orientation = "vertical") {
    if (!graph.nodes.length) {
      return { nodes: new Map(), edges: [], bounds: { width: 0, height: 0 } };
    }
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
    for (const edge of graph.edges) {
      if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
        incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
      }
    }
    const roots = graph.nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
    if (!roots.length) roots.push(graph.nodes[0].id);

    const levels = new Map();
    const queue = roots.map((id) => [id, 0]);
    while (queue.length) {
      const [id, level] = queue.shift();
      if (levels.has(id)) continue;
      levels.set(id, level);
      for (const edge of graph.edges) {
        if (edge.from === id && nodeIds.has(edge.to) && !levels.has(edge.to)) {
          queue.push([edge.to, level + 1]);
        }
      }
    }
    for (const node of graph.nodes) {
      if (!levels.has(node.id)) levels.set(node.id, Math.max(0, ...levels.values()) + 1);
    }

    const layers = new Map();
    for (const node of graph.nodes) {
      const level = levels.get(node.id);
      if (!layers.has(level)) layers.set(level, []);
      layers.get(level).push(node);
    }

    const maxLayerSize = Math.max(...[...layers.values()].map((layer) => layer.length));
    const vertical = orientation === "vertical";
    const crossDimension = vertical ? this.nodeWidth : this.nodeHeight;
    const mainDimension = vertical ? this.nodeHeight : this.nodeWidth;
    const crossSize =
      maxLayerSize * crossDimension + (maxLayerSize - 1) * this.nodeGap;
    const positions = new Map();
    for (const [level, nodes] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
      const layerWidth =
        nodes.length * crossDimension + (nodes.length - 1) * this.nodeGap;
      nodes.sort((a, b) => a.label.localeCompare(b.label));
      nodes.forEach((node, index) => {
        const cross =
          (crossSize - layerWidth) / 2 + index * (crossDimension + this.nodeGap);
        const main = level * (mainDimension + this.layerGap);
        positions.set(node.id, {
          node,
          x: vertical ? cross : main,
          y: vertical ? main : cross,
          width: this.nodeWidth,
          height: this.nodeHeight,
        });
      });
    }

    const values = [...positions.values()];
    const width = Math.max(...values.map((item) => item.x + item.width));
    const height = Math.max(...values.map((item) => item.y + item.height));
    const edges = graph.edges.map((edge) => ({
      edge,
      from: positions.get(edge.from),
      to: positions.get(edge.to),
    }));
    return { nodes: positions, edges, bounds: { width, height } };
  }
}
