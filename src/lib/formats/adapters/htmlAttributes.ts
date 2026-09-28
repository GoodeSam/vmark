/**
 * htmlAttributes — a start or end tag's attributes, and their values decoded.
 *
 * Purpose: the attribute half of htmlTags.ts's approximate scanner. Start
 * tags, end tags and raw-text closers share this parser, so a quoted `>`
 * never ends a tag anywhere; the first of duplicate attributes wins, as in
 * the browser.
 *
 * Key decisions:
 *   - Numeric character references decode with or without a semicolon, as
 *     the browser allows; hex digits run on (`&#x73c` is U+073C).
 *   - Named references decode only from NAMED_REFERENCES and only when
 *     terminated by `;` — a listed subset, not the full table.
 *   - Duplicate names are found by a direct scan while a tag has few
 *     attributes, and by a Set only past eight: one Set per tag was most of
 *     the scanner's garbage.
 *
 * @coordinates-with htmlTags.ts — the scanner that calls this
 * @module lib/formats/adapters/htmlAttributes
 */

export interface HtmlAttribute {
  /** ASCII-lower-cased attribute name. */
  name: string;
  /** The decoded value, or `null` for an attribute written without `=`. */
  value: string | null;
  /** Offset of the attribute name in the source. */
  offset: number;
}

const NAMED_REFERENCES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", colon: ":", Tab: "\t", NewLine: "\n",
  lowbar: "_", sol: "/", period: ".", lpar: "(", rpar: ")", semi: ";", nbsp: "\u00a0",
};

export const isSpace = (c: string | undefined) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";

/** Decode the character references this scanner supports (see NAMED_REFERENCES). */
export function decodeReferences(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&#([xX][0-9a-fA-F]+|[0-9]+);?|&([A-Za-z]+);/g, (whole, numeric: string | undefined, named: string | undefined) => {
    if (numeric !== undefined) {
      const code = numeric[0] === "x" || numeric[0] === "X" ? parseInt(numeric.slice(1), 16) : parseInt(numeric, 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
    }
    return NAMED_REFERENCES[named ?? ""] ?? whole;
  });
}

/**
 * Parse a tag's attributes from `j` (just past its name) to its closing `>`,
 * honouring quotes. `end` is the index after `>`; `closed` is false when the
 * input ended first.
 */
export function parseAttributes(html: string, lower: string, from: number) {
  const n = html.length;
  const attrs: HtmlAttribute[] = [];
  // Duplicate detection: a direct scan while the list is short (most tags),
  // a Set only past that — one Set per tag was most of the scanner's garbage.
  let seen: Set<string> | null = null;
  let selfClosing = false;
  let j = from;
  while (j < n) {
    while (j < n && isSpace(html[j])) j += 1;
    if (html[j] === "/") {
      j += 1;
      if (html[j] === ">") selfClosing = true;
      continue;
    }
    if (html[j] === ">") return { attrs, selfClosing, closed: true, end: j + 1 };
    if (j >= n) break;
    const nameStart = j;
    j += 1; // an attribute name may begin with `=` or a quote; take one char
    while (j < n && !isSpace(html[j]) && html[j] !== "/" && html[j] !== ">" && html[j] !== "=") j += 1;
    const name = lower.slice(nameStart, j);
    let value: string | null = null;
    let k = j;
    while (k < n && isSpace(html[k])) k += 1;
    if (html[k] === "=") {
      k += 1;
      while (k < n && isSpace(html[k])) k += 1;
      const quote = html[k];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, k + 1);
        if (close === -1) break;
        value = html.slice(k + 1, close);
        j = close + 1;
      } else {
        const start = k;
        while (k < n && !isSpace(html[k]) && html[k] !== ">") k += 1;
        value = html.slice(start, k);
        j = k;
      }
    }
    if (attrs.length === 8) seen = new Set(attrs.map((a) => a.name));
    const duplicate = seen ? seen.has(name) : attrs.some((a) => a.name === name);
    if (!duplicate) {
      seen?.add(name);
      attrs.push({ name, value: value === null ? null : decodeReferences(value), offset: nameStart });
    }
  }
  return { attrs, selfClosing, closed: false, end: n };
}
