/**
 * Trust-aware diagnostic severity.
 *
 * Purpose: the ONE mapping from what a validator found to how severe it is
 * SHOWN, applied identically by both diagnostic surfaces — CodeMirror's lint
 * (SourcePane, via useTrustedSeveritySync) and the validation list
 * (SplitPaneEditor → ValidationGutter).
 *
 * Key decisions:
 *   - Validators stay mode-independent: they report what the document
 *     contains. Whether a finding is a warning depends on the preview mode —
 *     "Script tag detected — blocked unless trusted preview is enabled" warns
 *     while scripts are blocked, and is information once the user has trusted
 *     the document and they run. Shown as a warning under "Trusted — scripts
 *     enabled", it contradicted the banner.
 *   - Mapped at presentation, not inside the validator: a trust change then
 *     re-presents the findings it already has instead of re-validating, and
 *     no validator cache has to learn about trust.
 *   - A format opts in by listing rule ids (`FormatConfig.infoWhenTrusted`);
 *     severity is only ever lowered, and the input array is returned as-is
 *     when nothing changes.
 *   - Pure: WHETHER a document is trusted is the caller's input (the stores
 *     live above lib/, which stays a leaf layer — `lint:deps`).
 *
 * @module lib/formats/diagnosticPresentation
 */
import type { ValidationDiagnostic } from "./types";

/** The diagnostics as they should be displayed for a trusted/untrusted document. */
export function presentDiagnostics(
  diagnostics: readonly ValidationDiagnostic[],
  infoWhenTrusted: readonly string[] | undefined,
  trusted: boolean,
): readonly ValidationDiagnostic[] {
  if (!trusted || !infoWhenTrusted || infoWhenTrusted.length === 0) return diagnostics;
  const lowered = new Set(infoWhenTrusted);
  let changed = false;
  const out = diagnostics.map((d) => {
    if (d.ruleId === undefined || !lowered.has(d.ruleId) || d.severity === "info") return d;
    changed = true;
    return { ...d, severity: "info" as const };
  });
  return changed ? out : diagnostics;
}
