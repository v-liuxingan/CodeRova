let monacoModulePromise = null;
let themesRegistered = false;

export class MonacoEditorRuntime {
  constructor() {
    this.editor = null;
    this.model = null;
    this.decorations = null;
    this.matches = [];
    this.searchIndex = -1;
    this.lastQuery = "";
    this.wrapped = false;
    this.fontSize = 12;
  }

  get name() {
    return "MONACO · READ ONLY";
  }

  get capabilities() {
    return { folding: true, wrapping: true, fontSize: true };
  }

  async mount(container, preview) {
    const { monaco } = await loadMonaco();
    registerThemes(monaco);
    container.dataset.startLine = String(preview.startLine);
    container.dataset.focusLine = String(preview.focusLine);
    container.dataset.focusEndLine = String(preview.focusEndLine);
    container.dataset.previewScope = preview.scope;
    container.dataset.readOnly = "true";
    const editorElement = document.createElement("div");
    editorElement.className = "monaco-source-editor";
    container.replaceChildren(editorElement);

    const modelUri = monaco.Uri.from({
      scheme: "callgraph-preview",
      path: `/${preview.path.replaceAll("\\", "/")}`,
      query: `start=${preview.startLine}&focus=${preview.focusLine}`,
    });
    this.model = monaco.editor.createModel(
      preview.lines.map((line) => line.text).join("\n"),
      normalizeLanguage(preview.language),
      modelUri,
    );
    this.editor = monaco.editor.create(editorElement, {
      model: this.model,
      theme: themeName(),
      readOnly: true,
      domReadOnly: !preview.selectable,
      readOnlyMessage: { value: "调用链源码预览为只读模式" },
      ariaLabel: `${preview.path} 只读源码预览`,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fixedOverflowWidgets: true,
      lineNumbersMinChars: 4,
      lineNumbers: (line) => String(preview.startLine + line - 1),
      showFoldingControls: "always",
      folding: true,
      foldingHighlight: true,
      foldingStrategy: "indentation",
      unfoldOnClickAfterEndOfLine: true,
      renderLineHighlight: "all",
      renderWhitespace: "none",
      renderLineHighlightOnlyWhenFocus: false,
      fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
      fontLigatures: true,
      fontSize: this.fontSize,
      lineHeight: 21,
      padding: { top: 12, bottom: 20 },
      contextmenu: true,
      links: false,
      hover: { enabled: false },
      stickyScroll: { enabled: false },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      occurrencesHighlight: "off",
      selectionHighlight: !preview.selectable,
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      wordWrap: "off",
      mouseWheelZoom: true,
      smoothScrolling: false,
      cursorSmoothCaretAnimation: "off",
      cursorBlinking: "solid",
    });

    const focusStart = clampLine(preview.focusLine - preview.startLine + 1, this.model);
    const focusEnd = clampLine(preview.focusEndLine - preview.startLine + 1, this.model);
    this.decorations = this.editor.createDecorationsCollection(preview.selectable ? [] : [
      {
        range: new monaco.Range(focusStart, 1, focusEnd, this.model.getLineMaxColumn(focusEnd)),
        options: {
          isWholeLine: true,
          className: "monaco-source-focus",
          linesDecorationsClassName: "monaco-source-focus-gutter",
          overviewRuler: {
            color: themeAccent(),
            position: monaco.editor.OverviewRulerLane.Full,
          },
        },
      },
    ]);
    this.editor.revealRangeInCenter(
      new monaco.Range(focusStart, 1, focusEnd, this.model.getLineMaxColumn(focusEnd)),
      monaco.editor.ScrollType.Immediate,
    );
  }

  search(query, direction = 0) {
    if (!this.editor || !this.model) return { current: 0, total: 0 };
    const normalized = query.trim();
    if (!normalized) {
      this.matches = [];
      this.searchIndex = -1;
      this.lastQuery = "";
      this.editor.setSelection({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1,
      });
      return { current: 0, total: 0 };
    }
    if (normalized !== this.lastQuery) {
      this.matches = this.model.findMatches(normalized, false, false, false, null, true);
      this.searchIndex = this.matches.length ? 0 : -1;
      this.lastQuery = normalized;
    } else if (this.matches.length && direction) {
      this.searchIndex =
        (this.searchIndex + direction + this.matches.length) % this.matches.length;
    }
    const match = this.matches[this.searchIndex];
    if (match) {
      this.editor.setSelection(match.range);
      this.editor.revealRangeInCenter(match.range);
    }
    return {
      current: this.matches.length ? this.searchIndex + 1 : 0,
      total: this.matches.length,
    };
  }

  async run(action) {
    if (!this.editor) return {};
    if (action === "find") await this.editor.getAction("actions.find")?.run();
    if (action === "foldAll") await this.editor.getAction("editor.foldAll")?.run();
    if (action === "unfoldAll") await this.editor.getAction("editor.unfoldAll")?.run();
    if (action === "toggleWrap") {
      this.wrapped = !this.wrapped;
      this.editor.updateOptions({ wordWrap: this.wrapped ? "on" : "off" });
      return { active: this.wrapped };
    }
    if (action === "fontSmaller" || action === "fontLarger") {
      this.fontSize = Math.max(
        10,
        Math.min(18, this.fontSize + (action === "fontLarger" ? 1 : -1)),
      );
      this.editor.updateOptions({
        fontSize: this.fontSize,
        lineHeight: Math.round(this.fontSize * 1.72),
      });
    }
    return {};
  }

  dispose() {
    this.decorations?.clear();
    this.editor?.dispose();
    this.model?.dispose();
    this.editor = null;
    this.model = null;
  }
}

function loadMonaco() {
  monacoModulePromise ||= import("/vendor/monaco/monaco-preview.js");
  return monacoModulePromise;
}

function normalizeLanguage(language) {
  return ["rust", "java", "javascript", "typescript", "python", "go"].includes(language)
    ? language
    : "plaintext";
}

function clampLine(line, model) {
  return Math.max(1, Math.min(model.getLineCount(), line));
}

function themeName() {
  const theme=document.documentElement.dataset.theme;
  return `callgraph-${theme==='dark'?'aether':theme==='light'?'halo':theme||'halo'}`;
}

function themeAccent() {
  return getComputedStyle(document.documentElement).getPropertyValue("--acid").trim() || "#2563d9";
}

function registerThemes(monaco) {
  if (themesRegistered) return;
  monaco.editor.defineTheme("callgraph-editorial", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "647087", fontStyle: "italic" },
      { token: "keyword", foreground: "AD471C" },
      { token: "string", foreground: "2E5AA8" },
      { token: "number", foreground: "806034" },
      { token: "type", foreground: "2E5AA8" },
    ],
    colors: {
      "editor.background": "#F5F5F5",
      "editor.foreground": "#2D3142",
      "editorLineNumber.foreground": "#647087",
      "editorLineNumber.activeForeground": "#AD471C",
      "editor.lineHighlightBackground": "#FCF0E9",
      "editor.selectionBackground": "#F7D5C4",
      "editorIndentGuide.background1": "#DEDEE1",
      "editorIndentGuide.activeBackground1": "#BFC0C0",
    },
  });
  monaco.editor.defineTheme("callgraph-halo", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "74859A", fontStyle: "italic" },
      { token: "keyword", foreground: "2563D9", fontStyle: "bold" },
      { token: "string", foreground: "087F8F" },
      { token: "number", foreground: "BB6F0D" },
      { token: "type", foreground: "087F8F" },
    ],
    colors: {
      "editor.background": "#F4F7FB",
      "editor.foreground": "#465B74",
      "editorLineNumber.foreground": "#8A9AAD",
      "editorLineNumber.activeForeground": "#2563D9",
      "editor.lineHighlightBackground": "#EAF2FF",
      "editor.selectionBackground": "#BFD6FF",
      "editorIndentGuide.background1": "#DCE5EF",
      "editorIndentGuide.activeBackground1": "#A9BBD0",
    },
  });
  for (const [name, accent, background, foreground] of [
    ["aether", "74A9FF", "08121F", "B0BDD0"],
    ["signal", "C8F04A", "121611", "B0B5A8"],
  ]) {
    monaco.editor.defineTheme(`callgraph-${name}`, {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "71839D", fontStyle: "italic" },
        { token: "keyword", foreground: accent, fontStyle: "bold" },
        { token: "string", foreground: "43D7C5" },
        { token: "number", foreground: "F2B65C" },
      ],
      colors: {
        "editor.background": `#${background}`,
        "editor.foreground": `#${foreground}`,
        "editorLineNumber.activeForeground": `#${accent}`,
        "editor.lineHighlightBackground": `#${accent}16`,
        "editor.selectionBackground": `#${accent}35`,
      },
    });
  }
  themesRegistered = true;
}
