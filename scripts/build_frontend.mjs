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
  entryPoints: [resolve(root, "frontend", "v2", "entry.js")],
  outfile: resolve(root, "public", "vendor", "v2", "workbench.js"),
  bundle: true, format: "esm", minify: true, target: "es2022", legalComments: "linked",
});
await copyFile(resolve(root, "node_modules", "@antv", "g6", "LICENSE"), resolve(root, "public", "vendor", "v2", "G6-LICENSE.txt"));
