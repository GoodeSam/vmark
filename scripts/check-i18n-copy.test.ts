// WI-UI4.2 — the copy-convention classifier: casing register comes from the
// KEY pattern, and the title-case word test knows stop words, interpolations
// and possessive pronouns.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkCopyConventions,
  dialogLiteralFindings,
  emdashSpacingViolation,
  fragmentSiteFindings,
  fragmentUsageFindings,
  internalReferenceFindings,
  referenceFindingsExcept,
  staleReferenceExceptions,
  standaloneTextFindings,
  titleCaseViolations,
} from "./check-i18n-keys";

describe("emdashSpacingViolation — English copy spaces its em-dashes", () => {
  it.each([["Sandboxed—scripts blocked"], ["Sandboxed —scripts"], ["Sandboxed— scripts"], ["{{name}}—copy"]])(
    "flags an unspaced em-dash: %s",
    (value) => {
      expect(emdashSpacingViolation(value)).toBe(true);
    },
  );

  it.each([["Sandboxed — scripts blocked"], ["-- → —— between CJK"], ["中文—中文"], ["Trailing —"], ["— leading"], [""]])(
    "accepts spaced, doubled CJK, CJK-adjacent and edge dashes: %s",
    (value) => {
      expect(emdashSpacingViolation(value)).toBe(false);
    },
  );
});

describe("titleCaseViolations (R14)", () => {
  it.each([
    ["Save As…", false],
    ["Keep My Changes", false],
    ["Clear Recent Files", false],
    ["Open in New Window", false],
    ["Copy on select", true],
    ["Keep my Changes", true],
    ["Reload all", true],
  ])("%s → violation=%s", (value, expected) => {
    expect(titleCaseViolations(value)).toBe(expected);
  });

  it("ignores interpolations entirely", () => {
    expect(titleCaseViolations("Delete {{name}}")).toBe(false);
    expect(titleCaseViolations("Close {{count}} Tabs")).toBe(false);
  });

  it("an empty or symbol-only value is never a violation", () => {
    expect(titleCaseViolations("…")).toBe(false);
    expect(titleCaseViolations("")).toBe(false);
  });
});

describe("dialogLiteralFindings (WI-UI4.1 dialog/toast literal scan)", () => {
  it("flags a bare sonner toast() literal — the primary sonner API", () => {
    const src = `import { toast } from "sonner";\ntoast("Saved the file");`;
    const problems = dialogLiteralFindings("src/a.ts", src);
    expect(problems.some((p) => p.includes("hardcoded string"))).toBe(true);
  });

  it("follows an import alias — import { toast as notify } cannot evade", () => {
    const src = `import { toast as notify } from "sonner";\nnotify.error("It broke badly");`;
    const problems = dialogLiteralFindings("src/a.ts", src);
    expect(problems.some((p) => p.includes("hardcoded string"))).toBe(true);
  });

  it("a LOCAL function named toast is not sonner — no false positive", () => {
    const src = `function toast(msg: string) { return msg; }\ntoast("just a helper call");`;
    expect(dialogLiteralFindings("src/a.ts", src)).toEqual([]);
  });

  it("a keyed toast passes", () => {
    const src = `import { toast } from "sonner";\nimport i18n from "@/i18n";\ntoast(i18n.t("dialog:toast.saved"));`;
    expect(dialogLiteralFindings("src/a.ts", src)).toEqual([]);
  });
});

describe("checkCopyConventions baseline handling (fail closed)", () => {
  it("a missing baseline WITHOUT --update-copy fails instead of rewriting it", () => {
    const missing = join(tmpdir(), `copy-baseline-missing-${process.pid}.json`);
    expect(existsSync(missing)).toBe(false);
    expect(checkCopyConventions(false, missing)).toBe(false);
    expect(existsSync(missing)).toBe(false); // and it must NOT have written one
  });
});

describe("internalReferenceFindings — no internal identifiers in UI copy", () => {
  // "HTML preview is sandboxed but pending OWASP sign-off (WI-3.4)." shipped to
  // every user in ten languages; so did an issue number in a shortcut
  // description and a design-decision id in a tooltip. Nothing looked.
  it.each([
    ["pending OWASP sign-off (WI-3.4).", ["WI-", "OWASP", "sign-off"]],
    ["Open two documents side by side (#1081)", ["issue-ref"]],
    ["only established claims can constrain (D4)", ["decision-id"]],
    ["see ADR-013 for details", ["ADR-"]],
    ["TODO: wire this up", ["TODO"]],
    ["Selection keeps its ink (R6)", ["decision-id"]],
  ])("flags %j", (value, expected) => {
    expect(internalReferenceFindings(value)).toEqual(expected);
  });

  it.each([
    "Paper size (A4)",
    "Letter (8.5 × 11 in)",
    "Heading 1 (#)",
    "Version 2.1",
    "Sign in to continue",
    "{{count}} issues found",
  ])("accepts ordinary copy: %j", (value) => {
    expect(internalReferenceFindings(value)).toEqual([]);
  });
});

describe("standaloneTextFindings — a string that must work on its own", () => {
  // "({{line}}:{{column}})" is a SUFFIX, correct after "Cannot render", but it
  // was also rendered alone — a red strip reading "(6:1)". A value with no
  // words once placeholders go is a fragment, and must be registered as one.
  it("flags a value with no words that is not a registered fragment", () => {
    expect(standaloneTextFindings({ "preview.errorAt": "({{line}}:{{column}})" }, {})).toEqual([
      "preview.errorAt",
    ]);
  });

  it("accepts a registered fragment", () => {
    expect(
      standaloneTextFindings(
        { "preview.errorAt": "({{line}}:{{column}})" },
        { "preview.errorAt": "suffix after preview.cannotRender" },
      ),
    ).toEqual([]);
  });

  it("accepts values with words, and symbol-only values without placeholders", () => {
    expect(standaloneTextFindings({ a: "{{count}} files", b: "…", c: "·" }, {})).toEqual([]);
  });
});

describe("internalReferenceFindings — Codex review of #1465 (executed probes)", () => {
  it.each([
    ["確立済みに昇格 — 制約になれるのは確立済みの設定のみです（D4）", ["decision-id"]],
    ["提升为已确立 — 只有已确立的设定才能作为约束（D4）", ["decision-id"]],
    ["See #12 for details", ["issue-ref"]],
    ["pending security sign\u2011off", ["sign-off"]],
  ])("catches %j", (value, expected) => {
    expect(internalReferenceFindings(value)).toEqual(expected);
  });

  // These MATCH by design — a token alone cannot tell "(C4)" the envelope from
  // "(C4)" the decision id. Legitimate uses go in the reviewed exceptions list.
  it.each([["Envelope size (C4)"], ["Use #123 as the colour"], ["Press (R2) to continue"]])(
    "flags %j, so a legitimate use must be a reviewed exception",
    (value) => {
      expect(internalReferenceFindings(value).length).toBeGreaterThan(0);
    },
  );
});

describe("fragmentUsageFindings — a fragment never rendered alone", () => {
  // The registry alone did not stop the original defect: restoring
  // <div role="status">{t("preview.errorAt", …)}</div> still passed.
  const fragments = { "editor.json:preview.errorAt": "suffix" };

  it("flags a JSX element whose only content is a fragment", () => {
    const tsx = `export const A = () => <div className="hint" role="status">{t("preview.errorAt", { line: 1, column: 2 })}</div>;`;
    expect(fragmentUsageFindings("a.tsx", tsx, fragments)).toEqual(["a.tsx: preview.errorAt rendered alone"]);
  });

  it("accepts a fragment appended to a sentence", () => {
    const tsx = `export const A = () => <div><span>{t("preview.cannotRender")}</span>{t("preview.errorAt", { line: 1, column: 2 })}</div>;`;
    expect(fragmentUsageFindings("a.tsx", tsx, fragments)).toEqual([]);
  });

  it("recognizes the namespaced key form", () => {
    const tsx = `export const A = () => <span>{t("editor:preview.errorAt", { line: 1, column: 2 })}</span>;`;
    expect(fragmentUsageFindings("a.tsx", tsx, fragments)).toEqual(["a.tsx: preview.errorAt rendered alone"]);
  });
});

describe("reference exceptions are scoped to the approved token (Codex second pass)", () => {
  const exception = { token: "(C4)", reason: "envelope size, not a decision id" };

  it("exempts only the approved token", () => {
    expect(referenceFindingsExcept("Envelope (C4)", exception)).toEqual([]);
    expect(referenceFindingsExcept("Enveloppe (C4)", exception)).toEqual([]);
  });

  it("still catches anything else in the same string", () => {
    expect(referenceFindingsExcept("Envelope (C4) — TODO See #12", exception)).toEqual(["issue-ref", "TODO"]);
  });

  it("an exception whose token left the English value is stale", () => {
    expect(staleReferenceExceptions({ "a.json:k": "Envelope C4" }, { "a.json:k": exception })).toEqual(["a.json:k"]);
    expect(staleReferenceExceptions({ "a.json:k": "Envelope (C4)" }, { "a.json:k": exception })).toEqual([]);
    expect(staleReferenceExceptions({}, { "a.json:gone": exception })).toEqual(["a.json:gone"]);
  });
});

describe("fragmentUsageFindings — Codex second pass", () => {
  const fragments = { "editor.json:preview.errorAt": "suffix" };
  const flag = ["a.tsx: preview.errorAt rendered alone"];

  it("catches an aliased translate function", () => {
    const tsx = `export const A = () => { const { t: translate } = useTranslation(); return <div>{translate("preview.errorAt", { line: 1, column: 2 })}</div>; };`;
    expect(fragmentUsageFindings("a.tsx", tsx, fragments)).toEqual(flag);
  });

  it("catches <Trans i18nKey> rendering a fragment alone", () => {
    const tsx = `export const A = () => <div role="status"><Trans i18nKey="preview.errorAt" /></div>;`;
    expect(fragmentUsageFindings("a.tsx", tsx, fragments)).toEqual(flag);
  });

  it("a comment beside the fragment is not a sentence", () => {
    const tsx = `export const A = () => <div>{/* hint */}{t("preview.errorAt")}</div>;`;
    expect(fragmentUsageFindings("a.tsx", tsx, fragments)).toEqual(flag);
  });

  it("accepts a fragment in an inline wrapper after its sentence", () => {
    const tsx = `export const A = () => <div>Cannot render <span>{t("preview.errorAt")}</span></div>;`;
    expect(fragmentUsageFindings("a.tsx", tsx, fragments)).toEqual([]);
  });

  it("accepts the adapters' conditional hint after 'Cannot render'", () => {
    const tsx = `export const A = () => <div className="x"><span>{t("preview.cannotRender")}</span>{d && (<span className="hint">{" "}{t("preview.errorAt", { line: 1, column: 2 })}</span>)}</div>;`;
    expect(fragmentUsageFindings("a.tsx", tsx, fragments)).toEqual([]);
  });

  it("does not match the same key in another namespace", () => {
    const tsx = `export const A = () => <div>{t("other:preview.errorAt")}</div>;`;
    expect(fragmentUsageFindings("a.tsx", tsx, fragments)).toEqual([]);
  });
});

describe("fragmentUsageFindings — Codex third pass", () => {
  const fragments = { "editor.json:preview.errorAt": "suffix" };
  const flag = ["a.tsx: preview.errorAt rendered alone"];
  const probe = (jsx: string) => fragmentUsageFindings("a.tsx", `export const A = () => ${jsx};`, fragments);

  it.each([
    [`<div><span>Cannot render {t("preview.errorAt")}</span></div>`],
    [`<div>Cannot render <a>{t("preview.errorAt")}</a></div>`],
    [`<div>Cannot render <u>{t("preview.errorAt")}</u></div>`],
    [`<div>{ok ? "Cannot render " + t("preview.errorAt") : null}</div>`],
    [`<Trans>{ok ? "Cannot render " + t("preview.errorAt") : null}</Trans>`],
  ])("accepts a fragment that has its sentence: %s", (jsx) => {
    expect(probe(jsx)).toEqual([]);
  });

  it.each([[`<>{t("preview.errorAt")}</>`], [`<div>{null}{t("preview.errorAt")}</div>`], [`<div>{false}{undefined}{t("preview.errorAt")}</div>`]])(
    "flags a fragment whose only company renders nothing: %s",
    (jsx) => {
      expect(probe(jsx)).toEqual(flag);
    },
  );
});

describe("fragmentUsageFindings — Codex fourth pass", () => {
  const fragments = { "editor.json:preview.errorAt": "suffix" };
  const flag = ["a.tsx: preview.errorAt rendered alone"];
  const probe = (jsx: string) => fragmentUsageFindings("a.tsx", `export const A = () => ${jsx};`, fragments);

  it.each([
    [`<div><></>{t("preview.errorAt")}</div>`],
    [`<div>{true && null}{t("preview.errorAt")}</div>`],
    [`<div>{ok ? null : false}{t("preview.errorAt")}</div>`],
    [`<Trans i18nKey="preview.errorAt" />`],
    [`<Trans i18nKey="preview.errorAt"></Trans>`],
    [`<div><Trans i18nKey={"preview.errorAt"} /></div>`],
  ])("flags: %s", (jsx) => {
    expect(probe(jsx)).toEqual(flag);
  });

  it.each([
    [`<div>{["Cannot render", t("preview.errorAt")].join(" ")}</div>`],
    [`<div data-testid={t("preview.errorAt")}>Cannot render</div>`],
    [`<div key={t("preview.errorAt")}>Cannot render</div>`],
  ])("accepts: %s", (jsx) => {
    expect(probe(jsx)).toEqual([]);
  });
});

describe("fragmentSiteFindings — a fragment is used only where it is registered", () => {
  const registry = { "editor.json:preview.errorAt": { where: "suffix", files: ["src/a.tsx"] } };

  it("accepts a use in a registered file", () => {
    expect(fragmentSiteFindings({ "src/a.tsx": `t("preview.errorAt")` }, registry)).toEqual([]);
  });

  it.each([
    [`toast.error(t("preview.errorAt"));`],
    [`const suffix = t("preview.errorAt");`],
    [`const KEY = "editor:preview.errorAt";`],
  ])("flags a use in an unregistered file: %s", (text) => {
    expect(fragmentSiteFindings({ "src/a.tsx": `t("preview.errorAt")`, "src/b.ts": text }, registry)).toEqual([
      "src/b.ts: uses fragment preview.errorAt, but its registration does not list this file",
    ]);
  });

  it("ignores the same key in another namespace", () => {
    expect(fragmentSiteFindings({ "src/a.tsx": `t("preview.errorAt")`, "src/b.ts": `t("other:preview.errorAt")` }, registry)).toEqual([]);
  });

  it("flags a registered file that no longer uses the fragment", () => {
    expect(fragmentSiteFindings({ "src/a.tsx": `t("preview.cannotRender")` }, registry)).toEqual([
      "src/a.tsx: registered for fragment preview.errorAt but no longer uses it — delete it from the registration",
    ]);
  });
});

describe("Codex fifth pass — fragments", () => {
  const fragments = { "editor.json:preview.errorAt": "suffix" };
  const probe = (jsx: string) => fragmentUsageFindings("a.tsx", `export const A = () => ${jsx};`, fragments);

  it.each([[`<div><span>{null}</span>{t("preview.errorAt")}</div>`], [`<div><span /><b></b>{t("preview.errorAt")}</div>`]])(
    "an empty wrapper element is no company: %s",
    (jsx) => {
      expect(probe(jsx)).toEqual(["a.tsx: preview.errorAt rendered alone"]);
    },
  );

  it("a wrapper element holding text is company", () => {
    expect(probe(`<div><span>Cannot render</span> {t("preview.errorAt")}</div>`)).toEqual([]);
  });

});
