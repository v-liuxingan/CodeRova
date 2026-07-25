const SVG_NS = "http://www.w3.org/2000/svg";
const TOPOLOGY_WIDTH = 1000;
const TOPOLOGY_HEIGHT = 520;
const TOPOLOGY_SINGLE_ROW_HEIGHT = 300;
const PHASE_NODE_WIDTH = 210;
const PHASE_NODE_HEIGHT = 118;
const FLOW_PRIORITY = [
  "loop-back",
  "loop-exit",
  "fallback",
  "branch",
  "merge",
  "normal",
];
const PHASE_ROLE_LABELS = {
  entry: "入口",
  decision: "判断",
  branch: "分支",
  loop: "回环",
  terminal: "结果",
};

export class PhaseNavigator {
  constructor(root, { onSelect } = {}) {
    this.root = root;
    this.onSelect = onSelect;
    this.topology = emptyTopology();
    this.viewport = { x: 0, y: 0, scale: 1 };
    this.viewportGroup = null;
    this.svg = null;
  }

  render(graph) {
    this.topology = buildPhaseTopology(graph);
    this.viewport = { x: 0, y: 0, scale: 1 };
    this.root.replaceChildren();
    this.root.hidden = true;
    if (!this.topology.phases.length) return;
    this.root.dataset.phaseRows = String(this.topology.rows);

    const heading = document.createElement("div");
    heading.className = "phase-navigator-heading";
    const eyebrow = document.createElement("span");
    eyebrow.textContent = "SCENARIO TOPOLOGY";
    const title = document.createElement("strong");
    title.textContent = "场景地图";
    const facts = document.createElement("small");
    const loopCount = this.topology.displayRelations.filter(
      (relation) => relation.flowKinds.includes("loop-back"),
    ).length;
    facts.textContent = "主干 · 分支 · 回环";
    heading.title =
      `显示 ${this.topology.displayRelations.length} 条关键场景关系`
      + `，${this.topology.relations.length - this.topology.displayRelations.length}`
      + ` 条普通跨阶段捷径保留在主图；${loopCount} 条明确回环。`;
    heading.append(eyebrow, title, facts);

    const viewport = document.createElement("div");
    viewport.className = "phase-topology-viewport";
    const plane = document.createElement("div");
    plane.className = "phase-topology-plane";
    plane.style.setProperty("--phase-count", String(this.topology.phases.length));
    plane.style.setProperty("--phase-columns", String(this.topology.columns));
    plane.style.setProperty("--phase-rows", String(this.topology.rows));
    plane.dataset.columns = String(this.topology.columns);
    plane.dataset.rows = String(this.topology.rows);
    plane.dataset.totalRelations = String(this.topology.relations.length);
    plane.dataset.visibleRelations = String(this.topology.displayRelations.length);
    plane.append(this.renderTopologyGraph());
    viewport.append(plane);
    this.root.append(heading, viewport);
  }

  renderTopologyGraph() {
    const svg = document.createElementNS(SVG_NS, "svg");
    const height = topologyHeight(this.topology);
    const width = TOPOLOGY_WIDTH;
    const nodeWidth = phaseNodeWidth(this.topology, width);
    svg.classList.add("phase-topology-graph");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", "场景阶段调用拓扑");

    const definitions = document.createElementNS(SVG_NS, "defs");
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "phase-topology-arrow");
    marker.setAttribute("viewBox", "0 0 8 8");
    marker.setAttribute("refX", "7");
    marker.setAttribute("refY", "4");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("orient", "auto");
    const markerPath = document.createElementNS(SVG_NS, "path");
    markerPath.setAttribute("d", "M 0 0 L 8 4 L 0 8 z");
    markerPath.setAttribute("fill", "context-stroke");
    marker.append(markerPath);
    definitions.append(marker);
    svg.append(definitions);

    const viewportGroup = document.createElementNS(SVG_NS, "g");
    viewportGroup.classList.add("phase-map-viewport");
    const edgeLayer = document.createElementNS(SVG_NS, "g");
    edgeLayer.classList.add("phase-topology-links");
    this.topology.displayRelations.forEach((relation, index) => {
      const path = document.createElementNS(SVG_NS, "path");
      path.classList.add(
        "phase-relation",
        `phase-relation-${relation.layoutKind}`,
        `phase-relation-${relation.primaryFlowKind}`,
      );
      path.dataset.fromPhaseId = relation.from;
      path.dataset.toPhaseId = relation.to;
      path.dataset.flowKinds = relation.flowKinds.join(" ");
      path.dataset.edgeCount = String(relation.edgeIds.length);
      path.setAttribute(
        "d",
        phaseRelationPath(
          relation,
          this.topology,
          index,
          width,
          nodeWidth,
        ),
      );
      path.setAttribute("marker-end", "url(#phase-topology-arrow)");
      edgeLayer.append(path);
    });
    viewportGroup.append(edgeLayer);

    const nodeLayer = document.createElementNS(SVG_NS, "g");
    nodeLayer.classList.add("phase-topology-nodes");
    for (const phase of this.topology.phases) {
      const center = phaseCenter(phase.position, this.topology, width);
      const node = document.createElementNS(SVG_NS, "g");
      node.classList.add(
        "phase-node",
        "phase-graph-node",
        `phase-node-${phase.topologyRole}`,
        `phase-graph-node-${phase.topologyRole}`,
      );
      node.dataset.phaseId = phase.id;
      node.dataset.topologyRole = phase.topologyRole;
      node.setAttribute(
        "transform",
        `translate(${center.x - nodeWidth / 2} ${center.y - PHASE_NODE_HEIGHT / 2})`,
      );
      node.setAttribute("role", "button");
      node.setAttribute("tabindex", "0");
      node.setAttribute("aria-pressed", "false");
      node.setAttribute("aria-label", `${phase.title}：${phase.summary || phase.title}`);
      node.append(
        svgElement("rect", {
          class: "phase-node-box",
          width: nodeWidth,
          height: PHASE_NODE_HEIGHT,
          rx: 4,
        }),
        svgElement("rect", {
          class: "phase-node-accent",
          width: 3,
          height: PHASE_NODE_HEIGHT,
          rx: 1.5,
        }),
        ...renderPhasePorts(nodeWidth),
      );

      const index = svgElement("text", {
        class: "phase-node-index",
        x: 16,
        y: 21,
      });
      index.textContent =
        PHASE_ROLE_LABELS[phase.topologyRole] || `P${phase.order}`;
      const label = svgElement("text", {
        class: "phase-node-title",
        x: 16,
        y: 47,
      });
      label.textContent = phase.title;
      const summary = svgElement("text", {
        class: "phase-node-summary",
        x: 16,
        y: 70,
      });
      splitPhaseSummary(phase.summary || phase.title, nodeWidth).forEach(
        (line, lineIndex) => {
          const textLine = svgElement("tspan", {
            x: 16,
            dy: lineIndex === 0 ? 0 : 17,
          });
          textLine.textContent = line;
          summary.append(textLine);
        },
      );
      node.append(index, label, summary);
      if (phase.routeHint) {
        const routeHint = svgElement("text", {
          class: "phase-node-route",
          x: 16,
          y: 105,
        });
        routeHint.textContent = phase.routeHint;
        node.append(routeHint);
      }
      const tooltipText = [
        phaseTooltip(phase),
        phase.routeHintTitle || phase.routeHint || "",
      ].filter(Boolean).join("\n");
      const tooltip = svgElement("title");
      tooltip.textContent = tooltipText;
      node.setAttribute("title", tooltipText);
      node.prepend(tooltip);
      node.addEventListener("click", () => this.onSelect?.(phase.id));
      node.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.onSelect?.(phase.id);
      });
      nodeLayer.append(node);
    }
    viewportGroup.append(nodeLayer);
    svg.append(viewportGroup);
    this.svg = svg;
    this.viewportGroup = viewportGroup;
    this.applyViewport();
    this.bindViewportEvents(svg);
    return svg;
  }

  hasPhases() {
    return this.topology.phases.length > 0;
  }

  setVisible(visible) {
    this.root.hidden = !visible || !this.hasPhases();
  }

  setActive(phaseId) {
    this.root.querySelectorAll(".phase-node").forEach((button) => {
      const active = button.dataset.phaseId === phaseId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  fit() {
    this.viewport = { x: 0, y: 0, scale: 1 };
    this.applyViewport();
  }

  zoomBy(factor, center = null) {
    const logicalCenter = center || {
      x: TOPOLOGY_WIDTH / 2,
      y: topologyHeight(this.topology) / 2,
    };
    const nextScale = Math.min(2.6, Math.max(0.55, this.viewport.scale * factor));
    const worldX = (logicalCenter.x - this.viewport.x) / this.viewport.scale;
    const worldY = (logicalCenter.y - this.viewport.y) / this.viewport.scale;
    this.viewport.x = logicalCenter.x - worldX * nextScale;
    this.viewport.y = logicalCenter.y - worldY * nextScale;
    this.viewport.scale = nextScale;
    this.applyViewport();
  }

  getViewport() {
    return { ...this.viewport };
  }

  setViewport(viewport) {
    if (
      !Number.isFinite(viewport?.x)
      || !Number.isFinite(viewport?.y)
      || !Number.isFinite(viewport?.scale)
      || viewport.scale <= 0
    ) return false;
    this.viewport = { ...viewport };
    this.applyViewport();
    return true;
  }

  applyViewport() {
    this.viewportGroup?.setAttribute(
      "transform",
      `translate(${this.viewport.x} ${this.viewport.y}) scale(${this.viewport.scale})`,
    );
  }

  bindViewportEvents(svg) {
    let drag = null;
    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.zoomBy(
        event.deltaY < 0 ? 1.12 : 0.89,
        this.svgPoint(event.clientX, event.clientY),
      );
    }, { passive: false });
    svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest?.(".phase-node")) return;
      event.preventDefault();
      drag = {
        clientX: event.clientX,
        clientY: event.clientY,
        x: this.viewport.x,
        y: this.viewport.y,
      };
      svg.setPointerCapture(event.pointerId);
      this.root.classList.add("dragging");
    });
    svg.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const matrix = svg.getScreenCTM();
      const scaleX = matrix?.a || 1;
      const scaleY = matrix?.d || scaleX;
      this.viewport.x = drag.x + (event.clientX - drag.clientX) / scaleX;
      this.viewport.y = drag.y + (event.clientY - drag.clientY) / scaleY;
      this.applyViewport();
    });
    const endDrag = (event) => {
      if (!drag) return;
      drag = null;
      if (svg.hasPointerCapture(event.pointerId)) {
        svg.releasePointerCapture(event.pointerId);
      }
      this.root.classList.remove("dragging");
    };
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointercancel", endDrag);
  }

  svgPoint(clientX, clientY) {
    const matrix = this.svg?.getScreenCTM();
    if (!matrix) {
      return {
        x: TOPOLOGY_WIDTH / 2,
        y: topologyHeight(this.topology) / 2,
      };
    }
    return new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  }
}

export function buildPhaseTopology(graph) {
  const phases = [...(graph.phases || [])]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((phase, index) => ({ ...phase, index, signals: new Set() }));
  if (!phases.length) return emptyTopology();

  const phaseById = new Map(phases.map((phase) => [phase.id, phase]));
  const nodePhase = new Map(
    (graph.nodes || [])
      .filter((node) => phaseById.has(node.phaseId))
      .map((node) => [node.id, node.phaseId]),
  );
  const relationByPair = new Map();

  for (const edge of graph.edges || []) {
    const from = nodePhase.get(edge.from);
    const to = nodePhase.get(edge.to);
    if (!from || !to) continue;
    const flowKind = edge.flowKind || "normal";
    if (flowKind !== "normal") {
      phaseById.get(from).signals.add(flowKind);
      if (flowKind === "merge") phaseById.get(to).signals.add(flowKind);
    }
    if (from === to) continue;

    const key = `${from}\u0000${to}`;
    let relation = relationByPair.get(key);
    if (!relation) {
      relation = {
        from,
        to,
        edgeIds: [],
        flowKinds: new Set(),
        callKinds: new Set(),
        conditions: new Set(),
        labels: new Set(),
      };
      relationByPair.set(key, relation);
    }
    relation.edgeIds.push(edge.id);
    relation.flowKinds.add(flowKind);
    relation.callKinds.add(edge.kind);
    if (edge.condition) relation.conditions.add(edge.condition);
    if (edge.label) relation.labels.add(edge.label);
  }

  const relations = [...relationByPair.values()]
    .map((relation) => {
      const fromPhase = phaseById.get(relation.from);
      const toPhase = phaseById.get(relation.to);
      const flowKinds = [...relation.flowKinds].sort(
        (left, right) => FLOW_PRIORITY.indexOf(left) - FLOW_PRIORITY.indexOf(right),
      );
      const span = Math.abs(toPhase.index - fromPhase.index);
      const backwards = toPhase.index <= fromPhase.index;
      const primaryFlowKind = flowKinds[0] || "normal";
      return {
        ...relation,
        flowKinds,
        callKinds: [...relation.callKinds].sort(),
        conditions: [...relation.conditions].sort(),
        labels: [...relation.labels].sort(),
        fromIndex: fromPhase.index,
        toIndex: toPhase.index,
        span,
        primaryFlowKind,
        layoutKind: backwards
          ? "feedback"
          : span === 1
            ? "spine"
            : "shortcut",
      };
    })
    .sort(comparePhaseRelations);

  for (const relation of relations) {
    if (relation.primaryFlowKind !== "normal") {
      phaseById.get(relation.from).signals.add(relation.primaryFlowKind);
    }
  }

  const displayRelations = relations.filter(
    (relation) =>
      relation.layoutKind === "spine"
      || relation.primaryFlowKind !== "normal",
  );

  const phasesWithRoles = phases.map((phase) => ({
    ...phase,
    signals: [...phase.signals].sort(
      (left, right) => FLOW_PRIORITY.indexOf(left) - FLOW_PRIORITY.indexOf(right),
    ),
    topologyRole: phaseTopologyRole(phase, displayRelations),
  }));
  const { columns, rows, positions } = phaseGrid(phasesWithRoles);
  const positionedPhases = phasesWithRoles.map((phase, index) => ({
    ...phase,
    position: positions[index],
  }));
  const positionedPhaseById = new Map(
    positionedPhases.map((phase) => [phase.id, phase]),
  );
  const positionedRelations = relations
    .map((relation) => {
      const fromPhase = positionedPhaseById.get(relation.from);
      const toPhase = positionedPhaseById.get(relation.to);
      const outcome =
        fromPhase.topologyRole === "decision"
        && toPhase.topologyRole === "terminal";
      return {
        ...relation,
        fromPosition: fromPhase.position,
        toPosition: toPhase.position,
        layoutKind: outcome ? "outcome" : relation.layoutKind,
        displayLabel: semanticRelationLabel(relation),
      };
    })
    .sort(comparePhaseRelations);
  const positionedDisplayRelations = positionedRelations.filter(
    (relation) =>
      relation.layoutKind === "spine"
      || relation.layoutKind === "outcome"
      || relation.primaryFlowKind !== "normal",
  );

  const finalPhases = positionedPhases.map((phase) => {
    const route = phaseRouteHint(phase, positionedDisplayRelations);
    return { ...phase, ...route };
  });

  return {
    phases: finalPhases,
    relations: positionedRelations,
    displayRelations: positionedDisplayRelations,
    columns,
    rows,
  };
}

function phaseRelationPath(
  relation,
  topology,
  relationIndex,
  width,
  nodeWidth,
) {
  const from = phaseCenter(relation.fromPosition, topology, width);
  const to = phaseCenter(relation.toPosition, topology, width);
  const horizontalDirection = Math.sign(to.x - from.x);
  const verticalDirection = Math.sign(to.y - from.y);
  if (relation.fromPosition.row === relation.toPosition.row) {
    return [
      "M", from.x + horizontalDirection * nodeWidth / 2, from.y,
      "L", to.x - horizontalDirection * (nodeWidth / 2 + 3), to.y,
    ].join(" ");
  }
  if (relation.fromPosition.column === relation.toPosition.column) {
    return [
      "M", from.x, from.y + verticalDirection * PHASE_NODE_HEIGHT / 2,
      "L", to.x, to.y - verticalDirection * (PHASE_NODE_HEIGHT / 2 + 3),
    ].join(" ");
  }

  const startY = from.y + verticalDirection * PHASE_NODE_HEIGHT / 2;
  const endY = to.y - verticalDirection * (PHASE_NODE_HEIGHT / 2 + 3);
  const middleY = (startY + endY) / 2 + (relationIndex % 2 ? 2 : -2);
  if (relation.layoutKind === "feedback") {
    return [
      "M", from.x, startY,
      "C", from.x, middleY, to.x, middleY, to.x, endY,
    ].join(" ");
  }
  return [
    "M", from.x, startY,
    "C", from.x, middleY, to.x, middleY, to.x, endY,
  ].join(" ");
}

function comparePhaseRelations(left, right) {
  if (left.layoutKind !== right.layoutKind) {
    const order = { spine: 0, outcome: 1, shortcut: 2, feedback: 3 };
    return order[left.layoutKind] - order[right.layoutKind];
  }
  if (left.fromIndex !== right.fromIndex) return left.fromIndex - right.fromIndex;
  if (left.toIndex !== right.toIndex) return left.toIndex - right.toIndex;
  return left.from.localeCompare(right.from) || left.to.localeCompare(right.to);
}

function semanticRelationLabel(relation) {
  if (
    relation.primaryFlowKind === "normal"
    || relation.primaryFlowKind === "merge"
  ) {
    return "";
  }
  if (relation.labels.length === 1) return relation.labels[0];
  const labels = {
    branch: "进入分支",
    fallback: "使用降级路径",
    "loop-back": "携带结果继续",
    "loop-exit": "完成当前流程",
  };
  return labels[relation.primaryFlowKind] || "";
}

function renderPhasePorts(nodeWidth) {
  return [
    [0, PHASE_NODE_HEIGHT / 2],
    [nodeWidth, PHASE_NODE_HEIGHT / 2],
    [nodeWidth / 2, 0],
    [nodeWidth / 2, PHASE_NODE_HEIGHT],
  ].map(([cx, cy]) => svgElement("circle", {
    class: "phase-node-port",
    cx,
    cy,
    r: 3.5,
  }));
}

function topologyHeight(topology) {
  return topology.rows === 1 ? TOPOLOGY_SINGLE_ROW_HEIGHT : TOPOLOGY_HEIGHT;
}

function phaseCenter(position, topology, width) {
  const cellWidth = width / topology.columns;
  const height = topologyHeight(topology);
  const rowHeight = height / topology.rows;
  return {
    x: cellWidth * (position.column + 0.5),
    y: rowHeight * (position.row + 0.5),
  };
}

function phaseNodeWidth(topology, width) {
  return Math.min(
    PHASE_NODE_WIDTH,
    Math.max(64, width / topology.columns - 24),
  );
}

function splitPhaseSummary(value, nodeWidth) {
  const characters = Array.from(value || "");
  const limit = Math.max(10, Math.floor((nodeWidth - 32) / 11));
  const lines = [];
  while (characters.length && lines.length < 2) {
    lines.push(characters.splice(0, limit).join(""));
  }
  if (characters.length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`;
  }
  return lines;
}

function svgElement(tagName, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tagName);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function phaseTooltip(phase) {
  const signalLabels = [];
  if (phase.signals.includes("branch") || phase.signals.includes("fallback")) {
    signalLabels.push("分支");
  }
  if (phase.signals.includes("merge")) signalLabels.push("汇合");
  if (phase.signals.includes("loop-back")) signalLabels.push("回环");
  if (phase.signals.includes("loop-exit")) signalLabels.push("退出");
  return [
    phase.summary || phase.title,
    signalLabels.length ? `结构：${signalLabels.join("、")}` : "",
  ].filter(Boolean).join("\n");
}

function emptyTopology() {
  return {
    phases: [],
    relations: [],
    displayRelations: [],
    columns: 0,
    rows: 0,
  };
}

function phaseTopologyRole(phase, displayRelations) {
  const outgoing = displayRelations.filter((relation) => relation.from === phase.id);
  const incoming = displayRelations.filter((relation) => relation.to === phase.id);
  if (phase.index === 0) return "entry";
  if (!outgoing.length) return "terminal";
  const semanticTargets = new Set(
    outgoing
      .filter((relation) => relation.primaryFlowKind !== "normal")
      .map((relation) => relation.to),
  );
  if (semanticTargets.size > 1) return "decision";
  if (outgoing.some((relation) => relation.primaryFlowKind === "loop-back")) {
    return "loop";
  }
  if (
    incoming.some((relation) =>
      relation.primaryFlowKind === "branch"
      || relation.primaryFlowKind === "fallback")
  ) {
    return "branch";
  }
  return "action";
}

function phaseRouteHint(phase, displayRelations) {
  const incoming = displayRelations.filter(
    (relation) =>
      relation.to === phase.id
      && relation.displayLabel,
  );
  const loopBacks = incoming.filter(
    (relation) => relation.primaryFlowKind === "loop-back",
  );
  if (loopBacks.length > 1) {
    return {
      routeHint: `${loopBacks.length} 条回环在此重试`,
      routeHintTitle: loopBacks.map((relation) => relation.displayLabel).join("\n"),
    };
  }
  if (incoming.length === 1) {
    return {
      routeHint: incoming[0].displayLabel,
      routeHintTitle:
        incoming[0].conditions.join("\n") || incoming[0].displayLabel,
    };
  }
  return { routeHint: "", routeHintTitle: "" };
}

function phaseGrid(phases) {
  const count = phases.length;
  if (!count) return { columns: 0, rows: 0, positions: [] };
  const decision = phases.find((phase) => phase.topologyRole === "decision");
  const terminal = phases.find((phase) => phase.topologyRole === "terminal");
  const branchPhases = decision
    ? phases.filter(
      (phase) => phase.index > decision.index && phase.id !== terminal?.id,
    )
    : [];
  if (
    decision
    && terminal
    && decision.index <= 3
    && branchPhases.length <= decision.index + 1
  ) {
    const columns = decision.index + 1;
    const positionById = new Map();
    phases
      .filter((phase) => phase.index <= decision.index)
      .forEach((phase) => {
        positionById.set(phase.id, { column: phase.index, row: 0 });
      });
    positionById.set(terminal.id, { column: columns - 1, row: 1 });
    branchPhases.forEach((phase, index) => {
      positionById.set(phase.id, {
        column: decision.index - index - 1,
        row: 1,
      });
    });
    return {
      columns,
      rows: 2,
      positions: phases.map((phase) => positionById.get(phase.id)),
    };
  }

  const rows = count > 4 ? 2 : 1;
  const columns = Math.ceil(count / rows);
  const positions = Array.from({ length: count }, (_, index) => (
    rows === 1 || index < columns
      ? { column: index, row: 0 }
      : { column: columns - 1 - (index - columns), row: 1 }
  ));
  return { columns, rows, positions };
}
