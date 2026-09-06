import { renderExecutionContext, scenarioExecutionContext } from "./execution-context.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const LANE_WIDTH = 260;
const LANE_GAP = 34;
const STEP_WIDTH = 210;
const STEP_HEIGHT = 118;
const STEP_GAP = 48;
const TOP = 122;
const LEFT = 30;

const STEP_KIND_LABELS = {
  entry: "入口",
  operation: "操作",
  message: "事件",
  handler: "处理器",
  decision: "决策",
  retry: "重试",
  outcome: "结果",
  external: "外部",
};

const LINK_KIND_LABELS = {
  call: "调用",
  request: "请求",
  publish: "发布",
  route: "路由",
  deliver: "投递",
  consume: "消费",
  reply: "响应",
  retry: "重试",
  timeout: "超时",
  compensate: "补偿",
  "state-dependency": "状态依赖",
};

export class ArchitectureScenarioNavigator {
  constructor(root, { onDrilldown } = {}) {
    this.root = root;
    this.onDrilldown = onDrilldown;
    this.zoom = 1;
    this.selectedStepId = null;
  }

  hasScenario() {
    return Boolean(this.scenario);
  }

  clear() {
    this.scenario = null;
    this.selectedStepId = null;
    this.root.replaceChildren();
    this.root.hidden = true;
  }

  setVisible(visible) {
    this.root.hidden = !visible || !this.hasScenario();
  }

  render(scenario) {
    this.scenario = scenario;
    this.zoom = 1;
    this.selectedStepId = scenario.steps[0]?.id || null;
    this.root.replaceChildren();

    const heading = document.createElement("header");
    heading.className = "architecture-scenario-heading";
    const eyebrow = document.createElement("span");
    eyebrow.textContent = "ARCHITECTURE SCENARIO";
    const title = document.createElement("strong");
    title.textContent = scenario.title;
    const goal = document.createElement("small");
    goal.textContent = scenario.goal;
    heading.append(eyebrow, title, goal);

    const viewport = document.createElement("div");
    viewport.className = "architecture-scenario-viewport";
    const plane = document.createElement("div");
    plane.className = "architecture-scenario-plane";
    viewport.append(plane);

    const detail = document.createElement("aside");
    detail.className = "architecture-step-detail";
    detail.setAttribute("aria-live", "polite");

    this.root.append(heading, viewport, detail);
    this.viewport = viewport;
    this.plane = plane;
    this.detail = detail;
    this.layout = buildScenarioLayout(scenario);
    this.draw();
    this.select(this.selectedStepId);
    requestAnimationFrame(() => this.fit());
  }

  zoomBy(factor) {
    if (!this.plane) return;
    this.zoom = Math.min(1.55, Math.max(0.62, this.zoom * factor));
    this.plane.style.transform = `scale(${this.zoom})`;
  }

  fit() {
    if (!this.plane || !this.viewport) return;
    const bounds = this.layout;
    const scale = Math.min(
      1,
      (this.viewport.clientWidth - 56) / bounds.width,
      (this.viewport.clientHeight - 46) / bounds.height,
    );
    this.zoom = Number.isFinite(scale) ? Math.max(0.62, scale) : 1;
    this.plane.style.transform = `scale(${this.zoom})`;
    this.viewport.scrollTo({ left: 0, top: 0 });
  }

  draw() {
    const { scenario, layout, plane } = this;
    plane.style.width = `${layout.width}px`;
    plane.style.height = `${layout.height}px`;
    plane.style.transform = "scale(1)";

    const lanes = document.createElement("div");
    lanes.className = "architecture-lanes";
    for (const participant of scenario.participants) {
      const position = layout.participantPositions.get(participant.id);
      const lane = document.createElement("section");
      lane.className = `architecture-lane architecture-lane-${participant.kind}`;
      lane.style.left = `${position.x}px`;
      lane.style.width = `${LANE_WIDTH}px`;
      const heading = document.createElement("header");
      const kind = document.createElement("span");
      kind.textContent = participant.kind.replace("-", " ").toUpperCase();
      const title = document.createElement("strong");
      title.textContent = participant.label;
      heading.append(kind, title);
      lane.append(heading);
      lanes.append(lane);
    }

    const links = document.createElementNS(SVG_NS, "svg");
    links.setAttribute("class", "architecture-links");
    links.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    links.setAttribute("aria-hidden", "true");
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "architecture-arrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "8");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("orient", "auto-start-reverse");
    const markerPath = document.createElementNS(SVG_NS, "path");
    markerPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    marker.append(markerPath);
    const defs = document.createElementNS(SVG_NS, "defs");
    defs.append(marker);
    links.append(defs);
    for (const link of scenario.links) {
      const from = layout.steps.get(link.from);
      const to = layout.steps.get(link.to);
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("class", `architecture-link architecture-link-${link.kind}`);
      path.dataset.linkId = link.id;
      path.setAttribute("d", linkPath(from, to));
      path.setAttribute("marker-end", "url(#architecture-arrow)");
      links.append(path);

      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "architecture-link-label");
      label.setAttribute("x", String((from.x + to.x) / 2));
      label.setAttribute("y", String((from.y + to.y) / 2 - 10));
      label.setAttribute("text-anchor", "middle");
      label.textContent = link.label || LINK_KIND_LABELS[link.kind] || link.kind;
      links.append(label);
    }

    const steps = document.createElement("div");
    steps.className = "architecture-steps";
    for (const step of scenario.steps) {
      const position = layout.steps.get(step.id);
      const card = document.createElement("button");
      card.type = "button";
      card.className = `architecture-step architecture-step-${step.kind}`;
      card.dataset.stepId = step.id;
      card.style.left = `${position.x}px`;
      card.style.top = `${position.y}px`;
      const kind = document.createElement("span");
      kind.className = "architecture-step-kind";
      kind.textContent = STEP_KIND_LABELS[step.kind] || step.kind;
      const title = document.createElement("strong");
      title.textContent = step.label;
      const summary = document.createElement("small");
      summary.textContent = step.summary || "没有补充说明";
      const evidence = document.createElement("em");
      const drilldowns = step.drilldowns || [];
      evidence.textContent = drilldowns.length
        ? `${drilldowns.length} 个实现下钻`
        : "架构语义节点";
      card.append(kind, title, summary, evidence);
      card.addEventListener("click", () => this.select(step.id));
      steps.append(card);
    }
    plane.append(lanes, links, steps);
  }

  select(stepId) {
    const step = this.scenario.steps.find((candidate) => candidate.id === stepId);
    if (!step) return;
    this.selectedStepId = stepId;
    this.root.querySelectorAll(".architecture-step").forEach((card) => {
      card.classList.toggle("active", card.dataset.stepId === stepId);
    });
    const adjacent = new Set(this.scenario.links.filter((link) => link.from === stepId || link.to === stepId).map((link) => link.id));
    this.root.querySelectorAll(".architecture-link").forEach((path) => {
      path.classList.toggle("reading-active", adjacent.has(path.dataset.linkId));
    });
    this.detail.replaceChildren();
    const kind = document.createElement("span");
    kind.textContent = `${STEP_KIND_LABELS[step.kind] || step.kind} · ${participantLabel(this.scenario, step.participantId)}`;
    const title = document.createElement("strong");
    title.textContent = step.label;
    const summary = document.createElement("p");
    summary.textContent = step.summary || "此步骤没有额外说明。";
    this.detail.append(kind, title, summary);
    this.detail.append(renderExecutionContext(
      scenarioExecutionContext(step, this.scenario, LINK_KIND_LABELS),
      (target) => {
        this.select(target.id);
        this.root.querySelectorAll(".architecture-step").forEach((card) => {
          if (card.dataset.stepId === target.id) card.focus({ preventScroll: true });
        });
      },
    ));
    for (const drilldown of step.drilldowns || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "architecture-drilldown";
      button.textContent = `查看实现：${drilldown.graphSlug}`;
      button.title = drilldown.purpose;
      button.addEventListener("click", () => this.onDrilldown?.(step, drilldown));
      this.detail.append(button);
    }
  }
}

function buildScenarioLayout(scenario) {
  const participantPositions = new Map(
    scenario.participants.map((participant, index) => [participant.id, {
      x: LEFT + index * (LANE_WIDTH + LANE_GAP),
    }]),
  );
  const rank = new Map(scenario.steps.map((step) => [step.id, 0]));
  for (let iteration = 0; iteration < scenario.steps.length; iteration += 1) {
    for (const link of scenario.links) {
      rank.set(link.to, Math.max(rank.get(link.to) || 0, (rank.get(link.from) || 0) + 1));
    }
  }
  const steps = new Map(scenario.steps.map((step) => {
    const lane = participantPositions.get(step.participantId);
    const level = rank.get(step.id) || 0;
    return [step.id, {
      x: lane.x + (LANE_WIDTH - STEP_WIDTH) / 2,
      y: TOP + level * (STEP_HEIGHT + STEP_GAP),
    }];
  }));
  const maxRank = Math.max(0, ...rank.values());
  return {
    participantPositions,
    steps,
    width: LEFT * 2 + scenario.participants.length * LANE_WIDTH + Math.max(0, scenario.participants.length - 1) * LANE_GAP,
    height: TOP + (maxRank + 1) * STEP_HEIGHT + maxRank * STEP_GAP + 44,
  };
}

function linkPath(from, to) {
  const startX = from.x + STEP_WIDTH / 2;
  const startY = from.y + STEP_HEIGHT;
  const endX = to.x + STEP_WIDTH / 2;
  const endY = to.y;
  const middleY = startY + (endY - startY) / 2;
  return `M ${startX} ${startY} C ${startX} ${middleY}, ${endX} ${middleY}, ${endX} ${endY}`;
}

function participantLabel(scenario, participantId) {
  return scenario.participants.find((participant) => participant.id === participantId)?.label || participantId;
}
