async function request(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `请求失败：${response.status}`);
  }
  return body;
}
export class CallgraphApi {
  listGraphs() {
    return request("/api/graphs");
  }

  loadGraph(slug) {
    return request(`/api/graphs/${encodeURIComponent(slug)}`);
  }

  validateGraph(slug) {
    return request(`/api/graphs/${encodeURIComponent(slug)}/validation`);
  }

  health() {
    return request("/api/health");
  }

  buildSourceLink(graph, targetType, id) {
    return request("/api/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graph, targetType, id }),
    });
  }

  previewSource(graph, targetType, id, contextLines, signal) {
    return request("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graph, targetType, id, contextLines }),
      signal,
    });
  }
}
