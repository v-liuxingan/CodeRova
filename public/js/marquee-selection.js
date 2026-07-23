export function normalizeScreenRectangle(start, end) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

export function nodeIdsWithinRectangle(rectangle, nodes) {
  return new Set(
    nodes
      .filter(({ centerX, centerY }) =>
        centerX >= rectangle.left
        && centerX <= rectangle.right
        && centerY >= rectangle.top
        && centerY <= rectangle.bottom)
      .map(({ id }) => id),
  );
}
