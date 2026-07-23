try {
  document.documentElement.dataset.theme =
    localStorage.getItem("callgraph_theme_v2") || "halo";
} catch {
  document.documentElement.dataset.theme = "halo";
}
try {
  document.documentElement.classList.toggle(
    "rail-collapsed",
    localStorage.getItem("callgraph.rail.collapsed.v1") === "true",
  );
} catch {
  // Keep the default expanded rail when storage is unavailable.
}
