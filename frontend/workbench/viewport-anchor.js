// Keep world coordinates fixed on screen when surrounding layout changes.
// Read the camera afresh so explicit pan, zoom and focus remain authoritative.
export function viewportAnchor(container) {
  let owner = null, previous = null;
  return {
    reset(view) { owner = view; previous = container.getBoundingClientRect(); },
    update(view, resize = true) {
      if (!view) { owner = null; previous = null; return; }
      const rect = container.getBoundingClientRect();
      if (owner !== view || !previous) { owner = view; previous = rect; }
      const before = view.getViewportByCanvas([0, 0]);
      const screen = [before[0] + previous.left, before[1] + previous.top];
      previous = rect;
      if (resize) view.resize();
      const after = view.getViewportByCanvas([0, 0]);
      const delta = [screen[0] - rect.left - after[0], screen[1] - rect.top - after[1]];
      if (delta.some(value => Math.abs(value) > .01)) void view.translateBy(delta, false);
    },
  };
}
