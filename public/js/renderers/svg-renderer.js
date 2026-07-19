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
    this.edgeViews = new Map();
    this.nodeDrag = null;
    this.suppressNodeClick = null;
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
    this.edgeLabelLayer = svgElement("g", { class: "edge-label-layer" });
    this.nodeLayer = svgElement("g", { class: "node-layer" });
    this.viewport.append(this.edgeLayer, this.edgeLabelLayer, this.nodeLayer);
    this.svg.append(this.viewport);

    this.edgeViews.clear();
    this.lastLayout = this.layout.compute(
      graph,
      state.orientation,
      state.getNodePositions?.() || {},
    );
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
      "data-edge-hit-id": edge.id,
    });
    const title = svgElement("title");
    title.textContent = callSite.available
      ? `单击查看调用位置 ${callSite.compactLabel}`
      : `单击查看说明：${callSite.shortLabel}`;
    edgeGroup.append(title);

    const path = svgElement("path", {
      class: `graph-edge ${edge.kind}${state.selected?.type === "edge" && state.selected.id === edge.id ? " selected" : ""}`,
      "marker-end": `url(#arrow-${kind})`,
      "data-edge-id": edge.id,
    });
    edgeGroup.append(hitTarget, path);

    const labelGroup = svgElement("g", {
      class: "graph-edge-label-group graph-edge-group",
      role: "button",
      tabindex: "0",
      "aria-label": callSite.available
        ? `${edge.label || "调用关系"}，调用位置 ${callSite.compactLabel}`
        : `${edge.label || "调用关系"}，${callSite.shortLabel}`,
      "data-edge-group-id": edge.id,
    });
    labelGroup.addEventListener("click", selectEdge);
    labelGroup.addEventListener("keydown", handleEdgeKey);
    const card = svgElement("rect", {
      class: "edge-label-card",
      rx: "5",
    });
    labelGroup.append(card);
    let label = null;
    if (edge.label) {
      label = svgElement("text", {
        class: "edge-label",
        x: "0",
        y: "-4",
        "text-anchor": "middle",
      });
      label.textContent = edge.label;
      labelGroup.append(label);
    }

    const callSiteLabel = svgElement("text", {
      class: `edge-callsite${callSite.available ? "" : " unavailable"}`,
      x: "0",
      y: edge.label ? "10" : "3",
      "text-anchor": "middle",
      "data-edge-id": edge.id,
      "data-callsite-status": callSite.status,
    });
    callSiteLabel.textContent = callSite.available
      ? callSite.compactLabel
      : `◇ ${callSite.shortLabel}`;
    labelGroup.append(callSiteLabel);
    this.edgeLayer.append(edgeGroup);
    this.edgeLabelLayer.append(labelGroup);

    const entry = { edge, from, to };
    const view = {
      entry,
      hitTarget,
      path,
      labelGroup,
      card,
      label,
      callSiteLabel,
      orientation: state.orientation,
    };
    this.sizeEdgeLabel(view);
    this.updateEdgeView(view);
    this.edgeViews.set(edge.id, view);
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
    group.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest?.(".collapse-toggle")) return;
      this.beginNodeDrag(event, entry, group);
    });
    group.addEventListener("click", (event) => {
      if (this.suppressNodeClick === node.id) {
        event.stopPropagation();
        return;
      }
      select();
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") select();
    });
    this.nodeLayer.append(group);
  }

  sizeEdgeLabel(view) {
    const textWidths = [view.label, view.callSiteLabel]
      .filter(Boolean)
      .map((element) => element.getComputedTextLength());
    view.labelWidth = Math.max(54, ...textWidths) + 16;
    view.labelHeight = view.label ? 32 : 22;
    view.card.setAttribute("x", String(-view.labelWidth / 2));
    view.card.setAttribute("y", String(-view.labelHeight / 2));
    view.card.setAttribute("width", String(view.labelWidth));
    view.card.setAttribute("height", String(view.labelHeight));
  }

  updateEdgeView(view) {
    const geometry = edgeGeometry(view.entry, view.orientation);
    view.hitTarget.setAttribute("d", geometry.pathData);
    view.path.setAttribute("d", geometry.pathData);
    const position =
      view.orientation === "vertical"
        ? {
            x: geometry.midpoint.x + view.labelWidth / 2 + 14,
            y: geometry.midpoint.y,
          }
        : {
            x: geometry.midpoint.x,
            y: geometry.midpoint.y - view.labelHeight / 2 - 13,
          };
    view.labelGroup.setAttribute("transform", `translate(${position.x} ${position.y})`);
  }

  beginNodeDrag(event, entry, group) {
    event.stopPropagation();
    this.nodeDrag = {
      id: entry.node.id,
      entry,
      group,
      startX: event.clientX,
      startY: event.clientY,
      originX: entry.x,
      originY: entry.y,
      moved: false,
    };
    group.setPointerCapture(event.pointerId);
    group.classList.add("dragging");
    this.svg.parentElement.classList.add("node-dragging");
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
    this.transform.x -= this.lastLayout.bounds.x * this.transform.scale;
    this.transform.y =
      Math.max(38, (rect.height - this.lastLayout.bounds.height * this.transform.scale) / 2)
      - this.lastLayout.bounds.y * this.transform.scale;
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
    this.transform.x -= this.lastLayout.bounds.x * this.transform.scale;
    this.transform.y =
      orientation === "vertical"
        ? 38
        : (rect.height - this.lastLayout.bounds.height * this.transform.scale) / 2;
    this.transform.y -= this.lastLayout.bounds.y * this.transform.scale;
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
      if (this.nodeDrag) {
        event.preventDefault();
        const deltaX = (event.clientX - this.nodeDrag.startX) / this.transform.scale;
        const deltaY = (event.clientY - this.nodeDrag.startY) / this.transform.scale;
        if (Math.hypot(deltaX, deltaY) >= dragThreshold) this.nodeDrag.moved = true;
        this.nodeDrag.entry.x = this.nodeDrag.originX + deltaX;
        this.nodeDrag.entry.y = this.nodeDrag.originY + deltaY;
        this.nodeDrag.group.setAttribute(
          "transform",
          `translate(${this.nodeDrag.entry.x} ${this.nodeDrag.entry.y})`,
        );
        for (const view of this.edgeViews.values()) {
          if (
            view.entry.edge.from === this.nodeDrag.id
            || view.entry.edge.to === this.nodeDrag.id
          ) {
            this.updateEdgeView(view);
          }
        }
        return;
      }
      if (!drag) return;
      const deltaX = event.clientX - drag.x;
      const deltaY = event.clientY - drag.y;
      if (Math.hypot(deltaX, deltaY) >= dragThreshold) drag.moved = true;
      this.transform.x = drag.originX + deltaX;
      this.transform.y = drag.originY + deltaY;
      this.applyTransform();
    });
    const finish = (event) => {
      if (this.nodeDrag) {
        const completed = this.nodeDrag;
        completed.group.classList.remove("dragging");
        this.svg.parentElement.classList.remove("node-dragging");
        this.nodeDrag = null;
        if (completed.moved && event.type === "pointerup") {
          this.suppressNodeClick = completed.id;
          this.callbacks.onNodeMove?.(completed.id, {
            x: completed.entry.x,
            y: completed.entry.y,
          });
          window.setTimeout(() => {
            if (this.suppressNodeClick === completed.id) this.suppressNodeClick = null;
          }, 0);
        } else {
          completed.entry.x = completed.originX;
          completed.entry.y = completed.originY;
          completed.group.setAttribute(
            "transform",
            `translate(${completed.originX} ${completed.originY})`,
          );
          for (const view of this.edgeViews.values()) {
            if (
              view.entry.edge.from === completed.id
              || view.entry.edge.to === completed.id
            ) {
              this.updateEdgeView(view);
            }
          }
        }
        return;
      }
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

function edgeGeometry({ from, to }, orientation) {
  const vertical = orientation === "vertical";
  const start = vertical
    ? { x: from.x + from.width / 2, y: from.y + from.height }
    : { x: from.x + from.width, y: from.y + from.height / 2 };
  const end = vertical
    ? { x: to.x + to.width / 2, y: to.y }
    : { x: to.x, y: to.y + to.height / 2 };
  const delta = vertical
    ? Math.max(45, Math.abs(end.y - start.y) * 0.5)
    : Math.max(45, Math.abs(end.x - start.x) * 0.5);
  const control1 = vertical
    ? { x: start.x, y: start.y + delta }
    : { x: start.x + delta, y: start.y };
  const control2 = vertical
    ? { x: end.x, y: end.y - delta }
    : { x: end.x - delta, y: end.y };
  return {
    pathData:
      `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, `
      + `${control2.x} ${control2.y}, ${end.x} ${end.y}`,
    midpoint: cubicPoint(start, control1, control2, end, 0.5),
  };
}

function cubicPoint(start, control1, control2, end, t) {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * start.x
      + 3 * inverse ** 2 * t * control1.x
      + 3 * inverse * t ** 2 * control2.x
      + t ** 3 * end.x,
    y:
      inverse ** 3 * start.y
      + 3 * inverse ** 2 * t * control1.y
      + 3 * inverse * t ** 2 * control2.y
      + t ** 3 * end.y,
  };
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
