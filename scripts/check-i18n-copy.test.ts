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
  internalReferenceFindings,
  standaloneTextFindings,
  titleCaseViolations,
} from "./check-i18n-keys";

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
