// Opt-in compatibility experiment; independent scenes do not depend on this bundle.
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, ".."), output = resolve(root, "public/vendor/atlas");
await mkdir(output, { recursive: true });
await build({
  entryPoints: [resolve(root, "frontend/atlas/entry.jsx")],
  outfile: resolve(output, "atlas.js"), bundle: true, format: "esm", minify: true,
  sourcemap: false, legalComments: "none", loader: { ".svg": "dataurl" },
});
