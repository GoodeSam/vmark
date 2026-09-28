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
import { scanHtmlTags } from "./htmlTags";
import type {
  FormatConfig,
  ValidationDiagnostic,
  Validator,
} from "../types";

/**
 * What the preview refuses to execute, and what to say about it.
 *
 * Each rule records whether trusted preview RUNS what it reports. The trusted
 * frame's CSP is `script-src 'unsafe-inline'` with no URL source: inline
 * script, inline handlers and `javascript:` URLs run; an external script
 * never loads. `infoWhenTrusted`
 * derives from this, so a new rule cannot skip the decision.
 *
 * Messages are worded for BOTH modes — a message naming only the sandbox is
 * wrong for a document the user has authorized (#1273). They are also
 * FALLBACKS: the gutter prefers `diagnostic.<ruleId>` from the locale bundles,
 * so any wording change here has to be made there too or it is invisible.
 * The rules read parsed tags (htmlTags.ts), never raw text.
 */
const HTML_RULES = {
  "html/script-blocked": {
    message: "Script tag detected — blocked unless trusted preview is enabled.",
    runsWhenTrusted: true,
  },
  "html/script-external": {
    message: "External script — the preview never loads scripts from a file or URL, trusted or not.",
    runsWhenTrusted: false,
  },
  "html/javascript-url": {
    message: "javascript: URL detected — blocked unless trusted preview is enabled.",
    runsWhenTrusted: true,
  },
  "html/inline-handler": {
    message: "Inline event handler detected — blocked unless trusted preview is enabled.",
    runsWhenTrusted: true,
  },
} as const satisfies Record<string, { message: string; runsWhenTrusted: boolean }>;
type HtmlRuleId = keyof typeof HTML_RULES;

/** Attributes whose value is a URL a `javascript:` scheme would run. */
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href"]);

/** A `javascript:` URL as a browser reads it: tabs and newlines removed, leading controls and spaces trimmed. */
function isJavascriptUrl(value: string): boolean {
  const url = value.replace(/[\t\n\r]/g, "");
  let start = 0;
  while (start < url.length && url.charCodeAt(start) <= 0x20) start += 1;
  return /^javascript:/i.test(url.slice(start));
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
  const out: (ValidationDiagnostic & { offset: number })[] = [];
  const report = (ruleId: HtmlRuleId, offset: number) => {
    const { line, column } = at(offset);
    out.push({ severity: "warning", line, column, message: HTML_RULES[ruleId].message, ruleId, offset });
  };

  // Rules read the parsed start tags: markup inside comments, CDATA or a
  // script's own text is not markup, and a quoted value is one value.
  for (const tag of scanHtmlTags(content)) {
    if (tag.name === "script") {
      // Any src — remote, relative or empty — means the element never runs
      // inline code, and the trusted CSP allows no script URL.
      report(tag.attrs.some((a) => a.name === "src") ? "html/script-external" : "html/script-blocked", tag.offset);
    }
    for (const attr of tag.attrs) {
      if (/^on[a-z]+$/.test(attr.name)) report("html/inline-handler", attr.offset);
      if (URL_ATTRIBUTES.has(attr.name) && attr.value !== null && isJavascriptUrl(attr.value)) {
        report("html/javascript-url", attr.offset);
      }
    }
  }

  // Document order, so the gutter reads top to bottom rather than grouped by rule.
  out.sort((a, b) => a.offset - b.offset);
  return out.map(({ offset: _offset, ...diagnostic }) => diagnostic);
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
  // A finding is information under trust only if trusted preview actually
  // runs what it reports — an external script never loads, trusted or not.
  infoWhenTrusted: (Object.keys(HTML_RULES) as HtmlRuleId[]).filter((id) => HTML_RULES[id].runsWhenTrusted),
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
