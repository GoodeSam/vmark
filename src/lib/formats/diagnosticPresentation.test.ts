// @vitest-environment node
/**
 * Trust-aware diagnostic severity — the ONE mapping both diagnostic surfaces
 * (CodeMirror's lint and the validation list) apply.
 *
 * Validators stay mode-independent: they report what the document contains.
 * What that MEANS depends on the preview mode — "Script tag detected —
 * blocked unless trusted preview is enabled" is a warning while the preview
 * blocks scripts, and information once the user has trusted the document and
 * the scripts run. Displaying it as a warning under "Trusted — scripts
 * enabled" contradicted the banner.
 */
import { describe, it, expect } from "vitest";
import { presentDiagnostics } from "./diagnosticPresentation";
import type { ValidationDiagnostic } from "./types";

const script: ValidationDiagnostic = {
  severity: "warning",
  line: 2,
  column: 44,
  endLine: 2,
  endColumn: 51,
  message: "Script tag detected — blocked unless trusted preview is enabled.",
  ruleId: "html/script-blocked",
};
const parse: ValidationDiagnostic = { severity: "error", line: 1, column: 1, message: "bad", ruleId: "html/parse" };
const noRule: ValidationDiagnostic = { severity: "warning", line: 3, column: 1, message: "x" };
const TRUSTED_RULES = ["html/script-blocked", "html/javascript-url", "html/inline-handler"] as const;

describe("presentDiagnostics", () => {
  it("drops a listed rule to info when the document is trusted, keeping everything else", () => {
    const [shown] = presentDiagnostics([script], TRUSTED_RULES, true);
    expect(shown).toEqual({ ...script, severity: "info" });
  });

  it("leaves unlisted rules and rule-less findings alone when trusted", () => {
    expect(presentDiagnostics([parse, noRule], TRUSTED_RULES, true)).toEqual([parse, noRule]);
  });

  it("changes nothing when the document is not trusted", () => {
    expect(presentDiagnostics([script, parse], TRUSTED_RULES, false)).toEqual([script, parse]);
  });

  it("returns the same array when nothing changes, so React and CodeMirror see no update", () => {
    const input = [script, parse];
    expect(presentDiagnostics(input, TRUSTED_RULES, false)).toBe(input);
    expect(presentDiagnostics(input, undefined, true)).toBe(input);
    expect(presentDiagnostics(input, [], true)).toBe(input);
  });

  it("never raises a severity", () => {
    const info: ValidationDiagnostic = { ...script, severity: "info" };
    expect(presentDiagnostics([info], TRUSTED_RULES, true)).toEqual([info]);
  });
});
