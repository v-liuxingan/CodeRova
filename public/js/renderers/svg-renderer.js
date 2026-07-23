import { resolveEdgeCallSite } from "../call-site.js";
import {
  edgeExecutionOrder,
  edgeFlowKind,
  edgeFlowSemanticText,
  isControlEdge,
} from "../edge-semantics.js";
import {
  nodeIdsWithinRectangle,
  normalizeScreenRectangle,
} from "../marquee-selection.js";
import { placeEdgeLabels } from "./edge-label-placer.js";

const NS = "http://www.w3.org/2000/svg";
const markerColorVariables = {
  direct: "--edge-direct",
  callback: "--edge-async",
  spawn: "--edge-async",
  "async-boundary": "--edge-async",
  "trait-dispatch": "--edge-trait",
  "data-flow": "--edge-data",
  remote: "--edge-data",
  feedback: "--amber",
};

export class SvgRenderer {
  constructor(svg, layout) {
    this.svg = svg;
    this.layout = layout;
    this.transform = { x: 0, y: 0, scale: 1 };
    this.callbacks = {};
    this.lastLayout = null;
    this.edgeViews = new Map();
    this.nodeViews = new Map();
    this.nodeDrag = null;
    this.suppressNodeClicks = new Set();
    this.bindViewportEvents();
  }

  setCallbacks(callbacks) {
    this.callbacks = callbacks;
  }

  render(graph, state) {
    const viewport = this.getViewport();
    this.orientation = state.orientation;
    this.svg.replaceChildren();
    this.installDefinitions();
    this.viewport = svgElement("g", { class: "graph-viewport" });
    this.dataEdgeLayer = svgElement("g", { class: "data-edge-layer" });
    this.dataEdgeLabelLayer = svgElement("g", { class: "data-edge-label-layer" });
    this.edgeLayer = svgElement("g", { class: "edge-layer" });
    this.edgeLabelLayer = svgElement("g", { class: "edge-label-layer" });
    this.nodeLayer = svgElement("g", { class: "node-layer" });
    this.marqueeLayer = svgElement("g", {
      class: "marquee-layer",
      "pointer-events": "none",
    });
    this.marqueeRect = svgElement("rect", {
      class: "marquee-selection",
      fill: "none",
      "pointer-events": "none",
    });
    this.marqueeLayer.append(this.marqueeRect);
    this.viewport.append(
      this.dataEdgeLayer,
      this.dataEdgeLabelLayer,
      this.edgeLayer,
      this.edgeLabelLayer,
      this.nodeLayer,
    );
    this.svg.append(this.viewport, this.marqueeLayer);

    this.edgeViews.clear();
    this.nodeViews.clear();
    this.lastLayout = this.layout.compute(
      graph,
      state.orientation,
      state.getNodePositions?.() || {},
    );
    this.svg.dataset.layoutMode = this.lastLayout.layoutMode || "narrative";
    const selectionFocus = normalizeSelectionFocus(graph.selectionFocus);
    for (const entry of this.lastLayout.edges) {
      this.drawEdge(entry, state, selectionFocus);
    }
    this.layoutEdgeLabels(state.orientation);
    const structure = visibleControlDegrees(graph.nodes, graph.edges);
    for (const entry of this.lastLayout.nodes.values()) {
      this.drawNode(
        entry,
        state,
        structure.get(entry.node.id),
        selectionFocus,
      );
    }
    this.setViewport(viewport);
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

  drawEdge({
    edge,
    from,
    to,
    narrativeRole = "branch",
    routingRole = "forward",
    backEdge = false,
    feedbackLane = 0,
    bounds = null,
  }, state, selectionFocus) {
    if (!from || !to) return;
    const kind = markerColorVariables[edge.kind] ? edge.kind : "direct";
    const dataFlow = edge.kind === "data-flow";
    const selected = state.selected?.type === "edge" && state.selected.id === edge.id;
    const pathFocusClass = focusClass(
      selectionFocus.active,
      selectionFocus.edgeIds.has(edge.id),
    );
    const callSite = resolveEdgeCallSite(edge);
    const flowKind = edgeFlowKind(edge);
    const semanticText = edgeFlowSemanticText(edge);
    const executionOrder = edgeExecutionOrder(edge);
    const accessibleLabel = [
      edge.label || "调用关系",
      executionOrder ? `同一调用者内第 ${executionOrder} 步` : "",
      semanticText,
      callSite.available
        ? `调用位置 ${callSite.compactLabel}`
        : callSite.shortLabel,
    ].filter(Boolean).join("，");
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
      class: `graph-edge-group${dataFlow ? " data-flow-relation" : ""}${pathFocusClass}${selected ? " selected" : ""}`,
      tabindex: "0",
      role: "button",
      "aria-label": accessibleLabel,
      "data-edge-group-id": edge.id,
      "data-narrative-role": narrativeRole,
      "data-routing-role": routingRole,
      "data-edge-kind": edge.kind,
      "data-flow-kind": flowKind,
      "data-execution-order": executionOrder || "",
      "data-from-node-id": edge.from,
      "data-to-node-id": edge.to,
      "data-path-focus": focusData(
        selectionFocus.active,
        selectionFocus.edgeIds.has(edge.id),
      ),
    });
    edgeGroup.addEventListener("click", selectEdge);
    edgeGroup.addEventListener("keydown", handleEdgeKey);

    const hitTarget = svgElement("path", {
      class: "graph-edge-hit",
      "data-edge-hit-id": edge.id,
    });
    const title = svgElement("title");
    title.textContent = [
      callSite.available
        ? `单击查看调用位置 ${callSite.compactLabel}`
        : `单击查看说明：${callSite.shortLabel}`,
      semanticText,
    ].filter(Boolean).join("；");
    edgeGroup.append(title);

    const path = svgElement("path", {
      class: `graph-edge ${edge.kind}${narrativeRole === "spine" ? " narrative-spine" : ""}${backEdge ? " feedback" : ""}${selected ? " selected" : ""}`,
      "marker-end": `url(#arrow-${backEdge ? "feedback" : kind})`,
      "data-edge-id": edge.id,
    });
    edgeGroup.append(hitTarget, path);

    const labelGroup = svgElement("g", {
      class: `graph-edge-label-group graph-edge-group${dataFlow ? " data-flow-relation" : ""}${pathFocusClass}${selected ? " selected" : ""}`,
      role: "button",
      tabindex: "0",
      "aria-label": accessibleLabel,
      "data-edge-group-id": edge.id,
      "data-narrative-role": narrativeRole,
      "data-routing-role": routingRole,
      "data-edge-kind": edge.kind,
      "data-flow-kind": flowKind,
      "data-execution-order": executionOrder || "",
      "data-from-node-id": edge.from,
      "data-to-node-id": edge.to,
      "data-path-focus": focusData(
        selectionFocus.active,
        selectionFocus.edgeIds.has(edge.id),
      ),
    });
    labelGroup.addEventListener("click", selectEdge);
    labelGroup.addEventListener("keydown", handleEdgeKey);
    const card = svgElement("rect", {
      class: "edge-label-card",
      rx: "5",
    });
    labelGroup.append(card);
    let label = null;
    if (edge.label || executionOrder) {
      label = svgElement("text", {
        class: `edge-label${executionOrder ? " ordered" : ""}`,
        x: "0",
        y: "-4",
        "text-anchor": "middle",
      });
      const orderLabel = executionOrder
        ? String(executionOrder).padStart(2, "0")
        : "";
      label.textContent = [
        orderLabel ? `[${orderLabel}]` : "",
        edge.label || "顺序调用",
      ].filter(Boolean).join(" ");
      labelGroup.append(label);
    }

    const callSiteLabel = svgElement("text", {
      class: `edge-callsite${callSite.available ? "" : " unavailable"}`,
      x: "0",
      y: label ? "10" : "3",
      "text-anchor": "middle",
      "data-edge-id": edge.id,
      "data-callsite-status": callSite.status,
    });
    callSiteLabel.textContent = callSite.available
      ? callSite.compactLabel
      : `◇ ${callSite.shortLabel}`;
    labelGroup.append(callSiteLabel);
    (dataFlow ? this.dataEdgeLayer : this.edgeLayer).append(edgeGroup);
    (dataFlow ? this.dataEdgeLabelLayer : this.edgeLabelLayer).append(labelGroup);

    const entry = {
      edge,
      from,
      to,
      routingRole,
      backEdge,
      feedbackLane,
      bounds,
    };
    const view = {
      entry,
      edgeGroup,
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

  drawNode(
    entry,
    state,
    structure = { incoming: 0, outgoing: 0 },
    selectionFocus = { active: false, originNodeId: null, nodeIds: new Set() },
  ) {
    const { node, x, y, width, height } = entry;
    const selected = state.selected?.type === "node" && state.selected.id === node.id;
    const groupSelected = state.selectedNodeIds.has(node.id);
    const dimmed = !state.matchesQuery(node);
    const pathFocusClass = focusClass(
      selectionFocus.active,
      selectionFocus.nodeIds.has(node.id),
    );
    const pathOrigin =
      selectionFocus.active && selectionFocus.originNodeId === node.id;
    const group = svgElement("g", {
      class: `graph-node narrative-${entry.narrativeRole || "branch"}${pathFocusClass}${pathOrigin ? " path-origin" : ""}${selected ? " selected" : ""}${groupSelected ? " group-selected" : ""}${dimmed ? " search-dim" : ""}`,
      transform: `translate(${x} ${y})`,
      tabindex: "0",
      role: "button",
      "aria-label": `${node.label}，${node.role}${groupSelected ? "，已加入布局多选" : ""}`,
      "aria-pressed": String(groupSelected),
      "data-node-id": node.id,
      "data-narrative-role": entry.narrativeRole || "branch",
      "data-path-focus": focusData(
        selectionFocus.active,
        selectionFocus.nodeIds.has(node.id),
      ),
    });
    group.append(
      svgElement("rect", { class: "node-box", width, height, rx: "2" }),
      svgElement("rect", {
        class: "node-group-selection outer",
        x: "-5",
        y: "-5",
        width: width + 10,
        height: height + 10,
        rx: "5",
        fill: "none",
        "pointer-events": "none",
      }),
      svgElement("rect", {
        class: "node-group-selection inner",
        x: "-2",
        y: "-2",
        width: width + 4,
        height: height + 4,
        rx: "3",
        fill: "none",
        "pointer-events": "none",
      }),
      svgElement("rect", { class: "node-accent", width: "3", height }),
      svgElement("circle", { class: "node-port", cx: width / 2, cy: "0", r: "4" }),
      svgElement("circle", { class: "node-port", cx: width / 2, cy: height, r: "4" }),
    );
    addText(group, node.kind.toUpperCase(), 14, 17, "node-kind");
    addText(group, truncate(node.label, 31), 14, 39, "node-label");
    addText(group, truncate(`${node.crate || "unknown"} · ${shortPath(node.file)}:${node.line}`, 39), 14, 59, "node-crate");
    addText(group, truncate(node.role, 32), 14, 77, "node-role");
    if (structure.incoming > 1) {
      group.append(structureMarker("merge", `MERGE ${structure.incoming}`, 7, -18));
    }
    if (structure.outgoing > 1) {
      group.append(
        structureMarker("fork", `${structure.outgoing} PATHS`, width - 61, height + 3),
      );
    }
    const hasChildren = hasCollapsibleChildren(node.id, state.graph.edges);
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
      if (
        event.button !== 0
        || event.shiftKey
        || event.target.closest?.(".collapse-toggle")
      ) return;
      this.beginNodeDrag(event, entry, group, state);
    });
    group.addEventListener("click", (event) => {
      if (this.suppressNodeClicks.has(node.id)) {
        event.stopPropagation();
        return;
      }
      if (event.shiftKey) {
        event.stopPropagation();
        this.callbacks.onToggleNodeSelection?.(node.id);
        return;
      }
      select();
    });
    group.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.shiftKey) {
        event.preventDefault();
        this.callbacks.onToggleNodeSelection?.(node.id);
        return;
      }
      select();
    });
    this.nodeLayer.append(group);
    this.nodeViews.set(node.id, { entry, group });
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
    const geometry = computeEdgeGeometry(view.entry, view.orientation);
    view.hitTarget.setAttribute("d", geometry.pathData);
    view.path.setAttribute("d", geometry.pathData);
    view.path.classList.toggle("geometry-feedback", geometry.routingRole === "feedback");
    view.path.setAttribute(
      "marker-end",
      `url(#arrow-${geometry.routingRole === "feedback"
        ? "feedback"
        : markerKind(view.entry.edge)})`,
    );
    view.edgeGroup.dataset.routingRole = geometry.routingRole;
    view.labelGroup.dataset.routingRole = geometry.routingRole;
    view.geometry = geometry;
  }

  layoutEdgeLabels(orientation) {
    const positions = placeEdgeLabels(this.edgeViews.values(), orientation);
    for (const [edgeId, position] of positions) {
      this.edgeViews
        .get(edgeId)
        ?.labelGroup.setAttribute("transform", `translate(${position.x} ${position.y})`);
    }
  }

  beginNodeDrag(event, entry, group, state) {
    event.stopPropagation();
    const dragIds = state.selectedNodeIds.has(entry.node.id)
      ? [...state.selectedNodeIds].filter((nodeId) => this.nodeViews.has(nodeId))
      : [entry.node.id];
    const members = dragIds.map((nodeId) => {
      const view = this.nodeViews.get(nodeId);
      return {
        id: nodeId,
        entry: view.entry,
        group: view.group,
        originX: view.entry.x,
        originY: view.entry.y,
      };
    });
    this.nodeDrag = {
      id: entry.node.id,
      members,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    group.setPointerCapture(event.pointerId);
    for (const member of members) member.group.classList.add("dragging");
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

  getViewport() {
    return { ...this.transform };
  }

  setViewport(viewport) {
    if (
      !Number.isFinite(viewport?.x)
      || !Number.isFinite(viewport?.y)
      || !Number.isFinite(viewport?.scale)
      || viewport.scale <= 0
    ) return false;
    this.transform = {
      x: viewport.x,
      y: viewport.y,
      scale: viewport.scale,
    };
    this.applyTransform();
    return true;
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
    let marquee = null;
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
      if (event.button !== 0) return;
      if (event.target.closest?.(".graph-node, .graph-edge-group")) return;
      event.preventDefault();
      suppressCanvasClick = false;
      if (event.shiftKey) {
        marquee = {
          start: { x: event.clientX, y: event.clientY },
          end: { x: event.clientX, y: event.clientY },
          moved: false,
        };
        this.marqueeRect?.classList.add("active");
        this.svg.parentElement.classList.add("marquee-selecting");
        this.updateMarqueeRectangle(marquee);
        this.svg.setPointerCapture(event.pointerId);
        return;
      }
      drag = {
        x: event.clientX,
        y: event.clientY,
        originX: this.transform.x,
        originY: this.transform.y,
        moved: false,
      };
      this.svg.setPointerCapture(event.pointerId);
      this.svg.parentElement.classList.add("dragging");
    });
    this.svg.addEventListener("pointermove", (event) => {
      if (this.nodeDrag) {
        event.preventDefault();
        const deltaX = (event.clientX - this.nodeDrag.startX) / this.transform.scale;
        const deltaY = (event.clientY - this.nodeDrag.startY) / this.transform.scale;
        if (Math.hypot(deltaX, deltaY) >= dragThreshold) this.nodeDrag.moved = true;
        const movedIds = new Set();
        for (const member of this.nodeDrag.members) {
          member.entry.x = member.originX + deltaX;
          member.entry.y = member.originY + deltaY;
          member.group.setAttribute(
            "transform",
            `translate(${member.entry.x} ${member.entry.y})`,
          );
          movedIds.add(member.id);
        }
        for (const view of this.edgeViews.values()) {
          if (
            movedIds.has(view.entry.edge.from)
            || movedIds.has(view.entry.edge.to)
          ) {
            this.updateEdgeView(view);
          }
        }
        this.layoutEdgeLabels(this.orientation);
        return;
      }
      if (marquee) {
        event.preventDefault();
        marquee.end = { x: event.clientX, y: event.clientY };
        if (
          Math.hypot(
            marquee.end.x - marquee.start.x,
            marquee.end.y - marquee.start.y,
          ) >= dragThreshold
        ) {
          marquee.moved = true;
        }
        this.updateMarqueeRectangle(marquee);
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
        for (const member of completed.members) {
          member.group.classList.remove("dragging");
        }
        this.svg.parentElement.classList.remove("node-dragging");
        this.nodeDrag = null;
        if (completed.moved && event.type === "pointerup") {
          const suppressed = new Set(completed.members.map((member) => member.id));
          this.suppressNodeClicks = suppressed;
          this.callbacks.onNodesMove?.(Object.fromEntries(
            completed.members.map((member) => [
              member.id,
              { x: member.entry.x, y: member.entry.y },
            ]),
          ));
          window.setTimeout(() => {
            if (this.suppressNodeClicks === suppressed) {
              this.suppressNodeClicks = new Set();
            }
          }, 0);
        } else {
          const restoredIds = new Set();
          for (const member of completed.members) {
            member.entry.x = member.originX;
            member.entry.y = member.originY;
            member.group.setAttribute(
              "transform",
              `translate(${member.originX} ${member.originY})`,
            );
            restoredIds.add(member.id);
          }
          for (const view of this.edgeViews.values()) {
            if (
              restoredIds.has(view.entry.edge.from)
              || restoredIds.has(view.entry.edge.to)
            ) {
              this.updateEdgeView(view);
            }
          }
          this.layoutEdgeLabels(this.orientation);
        }
        return;
      }
      if (marquee) {
        const completed = marquee;
        marquee = null;
        this.marqueeRect?.classList.remove("active");
        this.svg.parentElement.classList.remove("marquee-selecting");
        suppressCanvasClick =
          event.type === "pointerup" && Boolean(completed.moved);
        if (suppressCanvasClick) {
          this.callbacks.onSetNodeSelection?.(
            nodeIdsWithinRectangle(
              normalizeScreenRectangle(completed.start, completed.end),
              [...this.nodeViews.entries()].map(([id, view]) => {
                const box = view.group.getBoundingClientRect();
                return {
                  id,
                  centerX: box.left + box.width / 2,
                  centerY: box.top + box.height / 2,
                };
              }),
            ),
          );
        }
        return;
      }
      suppressCanvasClick = event.type === "pointerup" && Boolean(drag?.moved);
      if (event.type === "pointercancel" && drag?.moved) {
        this.transform.x = drag.originX;
        this.transform.y = drag.originY;
        this.applyTransform();
      }
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
      if (event.target === this.svg) {
        this.callbacks.onClearInteractionSelection?.();
      }
    });
  }

  updateMarqueeRectangle(marquee) {
    if (!this.marqueeRect) return;
    const svgBox = this.svg.getBoundingClientRect();
    const rectangle = normalizeScreenRectangle(marquee.start, marquee.end);
    this.marqueeRect.setAttribute("x", String(rectangle.left - svgBox.left));
    this.marqueeRect.setAttribute("y", String(rectangle.top - svgBox.top));
    this.marqueeRect.setAttribute("width", String(rectangle.right - rectangle.left));
    this.marqueeRect.setAttribute("height", String(rectangle.bottom - rectangle.top));
  }

}

function markerKind(edge) {
  return markerColorVariables[edge.kind] ? edge.kind : "direct";
}

export function computeEdgeGeometry(
  {
    from,
    to,
    routingRole = "forward",
    feedbackLane = 0,
    bounds = null,
  },
  orientation,
) {
  const vertical = orientation === "vertical";
  const progression = vertical
    ? to.y - (from.y + from.height)
    : to.x - (from.x + from.width);
  if (routingRole === "feedback" || progression <= 0) {
    return feedbackGeometry(
      { from, to, feedbackLane, bounds: bounds || boundsForPair(from, to) },
      orientation,
    );
  }
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
    routingRole: "forward",
  };
}

function feedbackGeometry({ from, to, feedbackLane, bounds }, orientation) {
  const vertical = orientation === "vertical";
  const side = feedbackLane % 2 === 0 ? -1 : 1;
  const lane = Math.floor(feedbackLane / 2);
  const offset = 48 + lane * 26;
  if (vertical) {
    const channel = side < 0
      ? bounds.x - offset
      : bounds.x + bounds.width + offset;
    const start = {
      x: side < 0 ? from.x : from.x + from.width,
      y: from.y + from.height / 2,
    };
    const end = {
      x: side < 0 ? to.x : to.x + to.width,
      y: to.y + to.height / 2,
    };
    return {
      pathData:
        `M ${start.x} ${start.y} H ${channel} V ${end.y} H ${end.x}`,
      midpoint: { x: channel, y: (start.y + end.y) / 2 },
      routingRole: "feedback",
      channel,
      side,
    };
  }
  const channel = side < 0
    ? bounds.y - offset
    : bounds.y + bounds.height + offset;
  const start = {
    x: from.x + from.width / 2,
    y: side < 0 ? from.y : from.y + from.height,
  };
  const end = {
    x: to.x + to.width / 2,
    y: side < 0 ? to.y : to.y + to.height,
  };
  return {
    pathData:
      `M ${start.x} ${start.y} V ${channel} H ${end.x} V ${end.y}`,
    midpoint: { x: (start.x + end.x) / 2, y: channel },
    routingRole: "feedback",
    channel,
    side,
  };
}

function boundsForPair(from, to) {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const right = Math.max(from.x + from.width, to.x + to.width);
  const bottom = Math.max(from.y + from.height, to.y + to.height);
  return { x, y, width: right - x, height: bottom - y };
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


function visibleControlDegrees(nodes, edges) {
  const result = new Map(
    nodes.map((node) => [node.id, { incoming: 0, outgoing: 0 }]),
  );
  for (const edge of edges) {
    if (!isControlEdge(edge)) continue;
    const from = result.get(edge.from);
    const to = result.get(edge.to);
    if (from && to) {
      from.outgoing += 1;
      to.incoming += 1;
    }
  }
  return result;
}

export function hasCollapsibleChildren(nodeId, edges) {
  return edges.some(
    (edge) =>
      edge.from === nodeId
      && isControlEdge(edge)
      && edge.flowKind !== "loop-back",
  );
}

function structureMarker(kind, label, x, y) {
  const group = svgElement("g", {
    class: `node-structure-marker ${kind}`,
    transform: `translate(${x} ${y})`,
    [`data-${kind}-count`]: label.match(/\d+/)?.[0] || "0",
  });
  group.append(
    svgElement("rect", { width: "54", height: "15", rx: "2" }),
  );
  addText(group, label, 27, 10.5, "node-structure-label", "middle");
  return group;
}

function normalizeSelectionFocus(selectionFocus) {
  return {
    active: Boolean(selectionFocus?.active),
    originNodeId: selectionFocus?.originNodeId || null,
    originEdgeId: selectionFocus?.originEdgeId || null,
    nodeIds: selectionFocus?.focusNodeIds instanceof Set
      ? selectionFocus.focusNodeIds
      : new Set(selectionFocus?.focusNodeIds || []),
    edgeIds: selectionFocus?.focusEdgeIds instanceof Set
      ? selectionFocus.focusEdgeIds
      : new Set(selectionFocus?.focusEdgeIds || []),
  };
}

function focusClass(active, focused) {
  if (!active) return "";
  return focused ? " path-focused" : " path-dimmed";
}

function focusData(active, focused) {
  if (!active) return "none";
  return focused ? "focused" : "dimmed";
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
