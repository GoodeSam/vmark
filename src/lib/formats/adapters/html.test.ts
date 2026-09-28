// @vitest-environment node
// WI-3.3 — HTML adapter tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetRegistry,
  dispatchEditor,
  getFormatById,
} from "../registry";
import { htmlFormat, registerHtmlFormat, htmlValidator } from "./html";
import { registerMarkdownFormat } from "./markdown";

describe("html adapter", () => {
  beforeEach(() => __resetRegistry());
  afterEach(() => __resetRegistry());

  it("declares id 'html'", () => {
    expect(htmlFormat.id).toBe("html");
  });

  it("registers .html and .htm extensions", () => {
    expect(htmlFormat.extensions).toEqual(["html", "htm"]);
  });

  it("declares loadLanguage + validator + genericPreview", () => {
    expect(typeof htmlFormat.loadLanguage).toBe("function");
    expect(typeof htmlFormat.validator).toBe("function");
    expect(htmlFormat.genericPreview).toBeDefined();
  });

  it("dispatchEditor routes .html and .htm", () => {
    registerMarkdownFormat();
    registerHtmlFormat();
    expect(dispatchEditor("/x/page.html").id).toBe("html");
    expect(dispatchEditor("/x/page.htm").id).toBe("html");
  });

  it("registerHtmlFormat installs into the registry", () => {
    registerHtmlFormat();
    expect(getFormatById("html")).toBe(htmlFormat);
  });

  describe("htmlValidator", () => {
    it("returns no diagnostics for empty document", () => {
      expect(htmlValidator("")).toEqual([]);
    });

    it("returns no diagnostics for valid HTML", () => {
      const html = `<!doctype html>
<html><head><title>x</title></head><body><p>hi</p></body></html>`;
      expect(htmlValidator(html)).toEqual([]);
    });

    it("flags <script> tag (XSS warning)", () => {
      const diags = htmlValidator(
        '<html><body><script>alert(1)</script></body></html>',
      );
      expect(diags.length).toBeGreaterThanOrEqual(1);
      // Script tags surface a diagnostic so users know the iframe will
      // block them; not blocked at the validator level (the renderer
      // handles enforcement).
      expect(diags[0].severity).toBe("warning");
      expect(diags[0].ruleId).toBe("html/script-blocked");
    });

    it("flags javascript: URLs in href / src", () => {
      const diags = htmlValidator(
        '<a href="javascript:alert(1)">x</a>',
      );
      expect(diags.length).toBeGreaterThanOrEqual(1);
      expect(diags[0].ruleId).toBe("html/javascript-url");
    });

    it("flags inline event handlers", () => {
      const diags = htmlValidator(
        '<button onclick="evil()">click</button>',
      );
      expect(diags.length).toBeGreaterThanOrEqual(1);
      expect(diags[0].ruleId).toBe("html/inline-handler");
    });

    it("returns multiple diagnostics for combined risks", () => {
      const diags = htmlValidator(
        '<script>1</script><a href="javascript:1">x</a><b onclick="2">x</b>',
      );
      expect(diags.length).toBeGreaterThanOrEqual(3);
    });

    // The validator used to split into lines and match each one, which threw
    // away two things: any construct spanning a newline, and the column of
    // every match (all were reported as 1).

    it("reports the real column, not 1", () => {
      const [diag] = htmlValidator('<p>hi</p><script>x</script>');
      expect(diag.ruleId).toBe("html/script-blocked");
      expect(diag.column).toBe(10);
    });

    it("reports the real line", () => {
      const [diag] = htmlValidator("<p>a</p>\n<p>b</p>\n<script>x</script>");
      expect(diag.line).toBe(3);
      expect(diag.column).toBe(1);
    });

    it("finds a javascript: URL whose attribute spans a newline", () => {
      const diags = htmlValidator('<a href =\n  "javascript:alert(1)">x</a>');
      expect(diags.map((d) => d.ruleId)).toContain("html/javascript-url");
    });

    it("finds an inline handler whose attribute spans a newline", () => {
      const diags = htmlValidator('<button\n  onclick = "evil()">x</button>');
      expect(diags.map((d) => d.ruleId)).toContain("html/inline-handler");
    });

    it("reports every occurrence, not just the first per line", () => {
      const diags = htmlValidator("<script>a</script><script>b</script>");
      expect(diags.filter((d) => d.ruleId === "html/script-blocked")).toHaveLength(2);
    });

    it("orders diagnostics by position in the document", () => {
      const diags = htmlValidator('<b onclick="x">y</b>\n<script>z</script>');
      expect(diags[0].ruleId).toBe("html/inline-handler");
      expect(diags[0].line).toBe(1);
      expect(diags[1].ruleId).toBe("html/script-blocked");
      expect(diags[1].line).toBe(2);
    });

    it("handles CRLF line endings", () => {
      const [diag] = htmlValidator("<p>a</p>\r\n<script>x</script>");
      expect(diag.line).toBe(2);
      expect(diag.column).toBe(1);
    });

    // Columns are UTF-16 code units, matching CodeMirror's own positions —
    // a BMP CJK character is one unit, so `<p>` + 6 chars + `</p>` puts the
    // script tag at column 14.
    it("counts a CJK character as one column", () => {
      const [diag] = htmlValidator('<p>用普通温度计</p><script>x</script>');
      expect(diag.column).toBe(14);
    });
  });
});

describe("htmlFormat.infoWhenTrusted — what a trusted document's findings mean", () => {
  // Under trust every HTML finding is information: none may contradict the
  // "Trusted — scripts enabled" banner. Severity makes no claim that a given
  // construct RUNS — static detection cannot prove that (review) — so the
  // facts that differ by construct live in the messages instead.
  it("lowers every rule the validator can report", () => {
    const doc =
      `<script>x</script><script src="a.js"></script><a href="javascript:void 0">a</a>` +
      `<a target="_top" href="javascript:void 0">b</a><p onclick="y">p</p>`;
    const reported = [...new Set(htmlValidator(doc).map((d) => d.ruleId))].sort();
    expect(reported).toHaveLength(5);
    expect([...(htmlFormat.infoWhenTrusted ?? [])].sort()).toEqual(reported);
  });
});

// Trusted preview's CSP is `script-src 'unsafe-inline'` with no URL source:
// inline script runs, but `<script src=…>` — remote or relative — never loads,
// trusted or not. So an external script is its own rule, and it stays a
// warning when the file is trusted (lowering it would say "fine" about a
// script that silently never runs).
describe("html adapter — inline vs external script", () => {
  it.each([
    ['<script>1</script>', "html/script-blocked"],
    ['<script type="module">1</script>', "html/script-blocked"],
    ['<script src="app.js"></script>', "html/script-external"],
    ['<script\n  src="https://cdn.example/x.js"></script>', "html/script-external"],
    ["<script defer src='x.js'></script>", "html/script-external"],
  ])("%j is %s", (html, ruleId) => {
    expect(htmlValidator(html).map((d) => d.ruleId)).toEqual([ruleId]);
  });

  it("says in the message that an external script never loads, trusted or not", () => {
    const [d] = htmlValidator('<script src="app.js"></script>');
    expect(d.message).toMatch(/never loads/);
  });
});

// Codex's third review: regex lookaheads could not see HTML structure. Each
// input's expected rules follow what a browser parses (DOMParser) and what the
// trusted frame actually runs.
describe("html adapter — rules read parsed tags, not text", () => {
  const rules = (html: string) => htmlValidator(html).map((d) => d.ruleId);

  it.each([
    [`<script data-src="app.js">1</script>`, ["html/script-blocked"]],
    [`<script data-x="src=">1</script>`, ["html/script-blocked"]],
    [`<script data-x="prefix src='x.js'">1</script>`, ["html/script-blocked"]],
    [`<script data-x=">" src="app.js"></script>`, ["html/script-external"]],
    [`<script src></script>`, ["html/script-external"]],
    [`<!-- <script src="app.js"></script> -->`, []],
    [`<svg><![CDATA[<script src="app.js"></script>]]></svg>`, []],
    [`<script-foo src="app.js"></script-foo>`, []],
    [`<scripts src="app.js"></scripts>`, []],
    [`<script defer SRC = 'a.js' type="text/javascript"></script>`, ["html/script-external"]],
    [`<script SRC="x.js"/>`, ["html/script-external"]],
    [`<script/>`, ["html/script-blocked"]],
    [`<p>the onion=layered prose</p>`, []],
    [`<script>el.innerHTML = "<b onclick=x>"</script>`, ["html/script-blocked"]],
  ])("%s → %j", (html, expected) => {
    expect(rules(html)).toEqual(expected);
  });

  // The frame is sandboxed with allow-scripts only: a javascript: URL runs in
  // the frame itself, but navigating the top page or a new window is blocked,
  // trusted or not (verified in the running app).
  it.each([
    [`<a href="javascript:void 0">x</a>`, "html/javascript-url"],
    [`<a target="_self" href="javascript:void 0">x</a>`, "html/javascript-url"],
    [`<a target="_top" href="javascript:void 0">x</a>`, "html/javascript-url-navigation"],
    [`<a target=_blank href="javascript:void 0">x</a>`, "html/javascript-url-navigation"],
    [`<base target="_parent"><a href="javascript:void 0">x</a>`, "html/javascript-url-navigation"],
    [`<a href=" java\tscript:void 0">x</a>`, "html/javascript-url"],
    [`<a href="JavaScript:void 0">x</a>`, "html/javascript-url"],
  ])("%s → %s", (html, ruleId) => {
    expect(rules(html)).toEqual([ruleId]);
  });

  it("says in the message that a link to another window never navigates", () => {
    const [d] = htmlValidator('<a target="_top" href="javascript:void 0">x</a>');
    expect(d.message).toMatch(/never allows/);
  });

  it("stays linear on hostile input", () => {
    const started = performance.now();
    htmlValidator("<script ".repeat(8_000));
    expect(performance.now() - started).toBeLessThan(250);
  });
});

// Codex's fourth and fifth reviews, each expectation from WebKit's parser
// (DOMParser) or the trusted frame's behaviour. Detection is approximate and
// advisory; these are the cases it must get right.
describe("html adapter — differential corpus", () => {
  const rules = (html: string) => htmlValidator(html).map((d) => d.ruleId);
  const EXT = "html/script-external";

  it.each([
    // Comment and CDATA boundaries that hid real scripts.
    [`<!--><script src="x.js"></script>`, [EXT]],
    [`<!---><script src="x.js"></script>`, [EXT]],
    [`<!-- --!><script src="x.js"></script>`, [EXT]],
    [`<![CDATA[><script src="x.js"></script>`, [EXT]],
    [`<svg><![cdata[><script src="x.js"></script>]]></svg>`, [EXT]],
    // Unicode case folding must not shift offsets.
    [`İ<script src="x.js"></script>`, [EXT]],
    [`<p title="İ"></p><script src="x.js"></script>`, [EXT]],
    // Not elements at all.
    [`<plaintext><script src="x.js"></script>`, []],
    [`<script src="x.js"`, []],
    // SVG: HTML raw-text rules do not apply; its integration points do.
    [`<svg><title><script src="x.js"></script></title></svg>`, [EXT]],
    [`<svg><script/><a xlink:href="javascript:void 0">go</a></svg>`, ["html/script-blocked", "html/javascript-url"]],
    [`<svg><title><textarea><script src="x.js"></script></textarea></title></svg>`, []],
    // Data blocks are not scripts.
    [`<script type="application/json">{"a":1}</script>`, []],
    [`<script type="module">1</script>`, ["html/script-blocked"]],
    [`<script type="text/javascript">1</script>`, ["html/script-blocked"]],
    // The first of duplicate attributes wins.
    [`<a href="x" href="javascript:void 0">go</a>`, []],
    [`<a onclick="a()" onclick="b()">go</a>`, ["html/inline-handler"]],
    // javascript: only where a link navigates this frame; forms never submit.
    [`<div href="javascript:void 0"></div>`, []],
    [`<iframe src="javascript:void 0"></iframe>`, []],
    [`<form action="javascript:void 0"><button>go</button></form>`, []],
    [`<form><button formtarget="_top" formaction="javascript:void 0">go</button></form>`, []],
    // Character references in attribute values.
    [`<a href="java&#115;cript:void 0">go</a>`, ["html/javascript-url"]],
    [`<a href="javascript&colon;void 0">go</a>`, ["html/javascript-url"]],
    [`<a href="java&Tab;script:void 0">go</a>`, ["html/javascript-url"]],
    // Target resolution as WebKit does it.
    [`<template><base target="_top"></template><a href="javascript:void 0">go</a>`, ["html/javascript-url"]],
    [`<base target><base target="_top"><a href="javascript:void 0">go</a>`, ["html/javascript-url"]],
    [`<a target="&#95;self" href="javascript:void 0">go</a>`, ["html/javascript-url"]],
    [`<a target="" href="javascript:void 0">go</a><base target="_top">`, ["html/javascript-url-navigation"]],
    [`<a target=" _self " href="javascript:void 0">go</a>`, ["html/javascript-url-navigation"]],
    // An embedded srcdoc document is checked too.
    [`<iframe srcdoc="<script src='x.js'></script>"></iframe>`, [EXT]],
    [`<iframe srcdoc="&lt;script&gt;1&lt;/script&gt;"></iframe>`, ["html/script-blocked"]],
  ])("%s → %j", (html, expected) => {
    expect(rules(html)).toEqual(expected);
  });

  it("positions a finding after a Unicode character correctly", () => {
    expect(htmlValidator(`İ<script src="x.js"></script>`)[0].column).toBe(2);
  });

  it("positions srcdoc findings at the srcdoc attribute", () => {
    expect(htmlValidator(`<iframe srcdoc="<script src='x.js'></script>"></iframe>`)[0].column).toBe(9);
  });

  it.each([
    ["duplicate URL attributes", '<a ' + 'href="javascript:void 0" '.repeat(8_000) + ">"],
    ["unique attributes", "<a " + Array.from({ length: 8_000 }, (_, i) => `data-a${i}="x"`).join(" ") + ">"],
    ["nested srcdoc", "<iframe srcdoc=\"".repeat(200) + "x"],
    ["deep nesting", "<div>".repeat(20_000) + "</p>".repeat(20_000)],
  ])("stays fast on hostile input: %s", (_label, html) => {
    const started = performance.now();
    htmlValidator(html);
    expect(performance.now() - started).toBeLessThan(300);
  });
});

// Codex's fifth review: each case below printed a FALSE message (an external
// script that does not exist, a handler that is not one) or missed a real
// finding. Expectations from WebKit's parser and the trusted frame.
describe("html adapter — no false messages, no plausible misses", () => {
  const rules = (html: string) => htmlValidator(html).map((d) => d.ruleId);
  const EXT = "html/script-external";

  it.each([
    // Trusted preview runs with scripting on: noscript content is text.
    [`<noscript><script src="x.js"></script></noscript>`, []],
    // Script data escapes: after <!-- a nested <script> keeps </script> from closing.
    [`<script><!--<script></script><script src="x.js"></script>`, ["html/script-blocked"]],
    [`<script><!-- a --></script><script src="x.js"></script>`, ["html/script-blocked", EXT]],
    // Foreign content: CDATA follows the current element; integration points; breakout.
    [`<svg><title><![CDATA[><script src="x.js"></script>]]></title></svg>`, []],
    [`<math><annotation-xml encoding="text/html"><textarea><script src="x.js"></script></textarea></annotation-xml></math>`, []],
    [`<svg><font color=red><textarea><script src="x.js"></script></textarea></font></svg>`, []],
    // A quoted ">" inside an end tag's attributes does not end the tag.
    [`<textarea>x</textarea data-x="><script src='x.js'></script>">`, []],
    [`<p>x</p data-x="><script src='x.js'></script>">`, []],
    // A numeric reference needs no semicolon.
    [`<a href="java&#115cript:void 0">go</a>`, ["html/javascript-url"]],
    [`<a href="javascrip&#x74:void 0">go</a>`, ["html/javascript-url"]],
    // Hex digits run on: &#x73c is U+073C, so this is not a javascript: URL.
    [`<a href="java&#x73cript:void 0">go</a>`, []],
  ])("%s → %j", (html, expected) => {
    expect(rules(html)).toEqual(expected);
  });

  it.each([
    ["many comments", "<!-- x -->".repeat(16_000)],
    ["many escaped script comments", "<script>" + "<!-- a -->".repeat(16_000) + "</script>"],
    ["many quoted end tags", '</p data-x=">">'.repeat(16_000)],
  ])("stays fast: %s", (_label, html) => {
    const started = performance.now();
    htmlValidator(html);
    expect(performance.now() - started).toBeLessThan(300);
  });
});
