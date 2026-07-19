try {
  document.documentElement.dataset.theme =
    localStorage.getItem("callgraph_theme_v2") || "halo";
} catch {
  document.documentElement.dataset.theme = "halo";
}
