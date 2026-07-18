import { resolveEdgeCallSite } from "./call-site.js";

export class ClickNavigationPolicy {
  constructor(enabled = false) {
    this.enabled = enabled;
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  shouldOpen(graph, target) {
    return this.enabled && isSourceTargetAvailable(graph, target);
  }
}

export function isSourceTargetAvailable(graph, target) {
  if (!graph || !target) return false;
  if (target.type === "node") {
    const node = graph.nodes.find((candidate) => candidate.id === target.id);
    return Boolean(node?.file && Number(node.line) > 0);
  }
  if (target.type === "edge") {
    const edge = graph.edges.find((candidate) => candidate.id === target.id);
    return Boolean(edge && resolveEdgeCallSite(edge).available);
  }
  return false;
}
