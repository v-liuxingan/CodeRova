import {compile} from 'sass';
import { build } from "esbuild";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildScenes } from "./build_scenes.mjs";

await buildScenes();

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "public", "vendor", "monaco");
await build({entryPoints:[resolve(root,'frontend/components/controls.js')],outfile:resolve(root,'public/vendor/components/controls.js'),bundle:true,format:'esm',minify:true,target:'es2022',legalComments:'linked'});
for (const [name, file] of [['@floating-ui/dom','LICENSE'],['@floating-ui/core','LICENSE'],['@floating-ui/utils','LICENSE'],['tom-select','LICENSE'],['@codemirror/view','LICENSE'],['@codemirror/state','LICENSE'],['@codemirror/commands','LICENSE'],['@codemirror/language','LICENSE'],['@codemirror/lang-markdown','LICENSE'],['@codemirror/lang-json','LICENSE'],['@lezer/highlight','LICENSE']]) {
  await copyFile(resolve(root,'node_modules',name,file),resolve(root,'public/vendor/components',name.replaceAll('/','-').replace('@','')+'-LICENSE.txt'));
}
await mkdir(output, { recursive: true });
const statusCss=compile(resolve(root,'frontend/components/status.scss'),{loadPaths:[resolve(root,'node_modules')],style:'compressed',silenceDeprecations:['import','global-builtin','color-functions','if-function']});
await writeFile(resolve(root,'public/vendor/components/status.css'),statusCss.css);
await copyFile(resolve(root,'node_modules/bootstrap/LICENSE'),resolve(root,'public/vendor/components/bootstrap-LICENSE.txt'));


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
