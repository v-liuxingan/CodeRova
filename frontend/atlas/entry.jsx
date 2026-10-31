import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CallgraphApi } from "../../public/js/api.js";
import { buildPhaseTopology } from "../../public/js/phase-navigator.js";
import "./atlas.css";

const api = new CallgraphApi();
const elk = new ELK();

const RELATION_LABELS = {
  direct: "调用",
  callback: "回调",
  "trait-dispatch": "动态分派",
  spawn: "派生任务",
  remote: "远程调用",
  "async-boundary": "异步边界",
  "data-flow": "数据传递",
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

const KIND_LABELS = {
  user: "用户",
  application: "应用",
  broker: "消息通道",
  "external-system": "外部系统",
  function: "函数",
  method: "方法",
  closure: "闭包",
  trait: "Trait",
  struct: "结构体",
  module: "模块",
  process: "进程",
  "remote-service": "远程服务",
};

function Glyph({ kind }) {
  if (kind === "database") return <span className="glyph glyph-database" aria-hidden="true" />;
  if (kind === "broker" || kind === "queue" || kind === "topic") return <span className="glyph glyph-queue" aria-hidden="true"><i /><i /><i /></span>;
  if (kind === "user") return <span className="glyph glyph-user" aria-hidden="true"><i /><b /></span>;
  if (kind === "external-system" || kind === "remote-service") return <span className="glyph glyph-external" aria-hidden="true">↗</span>;
  if (kind === "process") return <span className="glyph glyph-process" aria-hidden="true">◌</span>;
  return <span className="glyph glyph-service" aria-hidden="true">◆</span>;
}

function SystemBoundaryNode({ data }) {
  return (
    <div className={`system-boundary system-${data.kind}`}>
      <div className="system-boundary-header">
        <Glyph kind={data.kind} />
        <div>
          <span>{KIND_LABELS[data.kind] || data.kind}</span>
          <strong>{data.label}</strong>
        </div>
      </div>
      {data.description && <p>{data.description}</p>}
    </div>
  );
}

function ScenarioStepNode({ data, selected }) {
  const participant = data.participant || {};
  return (
    <div className={`scenario-step-node ${selected ? "is-selected" : ""} step-${data.kind} participant-${participant.kind || "application"}`}>
      <Handle type="target" position={Position.Left} className="architecture-handle" />
      <Handle type="source" position={Position.Right} className="architecture-handle" />
      <div className="step-sequence">{String(data.order).padStart(2, "0")}</div>
      <div className="scenario-step-participant"><Glyph kind={participant.kind} /><span>{participant.label || data.kind}</span></div>
      <strong>{data.label}</strong>
      <small>{data.summary || "等待补充说明"}</small>
      {data.drilldowns?.length ? <em>{data.drilldowns.length} 处实现证据</em> : <em>架构语义</em>}
    </div>
  );
}

function CodeNode({ data, selected }) {
  const vertical = data.layoutDirection === "down";
  return (
    <div className={`code-node ${selected ? "is-selected" : ""} ${data.semanticOnly ? "semantic-only" : ""} ${data.phaseFocused ? "is-phase-focused" : ""} ${data.isEntry ? "is-entry" : ""} ${data.dimmed ? "is-dimmed" : ""} code-${data.kind}`}>
      <Handle id="target-top" type="target" position={Position.Top} className="architecture-handle" />
      <Handle id="target-left" type="target" position={Position.Left} className="architecture-handle" />
      <Handle id="target-right" type="target" position={Position.Right} className="architecture-handle" />
      <Handle id="target-bottom" type="target" position={Position.Bottom} className="architecture-handle" />
      <Handle id={vertical ? "source-bottom" : "source-right"} type="source" position={vertical ? Position.Bottom : Position.Right} className="architecture-handle" />
      <Handle id={vertical ? "source-left" : "source-top"} type="source" position={vertical ? Position.Left : Position.Top} className="architecture-handle" />
      <Handle id={vertical ? "source-right" : "source-bottom"} type="source" position={vertical ? Position.Right : Position.Bottom} className="architecture-handle" />
      <div className="code-node-topline">{data.isEntry && <b className="entry-badge">ENTRY</b>}<Glyph kind={data.kind} /><span>{KIND_LABELS[data.kind] || data.kind}</span></div>
      <strong>{data.label}</strong>
      <small>{data.role}</small>
      <em>{data.crate || data.module || data.file}</em>
      {data.semanticSummary && <span className="code-node-semantics">{data.semanticSummary}</span>}
    </div>
  );
}

function PhaseNode({ data, selected }) {
  return (
    <div className={`phase-node ${selected ? "is-selected" : ""} ${data.isEntry ? "is-entry" : ""} phase-${data.topologyRole || "action"}`}>
      <Handle type="target" position={Position.Left} className="architecture-handle" />
      <Handle type="source" position={Position.Right} className="architecture-handle" />
      <div className="phase-node-kicker"><span>{data.isEntry ? "ENTRY · " : ""}PHASE {String(data.order).padStart(2, "0")}</span><b>{data.nodeCount} 个实现</b></div>
      <strong>{data.title}</strong>
      <p>{data.summary}</p>
      <em>点击查看这一阶段的源码路径 →</em>
    </div>
  );
}

function SemanticEdge(props) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data, selected } = props;
  const feedbackRoute = data?.routingRole === "feedback" || data?.isFeedback;
  const [path, labelX, labelY] = feedbackRoute
    ? feedbackRoutePath({ sourceX, sourceY, targetX, targetY, data })
    : data?.elkPath
      ? [data.elkPath, data.elkLabelX, data.elkLabelY]
      : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const relation = data?.kind || "direct";
  const flowKind = data?.flowKind;
  const isLoop = flowKind === "loop-back" || flowKind === "loop-exit";
  const label = isLoop
    ? `↺ ${data?.condition || data?.label || "回到主循环"}`
    : data?.label || RELATION_LABELS[relation] || relation;
  const isSpecial = relation === "async-boundary" || isLoop || flowKind === "fallback" || flowKind === "merge";
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={`semantic-edge edge-${relation} edge-flow-${flowKind || "main"} ${data?.isAttachment ? "is-attachment" : ""} ${feedbackRoute ? "is-feedback" : ""} ${data?.dimmed ? "is-dimmed" : ""} ${data?.isOverlay ? "is-overlay" : ""} ${selected ? "is-selected" : ""}`} />
      {isSpecial && label && <EdgeLabelRenderer>
        <div
          className={`edge-label edge-label-${relation} edge-label-flow-${flowKind || "main"}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >{label}</div>
      </EdgeLabelRenderer>}
    </>
  );
}

function feedbackRoutePath({ sourceX, sourceY, targetX, targetY, data }) {
  const vertical = data?.orientation !== "horizontal";
  const feedbackLane = data?.feedbackLane || 0;
  const side = feedbackLane % 2 === 0 ? -1 : 1;
  const lane = Math.floor(feedbackLane / 2);
  const offset = 54 + lane * 30;
  const bounds = data?.bounds || {
    x: Math.min(sourceX, targetX),
    y: Math.min(sourceY, targetY),
    width: Math.abs(sourceX - targetX),
    height: Math.abs(sourceY - targetY),
  };
  if (vertical) {
    const sideChannel = side < 0 ? bounds.x - offset : bounds.x + bounds.width + offset;
    const returnChannel = bounds.y - offset - lane * 18;
    return [`M ${sourceX} ${sourceY} H ${sideChannel} V ${returnChannel} H ${targetX} V ${targetY}`, (sideChannel + targetX) / 2, returnChannel];
  }
  const sideChannel = side < 0 ? bounds.y - offset : bounds.y + bounds.height + offset;
  const returnChannel = bounds.x - offset - lane * 18;
  return [`M ${sourceX} ${sourceY} V ${sideChannel} H ${returnChannel} V ${targetY} H ${targetX}`, returnChannel, (sideChannel + targetY) / 2];
}

const nodeTypes = { systemBoundary: SystemBoundaryNode, scenarioStep: ScenarioStepNode, code: CodeNode, phase: PhaseNode };
const edgeTypes = { semantic: SemanticEdge };

function scenarioToFlow(scenario) {
  const participants = new Map(scenario.participants.map((participant) => [participant.id, participant]));
  // The scenario list is its authored reading sequence. Architecture ownership is
  // retained on each card instead of forcing unrelated points in time into a box.
  const nodes = scenario.steps.map((step, index) => ({
    id: step.id,
    type: "scenarioStep",
    position: { x: 80 + index * 338, y: 210 },
    style: { width: 282, height: 132 },
    data: {
      ...step,
      order: index + 1,
      participant: participants.get(step.participantId),
      targetType: "scenario-step",
    },
  }));
  const edges = scenario.links.map((link) => ({
    id: link.id,
    source: link.from,
    target: link.to,
    type: "semantic",
    animated: ["publish", "deliver", "consume", "route"].includes(link.kind),
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    data: { ...link, targetType: "scenario-link" },
  }));
  return { nodes, edges };
}

// The first view of a large source graph is a phase topology, not a forced
// spanning tree of every implementation detail. It uses the graph's authored
// phase and real inter-phase relations, so it explains the execution model
// without inventing a second graph.
function phaseOverviewToFlow(graph) {
  const topology = buildPhaseTopology(graph);
  const entryPhaseId = graph.nodes.find((node) => node.id === graph.root)?.phaseId;
  const nodeCountByPhase = new Map();
  graph.nodes.filter((node) => node.state !== "hidden").forEach((node) => {
    nodeCountByPhase.set(node.phaseId, (nodeCountByPhase.get(node.phaseId) || 0) + 1);
  });
  const nodes = topology.phases.map((phase) => ({
    id: phase.id,
    type: "phase",
    position: { x: 70 + phase.position.column * 330, y: 115 + phase.position.row * 248 },
    style: { width: 292, height: 166 },
    data: {
      ...phase,
      phaseId: phase.id,
      isEntry: phase.id === entryPhaseId,
      nodeCount: nodeCountByPhase.get(phase.id) || 0,
      label: phase.title,
      description: phase.summary,
      targetType: "phase",
    },
  }));
  const edges = topology.displayRelations.map((relation) => {
    const kind = relation.callKinds.includes("async-boundary") ? "async-boundary" : relation.callKinds[0] || "direct";
    return {
      id: `phase:${relation.from}:${relation.to}`,
      source: relation.from,
      target: relation.to,
      type: "semantic",
      animated: kind === "async-boundary" || relation.primaryFlowKind === "loop-back",
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      data: {
        id: relation.edgeIds[0],
        kind,
        flowKind: relation.primaryFlowKind,
        label: relation.displayLabel,
        description: `由 ${relation.edgeIds.length} 条源码关系汇总而成。`,
        evidence: relation.labels.join("；"),
        edgeIds: relation.edgeIds,
        targetType: "phase-relation",
      },
    };
  });
  return { nodes, edges, topology };
}

async function phaseDetailToFlow(graph, phaseId, relationshipFocus = null, orientation = "vertical") {
  const phaseNodes = graph.nodes.filter((node) => node.state !== "hidden" && node.phaseId === phaseId);
  const phaseNodeIds = new Set(phaseNodes.map((node) => node.id));
  const phaseEdges = graph.edges.filter((edge) => phaseNodeIds.has(edge.from) && phaseNodeIds.has(edge.to));
  const root = phaseNodeIds.has(graph.root) ? graph.root : phaseNodes[0]?.id;
  return graphToFlow({ ...graph, nodes: phaseNodes, edges: phaseEdges, root }, null, relationshipFocus, orientation, phaseId);
}

const READING_CONTROL_KINDS = new Set(["direct", "call", "request", "trait-dispatch", "spawn", "remote"]);

// Layout constraints are deliberately narrower than visible source relations.
// `phase.order` gives the reader a global storyline; `edge.order` serializes
// calls made by the same implementation node. Data, async and callback edges
// remain visible but never get to rearrange the story.
function readingLayoutGraph(graph, nodes, edges) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeById = new Map(nodes.map((node, index) => [node.id, { ...node, declarationIndex: index }]));
  const phases = [...(graph.phases || [])].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const phaseOrder = new Map(phases.map((phase, index) => [phase.id, index]));
  const phaseNodes = new Map();
  nodes.forEach((node) => {
    const key = node.phaseId || "__unphased";
    if (!phaseNodes.has(key)) phaseNodes.set(key, []);
    phaseNodes.get(key).push(node);
  });
  const layoutEdges = [];
  const usedIds = new Set();
  const add = (edge) => {
    if (usedIds.has(edge.id)) return;
    usedIds.add(edge.id);
    layoutEdges.push(edge);
  };
  const isForwardControl = (edge) => READING_CONTROL_KINDS.has(edge.kind)
    && edge.flowKind !== "loop-back";

  // Real, in-phase control calls set the local structure. They are the only
  // source edges that can move a node to a later local rank by themselves.
  edges.filter((edge) => isForwardControl(edge)
    && nodeById.get(edge.from)?.phaseId === nodeById.get(edge.to)?.phaseId)
    .forEach(add);

  // Explicit order is a sequence, not merely an x-axis tiebreaker. The
  // synthetic edges below are layout-only constraints and are never rendered.
  const orderedByCaller = new Map();
  edges.filter((edge) => Number.isInteger(edge.order) && edge.order > 0).forEach((edge) => {
    if (!orderedByCaller.has(edge.from)) orderedByCaller.set(edge.from, []);
    orderedByCaller.get(edge.from).push(edge);
  });
  for (const [callerId, ordered] of orderedByCaller) {
    ordered.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous.to === current.to || !nodeIds.has(previous.to) || !nodeIds.has(current.to)) continue;
      add({
        id: `__layout-order:${callerId}:${previous.id}:${current.id}`,
        from: previous.to,
        to: current.to,
        kind: "direct",
        flowKind: "normal",
        layoutOnly: true,
      });
    }
  }

  const chooseEntry = (phaseId, members, index) => {
    if (nodeIds.has(graph.root) && nodeById.get(graph.root)?.phaseId === phaseId) return graph.root;
    const incoming = edges.filter((edge) => edge.to && nodeById.get(edge.to)?.phaseId === phaseId
      && (phaseOrder.get(nodeById.get(edge.from)?.phaseId) ?? -1) < index);
    if (incoming.length) {
      incoming.sort((left, right) => relationPriority(left) - relationPriority(right)
        || (phaseOrder.get(nodeById.get(right.from)?.phaseId) ?? -1) - (phaseOrder.get(nodeById.get(left.from)?.phaseId) ?? -1)
        || left.id.localeCompare(right.id));
      return incoming[0].to;
    }
    const incomingInside = new Set(layoutEdges.filter((edge) => !edge.layoutOnly && edge.to && nodeById.get(edge.to)?.phaseId === phaseId).map((edge) => edge.to));
    return [...members].sort((left, right) => Number(incomingInside.has(left.id)) - Number(incomingInside.has(right.id)) || left.declarationIndex - right.declarationIndex || left.id.localeCompare(right.id))[0]?.id;
  };
  const chooseExit = (phaseId, members, entryId) => {
    const orderedTargets = edges.filter((edge) => edge.from === entryId && Number.isInteger(edge.order) && edge.order > 0)
      .sort((left, right) => right.order - left.order || right.id.localeCompare(left.id));
    if (orderedTargets.length && nodeById.get(orderedTargets[0].to)?.phaseId === phaseId) return orderedTargets[0].to;
    const outgoing = edges.filter((edge) => nodeById.get(edge.from)?.phaseId === phaseId
      && (phaseOrder.get(nodeById.get(edge.to)?.phaseId) ?? Number.MAX_SAFE_INTEGER) > (phaseOrder.get(phaseId) ?? -1));
    if (outgoing.length) {
      outgoing.sort((left, right) => relationPriority(left) - relationPriority(right) || left.id.localeCompare(right.id));
      return outgoing[0].from;
    }
    return entryId || members[0]?.id;
  };

  let previousExit = null;
  for (const [index, phase] of phases.entries()) {
    const members = phaseNodes.get(phase.id) || [];
    if (!members.length) continue;
    const entryId = chooseEntry(phase.id, members, index);
    if (previousExit && entryId && previousExit !== entryId) {
      const bridge = edges
        .filter((edge) => edge.from === previousExit && edge.to === entryId && isForwardControl(edge))
        .sort((left, right) => relationPriority(left) - relationPriority(right) || left.id.localeCompare(right.id))[0];
      add(bridge || { id: `__layout-phase:${previousExit}:${entryId}`, from: previousExit, to: entryId, kind: "direct", flowKind: "normal", layoutOnly: true });
    }
    const exitId = chooseExit(phase.id, members, entryId);
    const connected = new Set(layoutEdges.flatMap((edge) => [edge.from, edge.to]));
    for (const node of members) {
      if (node.id !== entryId && !connected.has(node.id)) {
        add({ id: `__layout-member:${entryId}:${node.id}`, from: entryId, to: node.id, kind: "data-flow", flowKind: "normal", layoutOnly: true });
      }
    }
    previousExit = exitId || previousExit;
  }
  return { ...graph, nodes, edges: layoutEdges };
}

function relationPriority(edge) {
  if (edge.kind === "direct" || edge.kind === "call") return 0;
  if (edge.kind === "trait-dispatch" || edge.kind === "request") return 1;
  if (edge.kind === "spawn" || edge.kind === "remote") return 2;
  return 3;
}

function compareLayoutEdges(left, right) {
  const leftOrder = Number.isInteger(left.order) ? left.order : Number.MAX_SAFE_INTEGER;
  const rightOrder = Number.isInteger(right.order) ? right.order : Number.MAX_SAFE_INTEGER;
  return leftOrder - rightOrder || relationPriority(left) - relationPriority(right) || left.id.localeCompare(right.id);
}

function elkPath(section) {
  if (!section?.startPoint || !section?.endPoint) return null;
  const points = [section.startPoint, ...(section.bendPoints || []), section.endPoint];
  const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  const middle = points[Math.floor(points.length / 2)];
  return { path, x: middle.x, y: middle.y };
}

// React Flow deliberately leaves layout to external engines. ELK is given only
// the authored reading constraints: local calls, explicit call order and the
// phase storyline. Other real relations stay on the canvas, but cannot move a
// node ahead of the story merely because they carry data or cross an async
// boundary. Each layout edge gets a stable port so ELK can preserve sibling
// order while reducing crossings.
async function layoutReadingGraph(graph, orientation) {
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of graph.edges.slice().sort(compareLayoutEdges)) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    outgoing.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
  }
  const vertical = orientation === "vertical";
  const sourceSide = vertical ? "SOUTH" : "EAST";
  const targetSide = vertical ? "NORTH" : "WEST";
  const edgePorts = new Map();
  const children = graph.nodes.map((node) => {
    const ports = [];
    (incoming.get(node.id) || []).forEach((edge, index) => {
      const id = `${node.id}:in:${index}`;
      edgePorts.set(`${edge.id}:target`, id);
      ports.push({ id, width: 1, height: 1, layoutOptions: { "org.eclipse.elk.port.side": targetSide } });
    });
    (outgoing.get(node.id) || []).forEach((edge, index) => {
      const id = `${node.id}:out:${index}`;
      edgePorts.set(`${edge.id}:source`, id);
      ports.push({ id, width: 1, height: 1, layoutOptions: { "org.eclipse.elk.port.side": sourceSide } });
    });
    return {
      id: node.id,
      width: 270,
      height: 116,
      ports,
      layoutOptions: { "org.eclipse.elk.portConstraints": "FIXED_ORDER" },
    };
  });
  const layouted = await elk.layout({
    id: "reading-graph",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": vertical ? "DOWN" : "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "64",
      "elk.layered.spacing.nodeNodeBetweenLayers": "92",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
    },
    children,
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edgePorts.get(`${edge.id}:source`)],
      targets: [edgePorts.get(`${edge.id}:target`)],
    })),
  });
  const nodes = new Map((layouted.children || []).map((node) => [node.id, {
    x: node.x || 0,
    y: node.y || 0,
    width: node.width || 270,
    height: node.height || 116,
  }]));
  const routes = new Map((layouted.edges || []).map((edge) => [edge.id, elkPath(edge.sections?.[0])]).filter(([, route]) => route));
  const values = [...nodes.values()];
  const minX = Math.min(0, ...values.map((node) => node.x));
  const minY = Math.min(0, ...values.map((node) => node.y));
  const maxX = Math.max(0, ...values.map((node) => node.x + node.width));
  const maxY = Math.max(0, ...values.map((node) => node.y + node.height));
  return {
    nodes,
    routes,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

async function graphToFlow(graph, layout, relationshipFocus = null, orientation = "vertical", activePhaseId = null) {
  const visibleNodes = graph.nodes.filter((node) => node.state !== "hidden");
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to));
  const semanticSummaryByNode = new Map();
  visibleEdges.forEach((edge) => {
    const tags = [];
    if (edge.kind === "async-boundary") tags.push("异步");
    if (edge.kind === "data-flow") tags.push("数据");
    if (["loop-back", "loop-exit"].includes(edge.flowKind)) tags.push("回环");
    if (!tags.length) return;
    [edge.from, edge.to].forEach((id) => {
      const summary = semanticSummaryByNode.get(id) || new Set();
      tags.forEach((tag) => summary.add(tag));
      semanticSummaryByNode.set(id, summary);
    });
  });
  const stored = layout?.positions?.[orientation] || {};
  const layoutGraph = readingLayoutGraph(graph, visibleNodes, visibleEdges);
  const computed = await layoutReadingGraph(layoutGraph, orientation);
  const overriddenNodeIds = new Set();
  for (const [id, position] of Object.entries(stored)) {
    const placed = computed.nodes.get(id);
    if (!placed || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) continue;
    computed.nodes.set(id, { ...placed, x: position.x, y: position.y });
    overriddenNodeIds.add(id);
  }
  const focusedNodeIds = relationshipFocus
    ? new Set([relationshipFocus, ...visibleEdges.filter((edge) => edge.from === relationshipFocus || edge.to === relationshipFocus).flatMap((edge) => [edge.from, edge.to])])
    : null;
  const nodes = visibleNodes.map((node) => {
    const placed = computed.nodes.get(node.id);
    return {
      id: node.id,
      type: "code",
      position: { x: placed.x, y: placed.y },
      style: { width: 270, height: 116 },
      data: {
        ...node,
        semanticSummary: [...(semanticSummaryByNode.get(node.id) || [])].join(" · "),
        layoutDirection: orientation === "vertical" ? "down" : "right",
        isEntry: node.id === graph.root,
        phaseFocused: activePhaseId === node.phaseId,
        dimmed: Boolean(focusedNodeIds && !focusedNodeIds.has(node.id)),
        targetType: "node",
      },
    };
  });
  const layoutEdgeIds = new Set(layoutGraph.edges.filter((edge) => !edge.layoutOnly).map((edge) => edge.id));
  const feedbackEdges = visibleEdges.filter((edge) => {
    const from = computed.nodes.get(edge.from);
    const to = computed.nodes.get(edge.to);
    return edge.flowKind === "loop-back" || (orientation === "vertical"
      ? to.y <= from.y
      : to.x <= from.x);
  }).sort((left, right) => left.id.localeCompare(right.id));
  const feedbackLaneById = new Map(feedbackEdges.map((edge, index) => [edge.id, index]));
  const edges = visibleEdges.map((edge) => {
    const edgeIsFocused = Boolean(relationshipFocus && (edge.from === relationshipFocus || edge.to === relationshipFocus));
    const feedback = feedbackLaneById.has(edge.id);
    const feedbackLane = feedbackLaneById.get(edge.id) ?? 0;
    const side = feedbackLane % 2 === 0 ? "left" : "right";
    const sourceHandle = feedback
      ? orientation === "vertical" ? `source-${side}` : `source-${side === "left" ? "top" : "bottom"}`
      : orientation === "vertical" ? "source-bottom" : "source-right";
    const targetHandle = feedback
      ? orientation === "vertical" ? "target-top" : "target-left"
      : orientation === "vertical" ? "target-top" : "target-left";
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      sourceHandle,
      targetHandle,
      type: "semantic",
      animated: edge.kind === "async-boundary" || edge.kind === "spawn",
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      data: {
        ...edge,
        targetType: "edge",
        isPrimary: layoutEdgeIds.has(edge.id),
        isFeedback: feedback,
        routingRole: feedback ? "feedback" : "forward",
        feedbackLane,
        bounds: computed.bounds,
        orientation,
        elkPath: feedback || overriddenNodeIds.has(edge.from) || overriddenNodeIds.has(edge.to) ? null : computed.routes.get(edge.id)?.path,
        elkLabelX: feedback || overriddenNodeIds.has(edge.from) || overriddenNodeIds.has(edge.to) ? null : computed.routes.get(edge.id)?.x,
        elkLabelY: feedback || overriddenNodeIds.has(edge.from) || overriddenNodeIds.has(edge.to) ? null : computed.routes.get(edge.id)?.y,
        isOverlay: edgeIsFocused,
        dimmed: Boolean(relationshipFocus && !edgeIsFocused),
      },
    };
  });
  return { nodes, edges, bounds: computed.bounds };
}

function CanvasFitter({ revision, focusId }) {
  const { fitView, getEdges, getNodes } = useReactFlow();
  useEffect(() => {
    let nestedFrame;
    const frame = requestAnimationFrame(() => {
      nestedFrame = requestAnimationFrame(() => {
        const connectedIds = new Set([focusId]);
        if (focusId) getEdges().forEach((edge) => {
          if (edge.source === focusId) connectedIds.add(edge.target);
          if (edge.target === focusId) connectedIds.add(edge.source);
        });
        const scope = focusId ? getNodes().filter((node) => connectedIds.has(node.id)) : undefined;
        fitView({ nodes: scope, padding: focusId ? 0.42 : 0.18, duration: 0, maxZoom: focusId ? 1.05 : 1 });
      });
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(nestedFrame); };
  }, [revision]);
  return null;
}

function SourcePanel({ selected, active, onOpenGraph, onOpenPhase }) {
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!selected || active?.kind !== "graph" || !["node", "edge"].includes(selected.targetType)) {
      setSource(null);
      return undefined;
    }
    setLoading(true);
    api.previewSource(active.slug, selected.targetType, selected.id, 12, "target")
      .then((preview) => !cancelled && setSource(preview))
      .catch((error) => !cancelled && setSource({ error: error.message }))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [active, selected]);

  if (!selected) return <aside className="atlas-inspector empty"><span>SELECT A TRACE</span><h2>从架构开始，再进入实现。</h2><p>选择系统、步骤、调用或连线，查看它在系统中的职责及可验证的源码证据。</p></aside>;
  const data = selected.data || {};
  const drilldowns = data.drilldowns || [];
  return <aside className="atlas-inspector">
    <div className="inspector-kicker">{selected.targetType === "scenario-step" ? "SCENARIO STEP" : selected.targetType === "edge" ? "CALL RELATION" : selected.targetType === "participant" ? "ARCHITECTURE ELEMENT" : "SOURCE ELEMENT"}</div>
    <h2>{data.label || data.title || selected.id}</h2>
    <p className="inspector-role">{data.role || data.kind || "架构关系"}</p>
    <p className="inspector-description">{data.summary || data.description || "该元素暂未提供补充说明。"}</p>
    {data.condition && <div className="inspector-fact"><span>条件</span><strong>{data.condition}</strong></div>}
    {data.evidence && <div className="inspector-fact"><span>证据摘要</span><strong>{data.evidence}</strong></div>}
    {selected.targetType === "phase" && <section className="drilldown-list"><span>阶段源码路径</span><button onClick={() => onOpenPhase(data.phaseId)}><b>查看 {data.nodeCount} 个实现节点</b><small>只展开当前阶段；跨阶段控制流保留在总览中。</small><em>进入实现路径 →</em></button></section>}
    {drilldowns.length > 0 && <section className="drilldown-list"><span>实现证据</span>{drilldowns.map((drilldown) => <button key={`${drilldown.graphSlug}-${drilldown.targetIds.join("-")}`} onClick={() => onOpenGraph(drilldown.graphSlug, drilldown.targetIds[0])}><b>查看调用图</b><small>{drilldown.purpose}</small><em>{drilldown.graphSlug} →</em></button>)}</section>}
    {active?.kind === "graph" && <section className="source-panel"><div><span>SOURCE EVIDENCE</span>{source?.path && <small>{source.path}:{source.startLine}</small>}</div>{loading && <p>正在加载受限源码上下文…</p>}{source?.error && <p className="source-error">{source.error}</p>}{source?.lines?.length > 0 && <pre>{source.lines.map((line) => `${String(line.number).padStart(5, " ")}  ${line.text}`).join("\n")}</pre>}</section>}
  </aside>;
}

function Atlas() {
  const [catalog, setCatalog] = useState({ graphs: [], scenarios: [] });
  const [active, setActive] = useState(null);
  const [selected, setSelected] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("正在读取架构目录…");
  const [viewportFocus, setViewportFocus] = useState(null);
  const [relationshipFocus, setRelationshipFocus] = useState(null);
  const [graphView, setGraphView] = useState("overview");
  const [phaseDetailId, setPhaseDetailId] = useState(null);
  const [orientation, setOrientation] = useState("vertical");
  const orientationRef = useRef(orientation);
  orientationRef.current = orientation;
  const canvasCursorRef = useRef(null);

  const openScenario = useCallback(async (slug) => {
    setStatus("正在生成架构场景…");
    try {
      const scenario = await api.loadScenario(slug);
      const flow = scenarioToFlow(scenario);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setActive({ kind: "scenario", slug, data: scenario });
      setSelected(null);
      setRelationshipFocus(null);
      setGraphView("overview");
      setPhaseDetailId(null);
      setViewportFocus(scenario.steps[0]?.id || null);
      setStatus(`场景已加载：${scenario.steps.length} 个步骤，${scenario.participants.length} 个架构元素`);
    } catch (error) { setStatus(`无法加载场景：${error.message}`); }
  }, [setEdges, setNodes]);

  const openGraph = useCallback(async (slug, focusId) => {
    setStatus("正在重建调用图…");
    try {
      const [graph, layout] = await Promise.all([api.loadGraph(slug), api.loadLayout(slug).catch(() => null)]);
      const hasPhases = (graph.phases || []).length > 0;
      const flow = hasPhases ? phaseOverviewToFlow(graph) : await graphToFlow(graph, layout, null, orientationRef.current);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setActive({ kind: "graph", slug, data: graph, layout });
      const focused = graph.nodes.find((node) => node.id === (focusId || graph.root));
      const entryPhase = graph.phases?.find((phase) => phase.id === focused?.phaseId) || graph.phases?.[0];
      setSelected(hasPhases && entryPhase
        ? { id: entryPhase.id, targetType: "phase", data: { ...entryPhase, phaseId: entryPhase.id, nodeCount: graph.nodes.filter((node) => node.state !== "hidden" && node.phaseId === entryPhase.id).length } }
        : focused ? { id: focused.id, targetType: "node", data: focused } : null);
      setRelationshipFocus(null);
      setGraphView(hasPhases ? "overview" : "full");
      setPhaseDetailId(null);
      setViewportFocus(hasPhases ? null : focused?.id || null);
      setStatus(hasPhases
        ? `已加载 ${graph.phases.length} 个执行阶段；${graph.nodes.length} 个源码节点留在各阶段的实现路径中。`
        : `调用图已加载：${graph.nodes.length} 个可验证实现节点`);
    } catch (error) { setStatus(`无法加载调用图：${error.message}`); }
  }, [setEdges, setNodes]);

  useEffect(() => {
    Promise.all([api.listGraphs(), api.listScenarios()]).then(([graphs, scenarios]) => {
      setCatalog({ graphs, scenarios });
      if (scenarios[0]) openScenario(scenarios[0].slug);
      else if (graphs[0]) openGraph(graphs[0].slug);
    }).catch((error) => setStatus(`目录读取失败：${error.message}`));
  }, [openGraph, openScenario]);

  const openPhaseDetail = useCallback(async (phaseId) => {
    if (active?.kind !== "graph") return;
    const phase = active.data.phases?.find((candidate) => candidate.id === phaseId);
    const flow = await phaseDetailToFlow(active.data, phaseId, null, orientation);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setGraphView("detail");
    setPhaseDetailId(phaseId);
    setRelationshipFocus(null);
    setSelected(null);
    setViewportFocus(null);
    setStatus(`正在查看阶段「${phase?.title || phaseId}」的 ${flow.nodes.length} 个实现节点。`);
  }, [active, orientation, setEdges, setNodes]);

  const openFullGraph = useCallback(async () => {
    if (active?.kind !== "graph") return;
    const flow = await graphToFlow(active.data, active.layout, null, orientation);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setGraphView("full");
    setPhaseDetailId(null);
    setRelationshipFocus(null);
    setSelected(null);
    setViewportFocus(active.data.root || null);
    setStatus(`已打开完整调用图；蓝色 ENTRY 是本图的源码调用入口。`);
  }, [active, orientation, setEdges, setNodes]);

  const toggleOrientation = useCallback(async () => {
    if (active?.kind !== "graph" || graphView === "overview") return;
    const next = orientation === "vertical" ? "horizontal" : "vertical";
    const flow = phaseDetailId
      ? await phaseDetailToFlow(active.data, phaseDetailId, relationshipFocus, next)
      : await graphToFlow(active.data, active.layout, relationshipFocus, next);
    setOrientation(next);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setViewportFocus(null);
    setStatus(`已切换为${next === "vertical" ? "纵向" : "横向"}叙事布局。`);
  }, [active, graphView, orientation, phaseDetailId, relationshipFocus, setEdges, setNodes]);

  const reflowGraph = useCallback(async () => {
    if (active?.kind !== "graph" || graphView === "overview") return;
    const flow = phaseDetailId
      ? await phaseDetailToFlow(active.data, phaseDetailId, relationshipFocus, orientation)
      : await graphToFlow(active.data, null, relationshipFocus, orientation);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setViewportFocus(null);
    setStatus("已按源码控制流和 order 重新自动排版；未覆盖已保存的手工布局。");
  }, [active, graphView, orientation, phaseDetailId, relationshipFocus, setEdges, setNodes]);

  const returnToPhaseOverview = useCallback(() => {
    if (active?.kind !== "graph" || !(active.data.phases || []).length) return;
    const flow = phaseOverviewToFlow(active.data);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setGraphView("overview");
    setPhaseDetailId(null);
    setRelationshipFocus(null);
    setSelected(null);
    setViewportFocus(null);
    setStatus(`已返回 ${active.data.phases.length} 个执行阶段的架构总览。`);
  }, [active, setEdges, setNodes]);

  const locateEntry = useCallback(() => {
    if (active?.kind !== "graph" || !active.data.root) return;
    setViewportFocus(active.data.root);
    setStatus("已定位到蓝色 ENTRY 调用入口；视图只移动到入口及其一跳关系。");
  }, [active]);

  const onNodeClick = useCallback(async (_, node) => {
    setSelected({ id: node.id, targetType: node.data.targetType || "participant", data: node.data });
    if (active?.kind === "graph" && node.data.targetType === "phase") return;
    if (active?.kind === "graph") {
      setRelationshipFocus(node.id);
      const flow = phaseDetailId
        ? await phaseDetailToFlow(active.data, phaseDetailId, node.id, orientation)
        : await graphToFlow(active.data, active.layout, node.id, orientation);
      setEdges(flow.edges);
    }
  }, [active, orientation, phaseDetailId, setEdges]);
  const onEdgeClick = useCallback((_, edge) => setSelected({ id: edge.id, targetType: edge.data.targetType || "edge", data: edge.data }), []);
  const onNodeDragStop = useCallback((_, node) => {
    if (active?.kind !== "graph" || node.data.targetType !== "node") return;
    const positions = Object.fromEntries(nodes
      .filter((candidate) => candidate.data.targetType === "node")
      .map((candidate) => [candidate.id, candidate.id === node.id ? node.position : candidate.position]));
    const positionsByOrientation = { ...(active.layout?.positions || {}), [orientation]: positions };
    api.saveLayout(active.slug, { schemaVersion: "0.1", graph: active.slug, positions: positionsByOrientation })
      .then((savedLayout) => {
        setActive((current) => current?.slug === active.slug ? { ...current, layout: savedLayout } : current);
        setStatus("已保存当前叙事布局。");
      })
      .catch((error) => setStatus(`布局未保存：${error.message}`));
  }, [active, nodes, orientation]);
  const moveCanvasCursor = useCallback((event) => {
    const cursor = canvasCursorRef.current;
    if (!cursor) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    cursor.style.setProperty("--cursor-x", `${event.clientX - bounds.left}px`);
    cursor.style.setProperty("--cursor-y", `${event.clientY - bounds.top}px`);
    cursor.dataset.visible = "true";
  }, []);

  const hideCanvasCursor = useCallback(() => {
    if (canvasCursorRef.current) canvasCursorRef.current.dataset.visible = "false";
  }, []);

  const onPaneClick = useCallback(async () => {
    setSelected(null);
    if (active?.kind === "graph" && relationshipFocus) {
      setRelationshipFocus(null);
      const flow = phaseDetailId
        ? await phaseDetailToFlow(active.data, phaseDetailId, null, orientation)
        : await graphToFlow(active.data, active.layout, null, orientation);
      setEdges(flow.edges);
    }
  }, [active, orientation, phaseDetailId, relationshipFocus, setEdges]);

  const filtered = useMemo(() => {
    const matches = (item) => `${item.title || ""} ${item.goal || ""} ${item.description || ""}`.toLowerCase().includes(query.toLowerCase());
    return { graphs: catalog.graphs.filter(matches), scenarios: catalog.scenarios.filter(matches) };
  }, [catalog, query]);
  const title = active?.data?.title || "Architecture Atlas";
  const description = active?.data?.goal || active?.data?.description || "从系统结构进入可验证的实现路径。";

  return <main className="atlas-shell">
    <header className="atlas-topbar"><a href="/" className="atlas-brand"><span>◇</span><div><strong>ARCHITECTURE ATLAS</strong><small>实验入口 · 独立维护</small></div></a><div className="atlas-title"><span>{active?.kind === "scenario" ? "ARCHITECTURE SCENARIO" : graphView === "overview" ? "EXECUTION ARCHITECTURE" : graphView === "full" ? "NARRATIVE CALLGRAPH" : "PHASE IMPLEMENTATION"}</span><h1>{title}</h1><p>{description}</p></div><div className="atlas-topbar-actions">{active?.kind === "graph" && graphView !== "overview" && <button className="atlas-overview-link" onClick={returnToPhaseOverview}>← 返回架构总览</button>}<a className="legacy-link" href="/">调用图工作台 ↗</a></div></header>
    <aside className="atlas-rail"><div className="rail-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索系统或功能" /></div><section><div className="rail-label">ARCHITECTURE SCENARIOS <b>{filtered.scenarios.length}</b></div>{filtered.scenarios.map((scenario) => <button key={scenario.slug} className={`catalog-card ${active?.kind === "scenario" && active.slug === scenario.slug ? "is-active" : ""}`} onClick={() => openScenario(scenario.slug)}><span>功能路径</span><strong>{scenario.title}</strong><small>{scenario.participantCount} 个架构元素 · {scenario.stepCount} 个步骤</small></button>)}</section><section><div className="rail-label">SOURCE CALLGRAPHS <b>{filtered.graphs.length}</b></div>{filtered.graphs.map((graph) => <button key={graph.slug} className={`catalog-card ${active?.kind === "graph" && active.slug === graph.slug ? "is-active" : ""}`} onClick={() => openGraph(graph.slug)}><span>{graph.category || "未分类"}</span><strong>{graph.title}</strong><small>{graph.nodeCount} 节点 · {graph.edgeCount} 关系</small></button>)}</section></aside>
    <section className="atlas-canvas" onPointerEnter={moveCanvasCursor} onPointerMove={moveCanvasCursor} onPointerLeave={hideCanvasCursor}>
      <ReactFlow colorMode="light" nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick} onNodeDragStop={onNodeDragStop} onPaneClick={onPaneClick} fitView minZoom={0.2} maxZoom={1.7} nodesDraggable={active?.kind !== "graph" || graphView !== "overview"} proOptions={{ hideAttribution: true }}>
        <Background /><MiniMap pannable zoomable nodeColor={(node) => node.data?.isEntry ? "#2563eb" : "#94a3b8"} /><Controls showInteractive={false} />
        <CanvasFitter revision={`${active?.kind}:${active?.slug}:${graphView}:${orientation}:${phaseDetailId || ""}:${viewportFocus || ""}`} focusId={viewportFocus} />
      </ReactFlow>
      {active?.kind === "graph" && <div className="atlas-graph-toolbar"><button className={graphView === "overview" ? "is-active" : ""} onClick={returnToPhaseOverview}>架构总览</button><button className={graphView === "full" ? "is-active" : ""} onClick={openFullGraph}>完整调用图</button><button onClick={locateEntry}>定位入口</button>{graphView !== "overview" && <><button onClick={toggleOrientation}>{orientation === "vertical" ? "改为横向" : "改为纵向"}</button><button onClick={reflowGraph}>自动重排</button></>}</div>}
      <div ref={canvasCursorRef} className="atlas-canvas-cursor" data-visible="false" aria-hidden="true" />
      <div className="canvas-caption"><span>{active?.kind === "scenario" ? "架构图元" : graphView === "overview" ? "执行架构总览" : graphView === "full" ? "完整叙事调用图" : "阶段源码路径"}</span><strong>{active?.kind === "scenario" ? "从步骤 01 开始横向阅读；参与方显示在步骤卡上，点击步骤查看实现证据。" : graphView === "overview" ? "每张卡是一个执行阶段；只显示相邻主干、分支、回环和异步边界。点击卡片，再进入该阶段的源码路径。" : graphView === "full" ? "蓝色 ENTRY 是源码入口。布局只服从阶段与明确 order；异步、数据和回环走独立语义线。拖拽节点会保存当前位置。" : "这里仅显示当前阶段的真实实现关系；点击节点可查看源码证据。"}</strong></div>
    </section>
    <SourcePanel selected={selected} active={active} onOpenGraph={openGraph} onOpenPhase={openPhaseDetail} />
    <footer className="atlas-status"><span className="status-light" />{status}<b>{nodes.filter((node) => node.type !== "systemBoundary").length} visible elements</b></footer>
  </main>;
}

createRoot(document.getElementById("atlas-root")).render(<ReactFlowProvider><Atlas /></ReactFlowProvider>);
