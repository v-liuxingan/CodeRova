import { MonacoEditorRuntime } from "./source-surfaces/monaco-editor-runtime.js";

let runtime = null;

window.addEventListener("message", async (event) => {
  if (
    event.source !== window.parent
    || event.origin !== window.location.origin
    || event.data?.channel !== "callgraph-monaco"
  ) {
    return;
  }
  const { type, requestId } = event.data;
  try {
    let result = {};
    if (type === "mount") {
      runtime?.dispose();
      document.documentElement.dataset.theme = event.data.theme || "halo";
      runtime = new MonacoEditorRuntime();
      await runtime.mount(document.querySelector("#monaco-root"), event.data.preview);
      runtime.onWrap=active=>reply({type:'wrapChanged',active});
      if(event.data.preview.selectable) {
        let previousLine=1;
        runtime.editor.onDidChangeCursorSelection(({selection})=>{
          if(selection.startLineNumber===previousLine)return;
          previousLine=selection.startLineNumber;reply({type:"selection",line:previousLine});
        });
      }
    } else if(type === 'measure') {
      const editor=runtime?.editor,model=runtime?.model;
      result=editor&&model?{viewport:editor.getLayoutInfo().height,content:editor.getBottomForLineNumber(model.getLineCount())-editor.getTopForLineNumber(1)}:{viewport:0,content:0};
    } else if(type === 'wrap') {
      runtime?.setWrap(event.data.active);
    } else if(type === 'extend') {
      await runtime?.extend(event.data.preview);
    } else if (type === "theme") {
      document.documentElement.dataset.theme=event.data.theme;
      await runtime?.applyTheme();
    } else if (type === "search") {
      result = runtime?.search(event.data.query, event.data.direction) || {
        current: 0,
        total: 0,
      };
    } else if (type === "action") {
      result = await runtime?.run(event.data.action) || {};
    } else {
      throw new Error(`未知 Monaco 请求：${type}`);
    }
    reply({ type: "response", requestId, ok: true, result });
  } catch (error) {
    reply({
      type: "response",
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

window.addEventListener("pagehide", () => runtime?.dispose());
reply({ type: "ready" });

function reply(message) {
  window.parent.postMessage(
    { channel: "callgraph-monaco", ...message },
    window.location.origin,
  );
}
