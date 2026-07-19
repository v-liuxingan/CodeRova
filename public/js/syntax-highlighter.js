const LANGUAGE_KEYWORDS = {
  rust: new Set([
    "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else",
    "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop",
    "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self",
    "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where",
    "while",
  ]),
  javascript: new Set([
    "async", "await", "break", "case", "catch", "class", "const", "continue",
    "default", "delete", "do", "else", "export", "extends", "false", "finally",
    "for", "from", "function", "if", "import", "in", "instanceof", "let", "new",
    "null", "of", "return", "static", "super", "switch", "this", "throw", "true",
    "try", "typeof", "undefined", "var", "while", "yield",
  ]),
  typescript: new Set([
    "abstract", "any", "as", "async", "await", "boolean", "class", "const",
    "declare", "else", "enum", "export", "extends", "false", "for", "from",
    "function", "if", "implements", "import", "infer", "interface", "keyof", "let",
    "namespace", "never", "new", "null", "number", "of", "private", "protected",
    "public", "readonly", "return", "satisfies", "static", "string", "this", "true",
    "type", "typeof", "undefined", "unknown", "void", "while",
  ]),
  python: new Set([
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def",
    "del", "elif", "else", "except", "False", "finally", "for", "from", "global",
    "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass",
    "raise", "return", "True", "try", "while", "with", "yield",
  ]),
  go: new Set([
    "break", "case", "chan", "const", "continue", "default", "defer", "else",
    "fallthrough", "for", "func", "go", "goto", "if", "import", "interface", "map",
    "package", "range", "return", "select", "struct", "switch", "type", "var",
  ]),
};

const HASH_COMMENT_LANGUAGES = new Set(["python", "shell", "yaml", "toml"]);

export class SyntaxHighlighterRegistry {
  constructor() {
    this.highlighters = new Map();
  }

  register(language, highlighter) {
    this.highlighters.set(language, highlighter);
    return this;
  }

  append(element, text, language) {
    const highlighter = this.highlighters.get(language) || plainHighlighter;
    highlighter(element, text, language);
  }
}

function lightweightHighlighter(element, text, language) {
  const keywords = LANGUAGE_KEYWORDS[language] || new Set();
  const hashComment = HASH_COMMENT_LANGUAGES.has(language) ? "#.*$|" : "";
  const tokenPattern = new RegExp(
    `(\\/\\/.*$|${hashComment}\\/\\*.*?\\*\\/|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`|\\b\\d+(?:\\.\\d+)?\\b|\\b[A-Za-z_$][\\w$]*\\b)`,
    "gm",
  );
  let cursor = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) element.append(document.createTextNode(text.slice(cursor, index)));
    const value = match[0];
    const token = document.createElement("span");
    token.className = tokenClass(value, keywords);
    token.textContent = value;
    element.append(token);
    cursor = index + value.length;
  }
  if (cursor < text.length) element.append(document.createTextNode(text.slice(cursor)));
}

function plainHighlighter(element, text) {
  element.textContent = text;
}

function tokenClass(value, keywords) {
  if (value.startsWith("//") || value.startsWith("#") || value.startsWith("/*")) {
    return "tok-comment";
  }
  if (/^["'`]/.test(value)) return "tok-string";
  if (/^\d/.test(value)) return "tok-number";
  if (keywords.has(value)) return "tok-keyword";
  if (/^[A-Z]/.test(value)) return "tok-type";
  return "tok-symbol";
}

export const syntaxHighlighters = new SyntaxHighlighterRegistry();
for (const language of Object.keys(LANGUAGE_KEYWORDS)) {
  syntaxHighlighters.register(language, lightweightHighlighter);
}
