/**
 * Every comment in a source file, with its offsets — TypeScript/JavaScript,
 * Rust and CSS.
 *
 * Purpose: give a probe whose subject is comment PROSE (the provenance-id gate)
 * the full set of comments in a file: headers, block comments, and the trailing
 * `code(); // why` comments a line-start scan never sees. Each comment comes back
 * as `{ start, end, text }`, `text` being the exact source slice, so a finding
 * points at a real line and a rewrite can be checked against the same span.
 *
 * Key decisions:
 *   - Literals are never comments. TypeScript/JavaScript go through the
 *     TypeScript parser, which blanks every string, template piece, regex and
 *     JSX text before the comment lexer runs over the remainder — a `"// x"`
 *     string or a `/\/\*\/` regex cannot open a comment. Rust goes through
 *     `rustSpans`, the one Rust tokenizer in `scripts/lib/` (nested block
 *     comments, raw strings, char literals vs lifetimes). CSS has only quoted
 *     strings and block comments, lexed here.
 *   - Offsets are UTF-16 code units, the unit both TypeScript and JavaScript
 *     string indexing use, so `source.slice(start, end)` is the comment.
 *
 * @coordinates-with scripts/lib/rustSource.mjs — the Rust tokenizer this reuses
 * @coordinates-with scripts/lib/provenanceIds.mjs — reads provenance tokens out of these comments
 * @coordinates-with scripts/check-provenance-ids.test.mjs — drives each language here
 * @module scripts/lib/sourceComments
 */
import ts from "typescript";

import { rustSpans } from "./rustSource.mjs";

const LITERAL_KINDS = [
  ts.isStringLiteral,
  ts.isNoSubstitutionTemplateLiteral,
  ts.isTemplateHead,
  ts.isTemplateMiddle,
  ts.isTemplateTail,
  ts.isRegularExpressionLiteral,
  ts.isJsxText,
];

function scriptKind(file) {
  if (/\.[jt]sx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.(m?js|cjs)$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** `source` with every literal blanked to spaces (newlines kept), offsets unchanged. */
function tsLiteralsBlanked(source, file) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, scriptKind(file));
  const chars = source.split("");
  const visit = (node) => {
    if (LITERAL_KINDS.some((is) => is(node))) {
      for (let i = node.getStart(sf); i < node.end; i++) if (chars[i] !== "\n") chars[i] = " ";
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return chars.join("");
}

/** Comment spans over text in which no literal remains: `//…` to end of line, `/*…*​/`. */
function* slashComments(code) {
  const n = code.length;
  for (let i = 0; i < n - 1; i++) {
    if (code[i] !== "/") continue;
    if (code[i + 1] === "/") {
      const nl = code.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      yield { start: i, end };
      i = end;
    } else if (code[i + 1] === "*") {
      const close = code.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      yield { start: i, end };
      i = end - 1;
    }
  }
}

/** CSS: quoted strings are skipped, block comments are the only comments. */
function* cssComments(source) {
  const n = source.length;
  for (let i = 0; i < n - 1; i++) {
    const c = source[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      i = j;
    } else if (c === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      yield { start: i, end };
      i = end - 1;
    }
  }
}

/** True for the file kinds `comments` can read. */
export const isCommentedSource = (file) => /\.(tsx?|mts|cts|m?js|cjs|jsx|rs|css)$/.test(file);

/** Every comment in `source`: `{ start, end, text }`, in source order. */
export function comments(source, file) {
  let spans;
  if (file.endsWith(".rs")) spans = [...rustSpans(source)].filter((s) => s.kind === "comment");
  else if (file.endsWith(".css")) spans = [...cssComments(source)];
  else spans = [...slashComments(tsLiteralsBlanked(source, file))];
  return spans.map(({ start, end }) => ({ start, end, text: source.slice(start, end) }));
}

/** 1-based line number of `offset` in `source`. */
export function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}
