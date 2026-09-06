import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildScenes } from "./build_scenes.mjs";

await buildScenes();

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "public", "vendor", "monaco");
const atlasOutput = resolve(root, "public", "vendor", "atlas");
await mkdir(output, { recursive: true });
await mkdir(atlasOutput, { recursive: true });

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
  build({
    entryPoints: [resolve(root, "frontend", "atlas", "entry.jsx")],
    outfile: resolve(atlasOutput, "atlas.js"),
    bundle: true,
    format: "esm",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    loader: { ".svg": "dataurl" },
  }),
]);
