/**
 * htmlTags — the start tags of an HTML document, with parsed attributes.
 *
 * Purpose: the HTML validator classified scripts with regex lookaheads, which
 * cannot see HTML's structure: `data-src=` and a quoted `"src="` read as an
 * external script, a quoted `>` hid a real `src`, markup inside comments and
 * CDATA counted, and each unclosed `<script ` rescanned the rest of the
 * document (64 KB took 0.8 s in the lint callback). This scanner follows the
 * token boundaries that matter — comments, CDATA, declarations, quoted
 * attribute values, raw-text element bodies — in a single forward pass.
 *
 * Key decisions:
 *   - Start tags only: the rules read a tag's name and attributes; end tags,
 *     comments, CDATA and `<!…>` / `<?…>` declarations are skipped.
 *   - Names are exact and lower-cased: `<script-foo>` is not `<script>`.
 *   - The bodies of raw-text elements (script, style, textarea, …) are not
 *     markup and are skipped to their end tag.
 *   - Unterminated markup ends at end of input rather than throwing.
 *   - Linear: every search moves strictly forward.
 *
 * @coordinates-with html.tsx — the validator's rules read these tags
 * @module lib/formats/adapters/htmlTags
 */

interface HtmlAttribute {
  /** Lower-cased attribute name. */
  name: string;
  /** The value, or `null` for an attribute written without `=`. */
  value: string | null;
  /** Offset of the attribute name in the source. */
  offset: number;
}

export interface HtmlTag {
  /** Lower-cased tag name. */
  name: string;
  /** Offset of the tag's `<` in the source. */
  offset: number;
  attrs: HtmlAttribute[];
}

const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes"]);
const isSpace = (c: string | undefined) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
const isLetter = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c);

/** Every start tag in `html`, in document order. */
export function scanHtmlTags(html: string): HtmlTag[] {
  const lower = html.toLowerCase();
  const n = html.length;
  const out: HtmlTag[] = [];
  /** Index just past `needle` at or after `from`, or end of input. */
  const skipPast = (needle: string, from: number) => {
    const at = lower.indexOf(needle, from);
    return at === -1 ? n : at + needle.length;
  };

  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    if (lower.startsWith("<!--", lt)) {
      i = skipPast("-->", lt + 4);
      continue;
    }
    if (lower.startsWith("<![cdata[", lt)) {
      i = skipPast("]]>", lt + 9);
      continue;
    }
    const next = html[lt + 1];
    if (next === "!" || next === "?" || next === "/") {
      i = skipPast(">", lt + 2);
      continue;
    }
    if (!isLetter(next)) {
      i = lt + 1;
      continue;
    }

    let j = lt + 1;
    while (j < n && !isSpace(html[j]) && html[j] !== "/" && html[j] !== ">") j += 1;
    const tag: HtmlTag = { name: lower.slice(lt + 1, j), offset: lt, attrs: [] };

    for (;;) {
      while (j < n && (isSpace(html[j]) || html[j] === "/")) j += 1;
      if (j >= n || html[j] === ">") break;
      const nameStart = j;
      j += 1; // an attribute name may begin with `=` or a quote; take one char
      while (j < n && !isSpace(html[j]) && html[j] !== "/" && html[j] !== ">" && html[j] !== "=") j += 1;
      const attr: HtmlAttribute = { name: lower.slice(nameStart, j), value: null, offset: nameStart };
      let k = j;
      while (k < n && isSpace(html[k])) k += 1;
      if (html[k] === "=") {
        k += 1;
        while (k < n && isSpace(html[k])) k += 1;
        const quote = html[k];
        if (quote === '"' || quote === "'") {
          const close = html.indexOf(quote, k + 1);
          const end = close === -1 ? n : close;
          attr.value = html.slice(k + 1, end);
          j = close === -1 ? n : close + 1;
        } else {
          const start = k;
          while (k < n && !isSpace(html[k]) && html[k] !== ">") k += 1;
          attr.value = html.slice(start, k);
          j = k;
        }
      }
      tag.attrs.push(attr);
    }
    out.push(tag);
    i = j + 1;
    if (RAW_TEXT.has(tag.name)) i = Math.max(i, skipRawText(lower, tag.name, i));
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
