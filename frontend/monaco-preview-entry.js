import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
import "monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController.js";
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js";
import "monaco-editor/esm/vs/editor/contrib/fontZoom/browser/fontZoom.js";
import "monaco-editor/esm/vs/editor/contrib/readOnlyMessage/browser/contribution.js";
import "monaco-editor/esm/vs/basic-languages/go/go.contribution.js";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution.js";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution.js";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js";

globalThis.MonacoEnvironment = {
  getWorker() {
    return new Worker(new URL("./editor.worker.js", import.meta.url), { type: "module" });
  },
};

export { monaco };
