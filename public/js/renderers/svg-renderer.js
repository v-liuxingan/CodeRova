import { resolveEdgeCallSite } from "../call-site.js";

const NS = "http://www.w3.org/2000/svg";
const markerColorVariables = {
  direct: "--edge-direct",
  callback: "--edge-async",
  spawn: "--edge-async",
  "async-boundary": "--edge-async",
  "trait-dispatch": "--edge-trait",
  "data-flow": "--edge-data",
  remote: "--edge-data",
};

export class SvgRenderer {
  constructor(svg, layout) {
    this.svg = svg;
    this.layout = layout;
    this.transform = { x: 0, y: 0, scale: 1 };
    this.callbacks = {};
    this.lastLayout = null;
    this.bindViewportEvents();
  }

  setCallbacks(callbacks) {
    this.callbacks = callbacks;
  }

  render(graph, state) {
    this.svg.replaceChildren();
    this.installDefinitions();
    this.viewport = svgElement("g", { class: "graph-viewport" });
    this.edgeLayer = svgElement("g", { class: "edge-layer" });
    this.nodeLayer = svgElement("g", { class: "node-layer" });
    this.viewport.append(this.edgeLayer, this.nodeLayer);
    this.svg.append(this.viewport);

    this.lastLayout = this.layout.compute(graph, state.orientation);
    for (const entry of this.lastLayout.edges) this.drawEdge(entry, state);
    for (const entry of this.lastLayout.nodes.values()) this.drawNode(entry, state, graph.edges);
    this.applyTransform();
  }

  installDefinitions() {
    const defs = svgElement("defs");
    const styles = getComputedStyle(document.documentElement);
    for (const [kind, variable] of Object.entries(markerColorVariables)) {
      const color = styles.getPropertyValue(variable).trim();
      const marker = svgElement("marker", {
        id: `arrow-${kind}`,
        viewBox: "0 0 10 10",
        refX: "9",
        refY: "5",
        markerWidth: "7",
        markerHeight: "7",
        orient: "auto-start-reverse",
      });
      marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }));
      defs.append(marker);
    }
    this.svg.append(defs);
  }

  drawEdge({ edge, from, to }, state) {
    if (!from || !to) return;
    const vertical = state.orientation === "vertical";
    const start = vertical
      ? { x: from.x + from.width / 2, y: from.y + from.height }
      : { x: from.x + from.width, y: from.y + from.height / 2 };
    const end = vertical
      ? { x: to.x + to.width / 2, y: to.y }
      : { x: to.x, y: to.y + to.height / 2 };
    const delta = vertical ? Math.max(45, Math.abs(end.y - start.y) * 0.5) : Math.max(45, Math.abs(end.x - start.x) * 0.5);
    const pathData = vertical
      ? `M ${start.x} ${start.y} C ${start.x} ${start.y + delta}, ${end.x} ${end.y - delta}, ${end.x} ${end.y}`
      : `M ${start.x} ${start.y} C ${start.x + delta} ${start.y}, ${end.x - delta} ${end.y}, ${end.x} ${end.y}`;
    const kind = markerColorVariables[edge.kind] ? edge.kind : "direct";
    const callSite = resolveEdgeCallSite(edge);
    const selectEdge = (event) => {
      event.stopPropagation();
      this.callbacks.onSelect?.({ type: "edge", id: edge.id });
    };
    const handleEdgeKey = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectEdge(event);
    };
    const edgeGroup = svgElement("g", {
      class: "graph-edge-group",
      tabindex: "0",
      role: "button",
      "aria-label": callSite.available
        ? `${edge.label || "调用关系"}，调用位置 ${callSite.compactLabel}`
        : `${edge.label || "调用关系"}，${callSite.shortLabel}`,
      "data-edge-group-id": edge.id,
    });
    edgeGroup.addEventListener("click", selectEdge);
    edgeGroup.addEventListener("keydown", handleEdgeKey);

    const hitTarget = svgElement("path", {
      class: "graph-edge-hit",
      d: pathData,
      "data-edge-hit-id": edge.id,
    });
    const title = svgElement("title");
    title.textContent = callSite.available
      ? `单击查看调用位置 ${callSite.compactLabel}`
      : `单击查看说明：${callSite.shortLabel}`;
    edgeGroup.append(title);

    const path = svgElement("path", {
      class: `graph-edge ${edge.kind}${state.selected?.type === "edge" && state.selected.id === edge.id ? " selected" : ""}`,
      d: pathData,
      "marker-end": `url(#arrow-${kind})`,
      "data-edge-id": edge.id,
    });
    edgeGroup.append(hitTarget, path);

    const midpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
    if (edge.label) {
      const label = svgElement("text", {
        class: "edge-label",
        x: midpoint.x,
        y: midpoint.y - 7,
        "text-anchor": "middle",
      });
      label.textContent = edge.label;
      edgeGroup.append(label);
    }

    const callSiteLabel = svgElement("text", {
      class: `edge-callsite${callSite.available ? "" : " unavailable"}`,
      x: midpoint.x,
      y: midpoint.y + 8,
      "text-anchor": "middle",
      "data-edge-id": edge.id,
      "data-callsite-status": callSite.status,
    });
    callSiteLabel.textContent = callSite.available
      ? callSite.compactLabel
      : `◇ ${callSite.shortLabel}`;
    edgeGroup.append(callSiteLabel);
    this.edgeLayer.append(edgeGroup);
  }

  drawNode(entry, state, visibleEdges) {
    const { node, x, y, width, height } = entry;
    const selected = state.selected?.type === "node" && state.selected.id === node.id;
    const dimmed = !state.matchesQuery(node);
    const group = svgElement("g", {
      class: `graph-node${selected ? " selected" : ""}${dimmed ? " search-dim" : ""}`,
      transform: `translate(${x} ${y})`,
      tabindex: "0",
      role: "button",
      "aria-label": `${node.label}，${node.role}`,
      "data-node-id": node.id,
    });
    group.append(
      svgElement("rect", { class: "node-box", width, height, rx: "2" }),
      svgElement("rect", { class: "node-accent", width: "3", height }),
      svgElement("circle", { class: "node-port", cx: width / 2, cy: "0", r: "4" }),
      svgElement("circle", { class: "node-port", cx: width / 2, cy: height, r: "4" }),
    );
    addText(group, node.kind.toUpperCase(), 14, 17, "node-kind");
    addText(group, truncate(node.label, 31), 14, 39, "node-label");
    addText(group, truncate(`${node.crate || "unknown"} · ${shortPath(node.file)}:${node.line}`, 39), 14, 59, "node-crate");
    addText(group, truncate(node.role, 32), 14, 77, "node-role");

    const hasChildren = visibleEdges.some((edge) => edge.from === node.id);
    if (hasChildren) {
      const collapsed = state.collapsed.has(node.id);
      const toggle = svgElement("g", {
        class: "collapse-toggle",
        transform: `translate(${width - 22} 10)`,
        "aria-label": collapsed ? "展开下游" : "折叠下游",
      });
      toggle.append(
        svgElement("rect", { class: "node-collapse", width: "14", height: "14", rx: "1" }),
      );
      addText(toggle, collapsed ? "+" : "−", 7, 11, "node-collapse-text", "middle");
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        this.callbacks.onToggleCollapse?.(node.id);
      });
      group.append(toggle);
    }
    const select = () => this.callbacks.onSelect?.({ type: "node", id: node.id });
    group.addEventListener("click", select);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") select();
    });
    this.nodeLayer.append(group);
  }

  fit() {
    if (!this.lastLayout?.bounds.width) return;
    const rect = this.svg.getBoundingClientRect();
    const padding = 90;
    const scale = Math.min(
      (rect.width - padding) / this.lastLayout.bounds.width,
      (rect.height - padding) / this.lastLayout.bounds.height,
      1.12,
    );
    this.transform.scale = Math.max(0.05, scale);
    this.transform.x = (rect.width - this.lastLayout.bounds.width * this.transform.scale) / 2;
    this.transform.y = Math.max(38, (rect.height - this.lastLayout.bounds.height * this.transform.scale) / 2);
    this.applyTransform();
  }

  focusStart(orientation = "vertical") {
    if (!this.lastLayout?.bounds.width) return;
    const rect = this.svg.getBoundingClientRect();
    this.transform.scale = orientation === "vertical" ? 0.62 : 0.5;
    this.transform.x =
      orientation === "vertical"
        ? (rect.width - this.lastLayout.bounds.width * this.transform.scale) / 2
        : 38;
    this.transform.y =
      orientation === "vertical"
        ? 38
        : (rect.height - this.lastLayout.bounds.height * this.transform.scale) / 2;
    this.applyTransform();
  }

  zoomBy(factor, center) {
    const rect = this.svg.getBoundingClientRect();
    const point = center || { x: rect.width / 2, y: rect.height / 2 };
    const next = Math.min(2.4, Math.max(0.05, this.transform.scale * factor));
    const worldX = (point.x - this.transform.x) / this.transform.scale;
    const worldY = (point.y - this.transform.y) / this.transform.scale;
    this.transform.x = point.x - worldX * next;
    this.transform.y = point.y - worldY * next;
    this.transform.scale = next;
    this.applyTransform();
  }

  applyTransform() {
    this.viewport?.setAttribute(
      "transform",
      `translate(${this.transform.x} ${this.transform.y}) scale(${this.transform.scale})`,
    );
  }

  bindViewportEvents() {
    let drag = null;
    let suppressCanvasClick = false;
    const dragThreshold = 4;
    this.svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = this.svg.getBoundingClientRect();
      this.zoomBy(event.deltaY < 0 ? 1.12 : 0.89, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    }, { passive: false });
    this.svg.addEventListener("pointerdown", (event) => {
      if (event.target.closest?.(".graph-node, .graph-edge-group")) return;
      drag = {
        x: event.clientX,
        y: event.clientY,
        originX: this.transform.x,
        originY: this.transform.y,
        moved: false,
      };
      suppressCanvasClick = false;
      this.svg.setPointerCapture(event.pointerId);
      this.svg.parentElement.classList.add("dragging");
    });
    this.svg.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const deltaX = event.clientX - drag.x;
      const deltaY = event.clientY - drag.y;
      if (Math.hypot(deltaX, deltaY) >= dragThreshold) drag.moved = true;
      this.transform.x = drag.originX + deltaX;
      this.transform.y = drag.originY + deltaY;
      this.applyTransform();
    });
    const finish = (event) => {
      suppressCanvasClick = event.type === "pointerup" && Boolean(drag?.moved);
      drag = null;
      this.svg.parentElement.classList.remove("dragging");
    };
    this.svg.addEventListener("pointerup", finish);
    this.svg.addEventListener("pointercancel", finish);
    this.svg.addEventListener("click", (event) => {
      if (suppressCanvasClick) {
        suppressCanvasClick = false;
        return;
      }
      if (event.target === this.svg) this.callbacks.onSelect?.(null);
    });
  }
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function addText(parent, content, x, y, className, anchor) {
  const text = svgElement("text", { x, y, class: className });
  if (anchor) text.setAttribute("text-anchor", anchor);
  text.textContent = content;
  parent.append(text);
}

function shortPath(path) {
  const parts = path.split(/[\\/]/);
  return parts.slice(-2).join("/");
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
