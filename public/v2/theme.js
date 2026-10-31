(() => {
  let theme = 'light';
  try { if (localStorage.getItem('callgraph-v2-theme') === 'dark') theme = 'dark'; } catch {}
  document.documentElement.dataset.theme = theme;
})();
