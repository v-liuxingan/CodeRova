const PATH_OFFSET = 14;
const COLLISION_GAP = 12;
const SEARCH_STEPS = 4;

/**
 * Places edge label cards outside their branch direction and resolves the
 * remaining collisions without coupling the policy to SVG DOM operations.
 */
export function placeEdgeLabels(views, orientation, nodes = []) {
  const vertical = orientation === "vertical";
  const ordered = [...views].sort((left, right) => compareViews(left, right, vertical));
  const occupied = new BoxIndex();
  for (const node of nodes) occupied.add({ left: node.x - 8, right: node.x + node.width + 8,
    top: node.y - 20, bottom: node.y + node.height + 20 });
  const positions = new Map();

  for (const view of ordered) {
    const candidates = labelCandidates(view, vertical);
    const chosen =
      candidates.find((candidate) => !occupied.near(candidate).some((box) => overlaps(candidate, box)))
      || candidates.reduce((best, candidate) =>
        overlapArea(candidate, occupied.near(candidate)) < overlapArea(best, occupied.near(best)) ? candidate : best);
    occupied.add(chosen);
    positions.set(view.entry.edge.id, { x: chosen.x, y: chosen.y, anchor: chosen.anchor });
  }
  return positions;
}

function labelCandidates(view, vertical) {
  const anchors = view.geometry.labelAnchors;
  if (anchors?.length) {
    const candidates = [];
    const primarySide = (vertical ? centerX(view.entry.to) - centerX(view.entry.from)
      : centerY(view.entry.to) - centerY(view.entry.from)) < 0 ? -1 : 1;
    for (const anchor of anchors) {
      for (const side of [primarySide, -primarySide]) {
        candidates.push({ ...toBox({
          x: anchor.x + (anchor.vertical ? side * (view.labelWidth / 2 + PATH_OFFSET) : 0),
          y: anchor.y + (anchor.vertical ? 0 : side * (view.labelHeight / 2 + PATH_OFFSET)),
        }, view.labelWidth / 2, view.labelHeight / 2), anchor });
      }
    }
    // Preserve association with a real route segment if dense labels must move.
    for (const candidate of [...candidates]) {
      for (let step = 1; step <= SEARCH_STEPS; step += 1) {
        for (const direction of [-1, 1]) {
          const dx = candidate.anchor.vertical ? 0 : direction * step * (view.labelWidth + COLLISION_GAP);
          const dy = candidate.anchor.vertical ? direction * step * (view.labelHeight + COLLISION_GAP) : 0;
          candidates.push({ ...candidate, x: candidate.x + dx, y: candidate.y + dy,
            left: candidate.left + dx, right: candidate.right + dx, top: candidate.top + dy, bottom: candidate.bottom + dy });
        }
      }
    }
    return candidates;
  }
  const { midpoint } = view.geometry;
  const branchDelta = vertical
    ? centerX(view.entry.to) - centerX(view.entry.from)
    : centerY(view.entry.to) - centerY(view.entry.from);
  const primarySide = branchDelta < 0 ? -1 : 1;
  const halfWidth = view.labelWidth / 2;
  const halfHeight = view.labelHeight / 2;
  const candidates = [];

  for (const side of [primarySide, -primarySide]) {
    const base = vertical
      ? {
          x: midpoint.x + side * (halfWidth + PATH_OFFSET),
          y: midpoint.y,
        }
      : {
          x: midpoint.x,
          y: midpoint.y + side * (halfHeight + PATH_OFFSET),
        };
    candidates.push(toBox(base, halfWidth, halfHeight));
    for (let step = 1; step <= SEARCH_STEPS; step += 1) {
      const distance = step * (vertical
        ? view.labelHeight + COLLISION_GAP
        : view.labelWidth + COLLISION_GAP);
      candidates.push(
        toBox(
          vertical ? { x: base.x, y: base.y - distance } : { x: base.x - distance, y: base.y },
          halfWidth,
          halfHeight,
        ),
        toBox(
          vertical ? { x: base.x, y: base.y + distance } : { x: base.x + distance, y: base.y },
          halfWidth,
          halfHeight,
        ),
      );
    }
  }
  return candidates;
}

function compareViews(left, right, vertical) {
  const mainDifference = vertical
    ? left.geometry.midpoint.y - right.geometry.midpoint.y
    : left.geometry.midpoint.x - right.geometry.midpoint.x;
  if (Math.abs(mainDifference) > 0.01) return mainDifference;
  const crossDifference = vertical
    ? centerX(left.entry.to) - centerX(right.entry.to)
    : centerY(left.entry.to) - centerY(right.entry.to);
  return crossDifference || left.entry.edge.id.localeCompare(right.entry.edge.id);
}

function toBox(position, halfWidth, halfHeight) {
  return {
    x: position.x,
    y: position.y,
    left: position.x - halfWidth - COLLISION_GAP / 2,
    right: position.x + halfWidth + COLLISION_GAP / 2,
    top: position.y - halfHeight - COLLISION_GAP / 2,
    bottom: position.y + halfHeight + COLLISION_GAP / 2,
  };
}

function overlaps(left, right) {
  return !(
    left.right <= right.left
    || left.left >= right.right
    || left.bottom <= right.top
    || left.top >= right.bottom
  );
}

function overlapArea(candidate, occupied) {
  return occupied.reduce((total, box) => {
    const width = Math.max(0, Math.min(candidate.right, box.right) - Math.max(candidate.left, box.left));
    const height = Math.max(0, Math.min(candidate.bottom, box.bottom) - Math.max(candidate.top, box.top));
    return total + width * height;
  }, 0);
}

function centerX(node) {
  return node.x + node.width / 2;
}

function centerY(node) {
  return node.y + node.height / 2;
}

// Local collision queries avoid rescanning every previously placed label.
class BoxIndex {
  cells = new Map();
  keys(box) {
    const keys = [];
    for (let x = Math.floor(box.left / 256); x <= Math.floor(box.right / 256); x += 1) {
      for (let y = Math.floor(box.top / 256); y <= Math.floor(box.bottom / 256); y += 1) keys.push(`${x}:${y}`);
    }
    return keys;
  }
  add(box) {
    for (const key of this.keys(box)) {
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(box);
    }
  }
  near(box) { return [...new Set(this.keys(box).flatMap((key) => this.cells.get(key) || []))]; }
}
