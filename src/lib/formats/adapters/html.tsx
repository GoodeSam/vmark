// WI-3.3 — Standalone HTML (.html / .htm) adapter.
//
// Per ADR-4 the preview renders inside <iframe sandbox="" srcdoc={...}>
// with an EMPTY sandbox allow-list (no allow-scripts, no
// allow-same-origin, no allow-forms, no allow-popups). The HTML
// content also gets an injected
//   <meta http-equiv="Content-Security-Policy"
//         content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">
// which governs *resource loading inside the iframe*. The sandbox
// is enforced by the iframe attribute alone; CSP via <meta> is not
// honored as a sandbox per MDN.
//
// Defense-in-depth: DOMPurify sanitizes the content first, removing
// script tags + javascript: URLs + event handlers before the iframe
// renders anything. WI-3.4 (security review) is the gating sign-off
// before this adapter is considered production-ready; until then the
// adapter ships in code but is marked UNVERIFIED in the file header.
//
// Issue #1273 adds an OPT-IN second mode on top of this one, reached only by
// an explicit per-file confirmation. The default above is unchanged; see
// HtmlPreview.tsx for the two-mode renderer and src-tauri/src/trusted_html/
// for the isolated origin the trusted mode runs in.

import type { Extension } from "@codemirror/state";
import { registerFormat } from "../registry";
import { HtmlPreview } from "./HtmlPreview";
import { scanHtmlTags, type HtmlTag } from "./htmlTags";
import type { FormatConfig, Validator } from "../types";

/**
 * What the preview refuses to execute, and what to say about it.
 *
 * Severity makes no claim about what runs. In the sandboxed preview every
 * finding is a warning; once the user trusts the document, every finding is
 * information (`infoWhenTrusted` lists them all), so none contradicts the
 * "Trusted — scripts enabled" banner. Whether one particular construct runs
 * depends on the page, and static detection cannot prove it (review): the
 * facts that differ by construct — an external script never loads, a link to
 * another window never navigates — are stated in the messages instead.
 *
 * Messages are worded for BOTH modes (#1273). They are also FALLBACKS: the
 * gutter prefers `diagnostic.<ruleId>` from the locale bundles, so any wording
 * change here has to be made there too or it is invisible. The rules read
 * parsed tags (htmlTags.ts, approximate and advisory), never raw text.
 */
const HTML_RULES = {
  "html/script-blocked": "Script tag detected — blocked unless trusted preview is enabled.",
  "html/script-external": "External script — the preview never loads scripts from a file or URL, trusted or not.",
  "html/javascript-url": "javascript: URL detected — blocked unless trusted preview is enabled.",
  "html/javascript-url-navigation":
    "javascript: URL that opens another window or the top page — the preview never allows that, trusted or not.",
  "html/inline-handler": "Inline event handler detected — blocked unless trusted preview is enabled.",
} as const;
type HtmlRuleId = keyof typeof HTML_RULES;

/** Script `type` values a browser executes; anything else is a data block. */
const SCRIPT_TYPES = new Set([
  "", "module", "text/javascript", "application/javascript", "text/ecmascript", "application/ecmascript",
  "application/x-javascript", "application/x-ecmascript", "text/jscript", "text/livescript",
  "text/x-javascript", "text/x-ecmascript", "text/javascript1.0", "text/javascript1.1", "text/javascript1.2",
  "text/javascript1.3", "text/javascript1.4", "text/javascript1.5",
]);
/** Event-handler attributes, by where the platform defines them. Any other
 *  `on*` attribute is just an attribute: reporting it as a handler would be
 *  false. The lists follow WebKit's; a platform event added later is not
 *  reported until it is listed here. */
const on = (events: string) => new Set(events.split(" ").map((event) => `on${event}`));
/** Handlers every element accepts (GlobalEventHandlers and WebKit's own). */
const GLOBAL_HANDLERS = on(
  "abort animationcancel animationend animationiteration animationstart auxclick beforecopy beforecut " +
    "beforeinput beforematch beforepaste beforetoggle blur cancel canplay canplaythrough change click close " +
    "command contentvisibilityautostatechange contextlost contextmenu contextrestored copy cuechange cut " +
    "dblclick drag dragend dragenter dragleave dragover dragstart drop durationchange emptied ended error focus " +
    "focusin focusout formdata fullscreenchange fullscreenerror gesturechange gestureend gesturestart " +
    "gotpointercapture input invalid keydown keypress keyup load loadeddata loadedmetadata loadstart " +
    "lostpointercapture mousedown mouseenter mouseleave mousemove mouseout mouseover mouseup mousewheel paste " +
    "pause play playing pointercancel pointerdown pointerenter pointerleave pointermove pointerout pointerover " +
    "pointerup progress ratechange reset resize scroll scrollend search securitypolicyviolation seeked seeking " +
    "select selectionchange selectstart slotchange stalled submit suspend timeupdate toggle touchcancel touchend " +
    "touchmove touchstart transitioncancel transitionend transitionrun transitionstart volumechange waiting " +
    "webkitanimationend webkitanimationiteration webkitanimationstart webkitfullscreenchange " +
    "webkitfullscreenerror webkitmouseforcechanged webkitmouseforcedown webkitmouseforceup " +
    "webkitmouseforcewillbegin webkittransitionend wheel",
);
/** Window handlers: they exist only on <body> and <frameset>, which forward them. */
const WINDOW_HANDLERS = on(
  "afterprint beforeprint beforeunload hashchange languagechange message messageerror offline online " +
    "orientationchange pagehide pagereveal pageshow pageswap popstate rejectionhandled storage " +
    "unhandledrejection unload",
);
/** SVG animation elements' handlers. */
const SVG_ANIMATION_HANDLERS = on("begin end repeat");
const SVG_ANIMATIONS = new Set(["animate", "animatemotion", "animatetransform", "set", "discard"]);

function isEventHandler(tag: HtmlTag, attrName: string): boolean {
  if (GLOBAL_HANDLERS.has(attrName)) return true;
  if (WINDOW_HANDLERS.has(attrName)) return tag.namespace === "html" && (tag.name === "body" || tag.name === "frameset");
  return SVG_ANIMATION_HANDLERS.has(attrName) && tag.namespace === "svg" && SVG_ANIMATIONS.has(tag.name);
}
/** Nested `srcdoc` documents are checked this many levels deep, at most. */
const SRCDOC_DEPTH = 3;
const SRCDOC_MAX_LENGTH = 1_000_000;

const attrValue = (tag: HtmlTag, name: string) => tag.attrs.find((a) => a.name === name)?.value ?? null;

/** A `javascript:` URL as a browser reads it: tabs and newlines removed, leading controls and spaces trimmed. */
function isJavascriptUrl(value: string): boolean {
  const url = value.replace(/[\t\n\r]/g, "");
  let start = 0;
  while (start < url.length && url.charCodeAt(start) <= 0x20) start += 1;
  return /^javascript:/i.test(url.slice(start));
}

/** Whether a link navigates this frame: its URL is a link's, not an image's
 *  or a form's (the sandbox refuses form submission). */
function linkUrl(tag: HtmlTag): { offset: number; value: string } | null {
  const isLink = tag.namespace === "html" ? tag.name === "a" || tag.name === "area" : tag.namespace === "svg" && tag.name === "a";
  if (!isLink) return null;
  const attr = tag.attrs.find((a) => a.name === "href") ?? (tag.namespace === "svg" ? tag.attrs.find((a) => a.name === "xlink:href") : undefined);
  return attr && attr.value !== null ? { offset: attr.offset, value: attr.value } : null;
}

/** The window a link opens in, as WebKit resolves it: its own non-empty
 *  target, else the first document `<base>` carrying a target attribute. The
 *  frame is sandboxed with allow-scripts only, so anything but itself is
 *  refused. Names are compared exactly — " _self " is a window name. */
function leavesFrame(tag: HtmlTag, baseTarget: string | null): boolean {
  const own = attrValue(tag, "target");
  const target = own !== null && own !== "" ? own : (baseTarget ?? "");
  return target !== "" && target.toLowerCase() !== "_self";
}

/** The rule ids a document's tags produce, with the offset each belongs at. */
function findings(content: string, depth: number): { ruleId: HtmlRuleId; offset: number }[] {
  const out: { ruleId: HtmlRuleId; offset: number }[] = [];
  const tags = scanHtmlTags(content);
  // The first document <base> CARRYING a target attribute wins, even an empty one.
  const base = tags.find((t) => t.name === "base" && t.namespace === "html" && !t.inTemplate && t.attrs.some((a) => a.name === "target"));
  const baseTarget = base ? (attrValue(base, "target") ?? "") : null;
  for (const tag of tags) {
    if (tag.name === "script") {
      const type = (attrValue(tag, "type") ?? "").trim().toLowerCase();
      if (tag.namespace !== "html" || SCRIPT_TYPES.has(type)) {
        // An external script names its file — src in HTML, href or xlink:href
        // in SVG (whose src is inert) — and never runs its own text; the
        // trusted CSP allows no script URL, so it never loads.
        const fileAttrs = tag.namespace === "html" ? ["src"] : ["href", "xlink:href"];
        const external = tag.attrs.some((a) => fileAttrs.includes(a.name));
        out.push({ ruleId: external ? "html/script-external" : "html/script-blocked", offset: tag.offset });
      }
    }
    for (const attr of tag.attrs) {
      if (isEventHandler(tag, attr.name)) out.push({ ruleId: "html/inline-handler", offset: attr.offset });
    }
    const link = linkUrl(tag);
    if (link && isJavascriptUrl(link.value)) {
      out.push({ ruleId: leavesFrame(tag, baseTarget) ? "html/javascript-url-navigation" : "html/javascript-url", offset: link.offset });
    }
    // An iframe's srcdoc is a document of its own: its findings are reported
    // at the attribute, and the nesting is bounded.
    if (tag.name === "iframe" && tag.namespace === "html" && depth < SRCDOC_DEPTH) {
      const srcdoc = tag.attrs.find((a) => a.name === "srcdoc");
      if (srcdoc?.value && srcdoc.value.length <= SRCDOC_MAX_LENGTH) {
        for (const inner of findings(srcdoc.value, depth + 1)) out.push({ ruleId: inner.ruleId, offset: srcdoc.offset });
      }
    }
  }
  return out;
}

/**
 * Offset → 1-based line/column, over the whole source.
 *
 * The validator scans the complete document rather than line by line, because
 * splitting first defeats every pattern that may span a newline and forces
 * every column to be reported as 1. Line starts are computed once and binary
 * searched, so the scan stays linear in the document rather than quadratic.
 */
function positionResolver(content: string) {
  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") lineStarts.push(i + 1);
  }
  return (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
  };
}

export const htmlValidator: Validator = (content) => {
  if (content.length === 0) return [];
  const at = positionResolver(content);
  return findings(content, 0)
    // Document order, so the gutter reads top to bottom rather than grouped by rule.
    .sort((a, b) => a.offset - b.offset)
    .map(({ ruleId, offset }) => ({ severity: "warning" as const, ...at(offset), message: HTML_RULES[ruleId], ruleId }));
};

export const htmlFormat: FormatConfig = {
  id: "html",
  nameI18nKey: "format.html",
  extensions: ["html", "htm"],
  kind: "split-pane",
  loadLanguage: async (): Promise<Extension> => {
    const { html } = await import("@codemirror/lang-html");
    return html();
  },
  validator: htmlValidator,
  // Every finding is information once the document is trusted (see HTML_RULES).
  infoWhenTrusted: Object.keys(HTML_RULES) as HtmlRuleId[],
  genericPreview: HtmlPreview,
  adapters: {
    saveDialogFilters: [{ nameI18nKey: "format.html", extensions: ["html", "htm"] }],
    untitledExtension: "html",
    exportEnabled: false,
    findEnabled: true,
    contentSearchIndexed: true,
    readOnlyDefault: false,
    reloadPolicy: "reload",
    menuPolicy: {
      sourceWysiwygToggle: false,
      cjkFormatActions: false,
      insertBlockActions: false,
      paragraphFormatting: false,
    },
    closeSavePolicy: "prompt-on-close",
  },
};

export function registerHtmlFormat(): void {
  registerFormat(htmlFormat);
}
