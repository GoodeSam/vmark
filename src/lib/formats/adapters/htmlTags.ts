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
 *     comments. `<![CDATA[` (exact case) is CDATA only when the current
 *     element is SVG or MathML; anywhere else it, like `<!…>`, `<?…>` and
 *     `</ …`, is a bogus comment ending at the first `>`.
 *   - A small open-element stack tracks each element's namespace, whether it
 *     is an HTML integration point (SVG foreignObject/desc/title, MathML
 *     mi/mo/mn/ms/mtext, annotation-xml with an HTML encoding), and
 *     `<template>`. The breakout tags (and font with color, face or size)
 *     return foreign content to HTML.
 *   - HTML raw-text bodies are skipped only in the HTML namespace. Script
 *     bodies follow the script-data escape states (`<!--<script>` keeps a
 *     `</script>` from closing). noscript is raw text: trusted preview runs
 *     with scripting on. `<plaintext>` ends markup.
 *   - Start tags, end tags and raw-text closers share one attribute parser,
 *     so a quoted `>` never ends a tag. The first duplicate attribute wins.
 *   - Attribute values are decoded (htmlAttributes.ts).
 *   - A tag still open at end of input is dropped, as the browser drops it.
 *   - Linear: every search moves forward; an end tag for a name that is not
 *     open costs nothing (a count of open names), and otherwise looks at most
 *     STACK_SEARCH open elements back. htmlScaling.test.ts asserts it.
 *
 * Known limits (approximate by design): the full named-reference table and
 * the tree builder's rarer transitions (adoption agency, table foster
 * parenting, misnested formatting elements).
 *
 * @coordinates-with html.tsx — the validator's rules read these tags
 * @coordinates-with htmlAttributes.ts — the attribute parser and reference decoder
 * @module lib/formats/adapters/htmlTags
 */

import { parseAttributes, isSpace, type HtmlAttribute } from "./htmlAttributes";

type Namespace = "html" | "svg" | "math";

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

interface OpenElement {
  name: string;
  namespace: Namespace;
  /** Children of an HTML integration point parse as HTML. */
  integration: boolean;
}

const RAW_TEXT = new Set(["style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const SVG_HTML_POINTS = new Set(["foreignobject", "desc", "title"]);
const MATH_HTML_POINTS = new Set(["mi", "mo", "mn", "ms", "mtext"]);
/** HTML start tags that close foreign content (the spec's breakout list). */
const BREAKOUT = new Set([
  ..."b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing".split(" "),
  ..."menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var".split(" "),
]);
const STACK_SEARCH = 256;

const isLetter = (c: string | undefined) => c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
/** Ends a tag name: what may follow `</script` for it to close the element. */
const isNameEnd = (c: string | undefined) => c === undefined || isSpace(c) || c === "/" || c === ">";
/** ASCII-only lower case: same length, so offsets carry over. */
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/** Every start tag in `html`, in document order. */
export function scanHtmlTags(html: string): HtmlTag[] {
  const lower = asciiLower(html);
  const n = html.length;
  const out: HtmlTag[] = [];
  const stack: OpenElement[] = [];
  /** How many of each name are open: an end tag for a name that is not open
   *  (common in misnested markup) costs nothing instead of a stack search. */
  const openCount = new Map<string, number>();
  let templates = 0;

  /** The namespace a child of the current element parses in. */
  const childNamespace = (): Namespace => {
    const top = stack[stack.length - 1];
    return !top || top.integration ? "html" : top.namespace;
  };
  const popTo = (length: number) => {
    while (stack.length > length) {
      const gone = stack.pop();
      if (!gone) break;
      openCount.set(gone.name, (openCount.get(gone.name) ?? 1) - 1);
      if (gone.name === "template" && gone.namespace === "html") templates -= 1;
    }
  };
  /** Index just past `needle` at or after `from`, or end of input. */
  const skipPast = (needle: string, from: number) => {
    const at = lower.indexOf(needle, from);
    return at === -1 ? n : at + needle.length;
  };
  /** Index after the end tag closing a raw-text element, or end of input. */
  const skipRawText = (name: string, from: number) => {
    const needle = `</${name}`;
    for (let at = lower.indexOf(needle, from); at !== -1; at = lower.indexOf(needle, at + 1)) {
      if (isNameEnd(lower[at + needle.length])) return parseAttributes(html, lower, at + needle.length).end;
    }
    return n;
  };
  /** Index after a script's end tag, following the script-data escape
   *  states: after `<!--`, a nested `<script` keeps `</script` from closing
   *  until `-->` or its own `</script`. One forward pass. */
  const skipScriptData = (from: number) => {
    let state: "data" | "escaped" | "double" = "data";
    let i = from;
    while (i < n) {
      if (lower[i] === "-" && state !== "data" && lower.startsWith("-->", i)) {
        state = "data";
        i += 3;
        continue;
      }
      if (lower[i] !== "<") {
        i += 1;
        continue;
      }
      if (lower.startsWith("<!--", i)) {
        if (state === "data") state = "escaped";
        i += 4;
        continue;
      }
      if (lower.startsWith("</script", i) && isNameEnd(lower[i + 8])) {
        if (state !== "double") return parseAttributes(html, lower, i + 8).end;
        state = "escaped";
        i += 8;
        continue;
      }
      if (state === "escaped" && lower.startsWith("<script", i) && isNameEnd(lower[i + 7])) {
        state = "double";
        i += 7;
        continue;
      }
      i += 1;
    }
    return n;
  };

  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;

    if (html.startsWith("<!--", lt)) {
      if (html[lt + 4] === ">") i = lt + 5;
      else if (html.startsWith("->", lt + 4)) i = lt + 6;
      else {
        // One forward search for "--", then "-->" or "--!>": each comment
        // stops at its own end, so the whole scan stays linear.
        i = n;
        for (let d = html.indexOf("--", lt + 4); d !== -1; d = html.indexOf("--", d + 1)) {
          if (html[d + 2] === ">") {
            i = d + 3;
            break;
          }
          if (html.startsWith("!>", d + 2)) {
            i = d + 4;
            break;
          }
        }
      }
      continue;
    }
    const top = stack[stack.length - 1];
    if (html.startsWith("<![CDATA[", lt) && top && top.namespace !== "html") {
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
      while (j < n && !isNameEnd(html[j])) j += 1;
      const name = lower.slice(lt + 2, j);
      for (let k = (openCount.get(name) ?? 0) > 0 ? stack.length - 1 : -1; k >= Math.max(0, stack.length - STACK_SEARCH); k -= 1) {
        if (stack[k].name === name) {
          popTo(k);
          break;
        }
      }
      i = parseAttributes(html, lower, j).end;
      continue;
    }
    if (!isLetter(next)) {
      i = lt + 1;
      continue;
    }

    // Start tag.
    let j = lt + 1;
    while (j < n && !isNameEnd(html[j])) j += 1;
    const name = lower.slice(lt + 1, j);
    const { attrs, selfClosing, closed, end } = parseAttributes(html, lower, j);
    // A tag still open at end of input is dropped, as the browser drops it.
    if (!closed) break;
    i = end;

    let namespace = childNamespace();
    const breaksOut =
      BREAKOUT.has(name) || (name === "font" && attrs.some((a) => a.name === "color" || a.name === "face" || a.name === "size"));
    if (namespace !== "html" && breaksOut) {
      while (stack.length > 0 && childNamespace() !== "html") popTo(stack.length - 1);
      namespace = "html";
    }
    if (namespace === "html" && (name === "svg" || name === "math")) namespace = name;
    out.push({ name, offset: lt, namespace, inTemplate: templates > 0, attrs });

    if (namespace === "html") {
      if (name === "plaintext") break;
      if (name === "script") {
        i = skipScriptData(i);
        continue;
      }
      if (RAW_TEXT.has(name)) {
        i = skipRawText(name, i);
        continue;
      }
      if (VOID.has(name)) continue;
    } else if (selfClosing) {
      continue;
    }
    const encoding = (attrs.find((a) => a.name === "encoding")?.value ?? "").toLowerCase();
    const integration =
      (namespace === "svg" && SVG_HTML_POINTS.has(name)) ||
      (namespace === "math" && (MATH_HTML_POINTS.has(name) || (name === "annotation-xml" && (encoding === "text/html" || encoding === "application/xhtml+xml"))));
    stack.push({ name, namespace, integration });
    openCount.set(name, (openCount.get(name) ?? 0) + 1);
    if (name === "template" && namespace === "html") templates += 1;
  }
  return out;
}
