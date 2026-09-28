/**
 * htmlTags — the start tags of an HTML document, with parsed attributes.
 *
 * Purpose: the HTML validator's rules read tags, not text. Regex lookaheads
 * read `data-src=` as an external script, missed a `src` after a quoted `>`,
 * counted markup inside comments and rescanned the document per unclosed
 * `<script ` (64 KB took 0.8 s in the lint callback). This scanner follows the
 * token boundaries that change a finding, in one forward pass.
 *
 * APPROXIMATE, and advisory: it is not the HTML parser. Findings label the
 * gutter; the sandbox and CSP enforce what runs regardless. A spec parser
 * (parse5) was weighed and not taken: its minified parser is about the whole
 * remaining eager-bundle headroom, and the validator runs synchronously.
 *
 * Key decisions:
 *   - Names fold ASCII only (`İ` stays one code unit), so offsets never shift.
 *   - Comments end at `-->` or `--!>`; `<!-->` and `<!--->` are whole
 *     comments. `<![CDATA[` (exact case) is CDATA only inside SVG or MathML;
 *     anywhere else it, like `<!…>`, `<?…>` and `</ …`, is a bogus comment
 *     ending at the first `>`.
 *   - A small open-element stack tracks the namespace (SVG, MathML, and their
 *     HTML integration points: foreignObject, desc, title, mi, mo, mn, ms,
 *     mtext) and `<template>`. HTML raw-text bodies (script, style, textarea,
 *     …) are skipped only in the HTML namespace; `<plaintext>` ends markup.
 *   - The first of duplicate attributes wins, as in the browser.
 *   - Attribute values are decoded: numeric character references and the
 *     named ones listed in NAMED_REFERENCES (terminated by `;`).
 *   - A tag still open at end of input is dropped, as the browser drops it.
 *   - Linear: every search moves forward; an end tag looks at most
 *     STACK_SEARCH open elements back.
 *
 * Known limits (approximate by design): script-data escape states
 * (`<!--` inside a script), the full named-reference table, the tree
 * builder's HTML "breakout" beyond the listed tags, and noscript, which is
 * raw text only when scripting is on.
 *
 * @coordinates-with html.tsx — the validator's rules read these tags
 * @module lib/formats/adapters/htmlTags
 */

type Namespace = "html" | "svg" | "math";

interface HtmlAttribute {
  /** ASCII-lower-cased attribute name. */
  name: string;
  /** The decoded value, or `null` for an attribute written without `=`. */
  value: string | null;
  /** Offset of the attribute name in the source. */
  offset: number;
}

export interface HtmlTag {
  /** ASCII-lower-cased tag name. */
  name: string;
  /** Offset of the tag's `<` in the source. */
  offset: number;
  namespace: Namespace;
  /** Inside a `<template>`: inert content, not part of the document. */
  inTemplate: boolean;
  attrs: HtmlAttribute[];
}

const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const SVG_HTML_POINTS = new Set(["foreignobject", "desc", "title"]);
const MATH_HTML_POINTS = new Set(["mi", "mo", "mn", "ms", "mtext"]);
/** HTML start tags that close foreign content (the spec's breakout list). */
const BREAKOUT = new Set([
  ..."b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing".split(" "),
  ..."menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var".split(" "),
]);
const NAMED_REFERENCES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", colon: ":", Tab: "\t", NewLine: "\n",
  lowbar: "_", sol: "/", period: ".", lpar: "(", rpar: ")", semi: ";", nbsp: " ",
};
const STACK_SEARCH = 256;

const isSpace = (c: string | undefined) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
const isLetter = (c: string | undefined) => c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
/** ASCII-only lower case: same length, so offsets carry over. */
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/** Decode the character references this scanner supports (see NAMED_REFERENCES). */
function decodeReferences(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, ref: string) => {
    if (ref.startsWith("#")) {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
    }
    return NAMED_REFERENCES[ref] ?? whole;
  });
}

/** Every start tag in `html`, in document order. */
export function scanHtmlTags(html: string): HtmlTag[] {
  const lower = asciiLower(html);
  const n = html.length;
  const out: HtmlTag[] = [];
  const stack: { name: string; namespace: Namespace }[] = [];
  let templates = 0;

  /** The namespace a child of the current element parses in. */
  const childNamespace = (): Namespace => {
    const top = stack[stack.length - 1];
    if (!top) return "html";
    if (top.namespace === "svg" && SVG_HTML_POINTS.has(top.name)) return "html";
    if (top.namespace === "math" && MATH_HTML_POINTS.has(top.name)) return "html";
    return top.namespace;
  };
  const popTo = (length: number) => {
    while (stack.length > length) {
      const gone = stack.pop();
      if (gone?.name === "template" && gone.namespace === "html") templates -= 1;
    }
  };
  /** Index just past `needle` at or after `from`, or end of input. */
  const skipPast = (needle: string, from: number) => {
    const at = lower.indexOf(needle, from);
    return at === -1 ? n : at + needle.length;
  };

  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;

    if (html.startsWith("<!--", lt)) {
      if (html[lt + 4] === ">") i = lt + 5;
      else if (html.startsWith("->", lt + 4)) i = lt + 6;
      else {
        const a = html.indexOf("-->", lt + 4);
        const b = html.indexOf("--!>", lt + 4);
        i = a === -1 && b === -1 ? n : a === -1 ? b + 4 : b === -1 || a < b ? a + 3 : b + 4;
      }
      continue;
    }
    if (html.startsWith("<![CDATA[", lt) && childNamespace() !== "html") {
      i = skipPast("]]>", lt + 9);
      continue;
    }
    const next = html[lt + 1];
    if (next === "!" || next === "?") {
      i = skipPast(">", lt + 2);
      continue;
    }
    if (next === "/") {
      if (!isLetter(html[lt + 2])) {
        i = skipPast(">", lt + 2);
        continue;
      }
      let j = lt + 2;
      while (j < n && !isSpace(html[j]) && html[j] !== "/" && html[j] !== ">") j += 1;
      const name = lower.slice(lt + 2, j);
      for (let k = stack.length - 1; k >= Math.max(0, stack.length - STACK_SEARCH); k -= 1) {
        if (stack[k].name === name) {
          popTo(k);
          break;
        }
      }
      i = skipPast(">", j);
      continue;
    }
    if (!isLetter(next)) {
      i = lt + 1;
      continue;
    }

    // Start tag.
    let j = lt + 1;
    while (j < n && !isSpace(html[j]) && html[j] !== "/" && html[j] !== ">") j += 1;
    const name = lower.slice(lt + 1, j);
    const attrs: HtmlAttribute[] = [];
    const seen = new Set<string>();
    let selfClosing = false;
    let closed = false;
    while (j < n) {
      while (j < n && isSpace(html[j])) j += 1;
      if (html[j] === "/") {
        j += 1;
        if (html[j] === ">") selfClosing = true;
        continue;
      }
      if (html[j] === ">") {
        closed = true;
        break;
      }
      if (j >= n) break;
      const nameStart = j;
      j += 1; // an attribute name may begin with `=` or a quote; take one char
      while (j < n && !isSpace(html[j]) && html[j] !== "/" && html[j] !== ">" && html[j] !== "=") j += 1;
      const attrName = lower.slice(nameStart, j);
      let value: string | null = null;
      let k = j;
      while (k < n && isSpace(html[k])) k += 1;
      if (html[k] === "=") {
        k += 1;
        while (k < n && isSpace(html[k])) k += 1;
        const quote = html[k];
        if (quote === '"' || quote === "'") {
          const close = html.indexOf(quote, k + 1);
          if (close === -1) {
            j = n;
            break;
          }
          value = html.slice(k + 1, close);
          j = close + 1;
        } else {
          const start = k;
          while (k < n && !isSpace(html[k]) && html[k] !== ">") k += 1;
          value = html.slice(start, k);
          j = k;
        }
      }
      if (!seen.has(attrName)) {
        seen.add(attrName);
        attrs.push({ name: attrName, value: value === null ? null : decodeReferences(value), offset: nameStart });
      }
    }
    // A tag still open at end of input is dropped, as the browser drops it.
    if (!closed) break;
    i = j + 1;

    let namespace = childNamespace();
    if (namespace !== "html" && BREAKOUT.has(name)) {
      while (stack.length > 0 && childNamespace() !== "html") popTo(stack.length - 1);
      namespace = "html";
    }
    if (namespace === "html" && (name === "svg" || name === "math")) namespace = name;
    out.push({ name, offset: lt, namespace, inTemplate: templates > 0, attrs });

    if (namespace === "html" && name === "plaintext") break;
    if (namespace === "html" && RAW_TEXT.has(name)) {
      i = skipRawText(lower, name, i);
      continue;
    }
    if (namespace === "html" ? VOID.has(name) : selfClosing) continue;
    stack.push({ name, namespace });
    if (name === "template" && namespace === "html") templates += 1;
  }
  return out;
}

/** Index after the end tag closing a raw-text element opened before `from`. */
function skipRawText(lower: string, name: string, from: number): number {
  const needle = `</${name}`;
  for (let at = lower.indexOf(needle, from); at !== -1; at = lower.indexOf(needle, at + 1)) {
    const after = lower[at + needle.length];
    if (after === undefined || after === ">" || after === "/" || isSpace(after)) {
      const close = lower.indexOf(">", at);
      return close === -1 ? lower.length : close + 1;
    }
  }
  return lower.length;
}
