import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildScenes } from "./build_scenes.mjs";

await buildScenes();

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "public", "vendor", "monaco");
await mkdir(output, { recursive: true });

await Promise.all([
  build({
    entryPoints: [resolve(root, "frontend", "monaco-preview-entry.js")],
    outfile: resolve(output, "monaco-preview.js"),
    bundle: true,
    format: "esm",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    loader: { ".ttf": "dataurl" },
  }),
  build({
    entryPoints: [
      resolve(root, "node_modules", "monaco-editor", "esm", "vs", "editor", "editor.worker.js"),
    ],
    outfile: resolve(output, "editor.worker.js"),
    bundle: true,
    format: "esm",
    minify: true,
    sourcemap: false,
    legalComments: "none",
  }),
  copyFile(
    resolve(root, "node_modules", "monaco-editor", "LICENSE"),
    resolve(output, "LICENSE.txt"),
  ),

]);

await build({
  entryPoints: [resolve(root, "frontend", "workbench", "entry.js")],
  outfile: resolve(root, "public", "vendor", "workbench", "workbench.js"),
  bundle: true, format: "esm", minify: true, target: "es2022", legalComments: "linked", external: ["/vendor/monaco/*"],
});
await copyFile(resolve(root, "node_modules", "@antv", "g6", "LICENSE"), resolve(root, "public", "vendor", "workbench", "G6-LICENSE.txt"));

await build({entryPoints:[resolve(root,"frontend","workbench","new-graph.js")],outfile:resolve(root,"public","vendor","workbench","new-graph.js"),bundle:true,format:"esm",minify:true,target:"es2022"});
