// Renderer-owned routing: data producers supply relationships, never geometry.
const CLEARANCE = 16;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function routeEdges(layout, orientation) {
  const vertical = orientation === "vertical";
  const obstacles = [...layout.nodes.values()].map((node) => ({
    left: node.x - CLEARANCE, right: node.x + node.width + CLEARANCE,
    top: node.y - CLEARANCE, bottom: node.y + node.height + CLEARANCE,
  }));
  const groups = new Map();
  const ordered = [...layout.edges].sort((a, b) =>
    Number(b.narrativeRole === "spine") - Number(a.narrativeRole === "spine")
    || a.edge.id.localeCompare(b.edge.id));
  for (const entry of ordered) {
    const backward = entry.routingRole === "feedback" || (vertical
      ? entry.to.y <= entry.from.y + entry.from.height
      : entry.to.x <= entry.from.x + entry.from.width);
    const side = (entry.feedbackLane || 0) % 2 ? "positive" : "negative";
    entry.routeSides = backward ? [side, side] : ["out", "in"];
    for (const [index, node] of [entry.from, entry.to].entries()) {
      const key = `${node.node.id}:${entry.routeSides[index]}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ entry, index, other: index ? entry.from : entry.to });
    }
  }
  for (const members of groups.values()) {
    members.sort((a, b) => (vertical ? a.other.x - b.other.x : a.other.y - b.other.y)
      || a.entry.edge.id.localeCompare(b.entry.edge.id) || a.index - b.index);
    members.forEach(({ entry, index }, i) => {
      entry.routePorts ||= [];
      entry.routePorts[index] = (i + 1) / (members.length + 1);
    });
  }
  const occupied = [];
  const between = (a, b) => {
    const near = obstacles.filter((box) => box.right >= Math.min(a.x, b.x) - 64
      && box.left <= Math.max(a.x, b.x) + 64
      && box.bottom >= Math.min(a.y, b.y) - 64
      && box.top <= Math.max(a.y, b.y) + 64);
    let route = findRoute(a, b, near, occupied);
    if (near.length !== obstacles.length && (!route || route.slice(1).some((point, i) => blocked(route[i], point, obstacles)))) {
      route = findRoute(a, b, obstacles, occupied);
    }
    return route;
  };
  for (const entry of ordered) {
    const [start, end] = endpoints(entry, vertical);
    const lead = (point, side) => {
      const delta = side === "negative" || side === "in" ? -CLEARANCE : CLEARANCE;
      return side === "out" || side === "in"
        ? { x: point.x + (vertical ? 0 : delta), y: point.y + (vertical ? delta : 0) }
        : { x: point.x + (vertical ? delta : 0), y: point.y + (vertical ? 0 : delta) };
    };
    const a = lead(start, entry.routeSides[0]);
    const b = lead(end, entry.routeSides[1]);
    // Short edges search only their surrounding corridor. Retry with all
    // obstacles when a staggered/custom layout requires a wider detour.
    let route;
    if (entry.routeSides[0] !== "out") {
      const bounds = entry.bounds || layout.bounds;
      const negative = entry.routeSides[0] === "negative";
      const offset = 48 + Math.floor((entry.feedbackLane || 0) / 2) * 26;
      const channel = vertical
        ? (negative ? bounds.x - offset : bounds.x + bounds.width + offset)
        : (negative ? bounds.y - offset : bounds.y + bounds.height + offset);
      const exit = vertical ? { x: channel, y: a.y } : { x: a.x, y: channel };
      const entrance = vertical ? { x: channel, y: b.y } : { x: b.x, y: channel };
      const first = between(a, exit), last = between(entrance, b);
      if (first && last) route = [...first, entrance, ...last];
    } else {
      route = between(a, b);
    }
    // Overlapping manually positioned node boxes can enclose a port. Keep the
    // relationship selectable even in that impossible-to-route configuration.
    const points = simplify([start, ...(route || [a, { x: a.x, y: b.y }, b]), end]);
    entry.geometry = geometryForPoints(points, entry.routeSides[0] === "out" ? "forward" : "feedback");
    for (let i = 1; i < points.length; i += 1) occupied.push([points[i - 1], points[i]]);
  }
  return layout;
}

function endpoints(entry, vertical) {
  return [entry.from, entry.to].map((node, index) => {
    const side = entry.routeSides[index];
    const fraction = entry.routePorts[index];
    if (side === "out" || side === "in") return vertical
      ? { x: node.x + node.width * fraction, y: node.y + (side === "out" ? node.height : 0) }
      : { x: node.x + (side === "out" ? node.width : 0), y: node.y + node.height * fraction };
    return vertical
      ? { x: node.x + (side === "positive" ? node.width : 0), y: node.y + node.height * fraction }
      : { x: node.x + node.width * fraction, y: node.y + (side === "positive" ? node.height : 0) };
  });
}

export function dragEdgeGeometry(entry, orientation) {
  const vertical = orientation === "vertical";
  const [start, end] = endpoints(entry, vertical);
  const middle = vertical ? (start.y + end.y) / 2 : (start.x + end.x) / 2;
  return geometryForPoints(vertical
    ? [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end]
    : [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end], entry.routingRole);
}

export function geometryForPoints(points, routingRole = "forward") {
  const segments = points.slice(1).map((point, i) => ({
    x: (point.x + points[i].x) / 2, y: (point.y + points[i].y) / 2,
    length: distance(point, points[i]), vertical: point.x === points[i].x,
  })).filter((segment) => segment.length > 0).sort((a, b) => b.length - a.length);
  return {
    pathData: points.map((point, i) => !i ? `M ${point.x} ${point.y}`
      : point.x === points[i - 1].x ? `V ${point.y}` : `H ${point.x}`).join(" "),
    midpoint: segments[0] || points[0], labelAnchors: segments, points, routingRole,
  };
}

function blocked(a, b, obstacles) {
  return obstacles.some((box) => a.x === b.x
    ? a.x > box.left + 0.01 && a.x < box.right - 0.01
      && Math.max(a.y, b.y) > box.top + 0.01 && Math.min(a.y, b.y) < box.bottom - 0.01
    : a.y > box.top + 0.01 && a.y < box.bottom - 0.01
      && Math.max(a.x, b.x) > box.left + 0.01 && Math.min(a.x, b.x) < box.right - 0.01);
}

function congestion(a, b, occupied) {
  let penalty = 0;
  for (const [c, d] of occupied) {
    if (a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) < 8) {
      penalty += Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
        - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))) * 4;
    } else if (a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) < 8) {
      penalty += Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
        - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))) * 4;
    }
  }
  return penalty;
}

function findRoute(start, end, obstacles, occupied) {
  const xs = new Set([start.x, end.x, (start.x + end.x) / 2]);
  const ys = new Set([start.y, end.y, (start.y + end.y) / 2]);
  for (const point of [start, end]) {
    xs.add(point.x - 12); xs.add(point.x + 12);
    ys.add(point.y - 12); ys.add(point.y + 12);
  }
  for (const box of obstacles) {
    for (const x of [box.left - 16, box.left, box.right, box.right + 16]) xs.add(x);
    for (const y of [box.top - 16, box.top, box.bottom, box.bottom + 16]) ys.add(y);
  }
  const xx = [...xs].sort((a, b) => a - b), yy = [...ys].sort((a, b) => a - b);
  const width = xx.length;
  const startIndex = yy.indexOf(start.y) * width + xx.indexOf(start.x);
  const endIndex = yy.indexOf(end.y) * width + xx.indexOf(end.x);
  const point = (index) => ({ x: xx[index % width], y: yy[Math.floor(index / width)] });
  const best = new Map(), previous = new Map(), segments = new Map();
  const queue = new MinHeap();
  for (const direction of [0, 1]) {
    const key = startIndex * 2 + direction;
    best.set(key, 0);
    queue.push({ key, cost: 0, score: distance(start, end) });
  }
  while (queue.size) {
    const current = queue.pop();
    if (current.cost !== best.get(current.key)) continue;
    const index = Math.floor(current.key / 2), direction = current.key % 2;
    if (index === endIndex) {
      const result = [];
      for (let key = current.key; key !== undefined; key = previous.get(key)) result.push(point(Math.floor(key / 2)));
      return result.reverse();
    }
    const x = index % width, y = Math.floor(index / width), a = point(index);
    const neighbors = [];
    if (x > 0) neighbors.push([index - 1, 0]);
    if (x + 1 < width) neighbors.push([index + 1, 0]);
    if (y > 0) neighbors.push([index - width, 1]);
    if (y + 1 < yy.length) neighbors.push([index + width, 1]);
    for (const [next, nextDirection] of neighbors) {
      const b = point(next), segmentKey = `${Math.min(index, next)}:${Math.max(index, next)}`;
      if (!segments.has(segmentKey)) segments.set(segmentKey, blocked(a, b, obstacles)
        ? Infinity : distance(a, b) + congestion(a, b, occupied));
      const cost = current.cost + segments.get(segmentKey) + (direction === nextDirection ? 0 : 24);
      const key = next * 2 + nextDirection;
      if (cost >= (best.get(key) ?? Infinity)) continue;
      best.set(key, cost); previous.set(key, current.key);
      queue.push({ key, cost, score: cost + distance(b, end) });
    }
  }
  return null;
}

function simplify(points) {
  const result = [];
  for (const point of points) {
    if (result.length && distance(result.at(-1), point) < 0.01) continue;
    while (result.length > 1) {
      const a = result.at(-2), b = result.at(-1);
      if (!((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))) break;
      result.pop();
    }
    result.push(point);
  }
  return result;
}

class MinHeap {
  items = [];
  get size() { return this.items.length; }
  push(value) {
    const items = this.items;
    let i = items.length; items.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].score <= value.score) break;
      items[i] = items[parent]; i = parent;
    }
    items[i] = value;
  }
  pop() {
    const items = this.items, first = items[0], last = items.pop();
    if (items.length) {
      let i = 0;
      while (i * 2 + 1 < items.length) {
        let child = i * 2 + 1;
        if (child + 1 < items.length && items[child + 1].score < items[child].score) child += 1;
        if (items[child].score >= last.score) break;
        items[i] = items[child]; i = child;
      }
      items[i] = last;
    }
    return first;
  }
}
