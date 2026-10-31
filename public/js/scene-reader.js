// Reuse the generated sequence document inside an isolated reading surface.
// Only inert diagram markup is imported; scripts, styles and resource URLs are discarded.
const tags = new Set("main header section div span p h1 h2 h3 h4 dl dt dd figure figcaption ol li small br code strong em a svg title desc defs marker path g rect line text tspan".split(" "));
const attributes = new Set("class id role tabindex viewbox width height x y x1 x2 y1 y2 rx d fill stroke stroke-width refx refy orient markerwidth markerheight text-anchor dominant-baseline dy".split(" "));

export function cleanSceneDocument(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const main = doc.querySelector("main.page");
  if (!main?.querySelector("svg.sequence")) throw new Error("场景内容格式无效");
  const title = main.querySelector("h1")?.textContent || "场景地图";
  const callgraph = main.querySelector(".callgraph-link")?.getAttribute("href") || "";
  const graphSlug = /^\/\?graph=([a-zA-Z0-9_-]+)$/.exec(callgraph)?.[1] || null;
  main.querySelectorAll(".page-nav, .page-footer, .callgraph-link").forEach((element) => element.remove());
  for (const element of [main, ...main.querySelectorAll("*")]) {
    if (!tags.has(element.localName.toLowerCase())) { element.remove(); continue; }
    for (const attr of [...element.attributes]) {
      const name = attr.name.toLowerCase();
      const safeLink = name === "href" && /^#[a-zA-Z0-9_-]+$/.test(attr.value);
      const safeMarker = name === "marker-end" && /^url\(#[a-zA-Z0-9_-]+\)$/.test(attr.value);
      const safeValue = !/url\(|javascript:|data:/i.test(attr.value);
      if (!(safeLink || safeMarker || (safeValue && (attributes.has(name) || name.startsWith("aria-") || name.startsWith("data-"))))) element.removeAttribute(attr.name);
    }
  }
  return { content: document.importNode(main, true), title, graphSlug };
}

export class SceneReader {
  constructor(host) {
    this.host = host;
    this.root = host.attachShadow({ mode: "open" });
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "/scenes/scenes.css";
    this.root.append(style);
    this.root.addEventListener("click", (event) => {
      const anchor = event.target.closest("a[href]");
      if (!anchor) return;
      event.preventDefault();
      this.root.getElementById(anchor.getAttribute("href").slice(1))?.scrollIntoView({ block: "start" });
    });
  }

  async prepare(slug, signal) {
    if (this.slug === slug) return this.current;
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) throw new Error("场景标识无效");
    const response = await fetch(`/scenes/${slug}.html`, { signal, cache: "no-cache" });
    if (!response.ok) throw new Error(`场景暂不可用（${response.status}），可重新点击入口重试`);
    return { ...cleanSceneDocument(await response.text()), slug };
  }

  show(scene) {
    if (this.slug !== scene.slug) {
      this.root.querySelector("main")?.remove();
      this.root.append(scene.content);
      document.querySelector("#scene-reader").scrollTop = 0;
    }
    this.slug = scene.slug;
    this.current = scene;
  }
}
