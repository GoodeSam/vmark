/**
 * useTrustedSeveritySync — keep CodeMirror's diagnostics in step with trust.
 *
 * Purpose: when the user trusts or un-trusts the document, or Save As moves it
 * to another path, re-present the findings the pane already has at the
 * severity that now applies (lib/formats/diagnosticPresentation.ts) — without
 * an edit, without re-validating, without rebuilding the editor.
 *
 * Key decisions:
 *   - Replace diagnostics with `setDiagnostics`. `forceLinting()` is a no-op
 *     when no lint is pending (measured in review), so "re-lint on trust
 *     change" silently did nothing.
 *   - Trust is a function of the grant AND the path: both stores are inputs,
 *     so Save As to an untrusted path shows the warning again.
 *   - Findings recorded for an older document version are never re-applied:
 *     their positions no longer describe the text, and the edit that made
 *     them stale has already scheduled a lint that presents fresh ones.
 *   - Reconcile, don't push: compare what CodeMirror shows with what it should
 *     show, and dispatch only on a difference. It runs when this pane's trust
 *     flips AND after each lint install (a transaction carrying effects),
 *     because a result is installed a microtask after it is computed — a trust
 *     change inside that window was corrected and then overwritten by the
 *     queued install (review finding). Nothing else triggers it: re-presenting
 *     every finding per cursor move or per edit in another tab was measurable
 *     on large files.
 *
 * @coordinates-with sourcePaneExtensions.ts — records each lint's raw findings
 * @coordinates-with lib/formats/diagnosticPresentation.ts — the mapping
 * @module components/Editor/SplitPaneEditor/useTrustedSeveritySync
 */
import { useEffect, useMemo, useState, type RefObject } from "react";
import { EditorView } from "@codemirror/view";
import { Annotation, type Extension } from "@codemirror/state";
import { forEachDiagnostic, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { useDocumentStore } from "@/stores/documentStore";
import { useHtmlTrustStore } from "@/stores/htmlTrustStore";
import { presentDiagnostics } from "@/lib/formats/diagnosticPresentation";
import { diagnosticToCodemirror, isDocumentTrusted, type RawLint } from "./sourcePaneExtensions";

type Shown = Pick<Diagnostic, "from" | "to" | "severity" | "message">;

/** Marks this hook's own corrective dispatch, so it does not re-check itself. */
const reconciled = Annotation.define<true>();

/** Order-independent identity of a diagnostic set, severity included. */
function signature(diagnostics: readonly Shown[]): string {
  return diagnostics
    .map((d) => `${d.from}:${d.to}:${d.severity}:${d.message}`)
    .sort()
    .join("\n");
}

/**
 * One pane's severity state, created once per pane. Plain mutable fields
 * rather than refs: the lint and the listener read them long after render.
 */
class TrustSeverityController {
  private raw: RawLint | null = null;
  private tabId = "";
  private infoWhenTrusted: readonly string[] | undefined;
  private pending = false;

  configure(tabId: string, infoWhenTrusted: readonly string[] | undefined): void {
    this.tabId = tabId;
    this.infoWhenTrusted = infoWhenTrusted;
  }

  readonly onRawLint = (raw: RawLint): void => {
    this.raw = raw;
  };

  /** Whether this pane's document is trusted right now (grant AND path). */
  trustedNow(): boolean {
    return isDocumentTrusted(useDocumentStore.getState().documents?.[this.tabId]?.filePath ?? null);
  }

  /** Make what CodeMirror SHOWS match the raw findings presented for the
   *  current trust — a no-op when it already does, so it cannot loop. */
  readonly reconcile = (view: EditorView): void => {
    const info = this.infoWhenTrusted;
    const raw = this.raw;
    if (!info || info.length === 0 || !raw || raw.doc !== view.state.doc) return;
    const trusted = this.trustedNow();
    const desired = presentDiagnostics(raw.diagnostics, info, trusted).map((d) => diagnosticToCodemirror(view.state.doc, d));
    const shown: Shown[] = [];
    forEachDiagnostic(view.state, (d, from, to) => shown.push({ from, to, severity: d.severity, message: d.message }));
    if (signature(shown) === signature(desired)) return;
    view.dispatch({ ...setDiagnostics(view.state, desired), annotations: reconciled.of(true) });
  };

  /** A lint result is installed a microtask after it is computed, so a trust
   *  change inside that window was corrected and then overwritten by the
   *  queued install. Re-checking after every transaction catches the install
   *  whenever it lands. Deferred: a listener may not dispatch mid-update. */
  /*  Reconciling re-presents every finding, so it runs only when an answer can
   *  have changed: an install is a transaction carrying the linter's
   *  setDiagnostics effect — typing and cursor moves carry none — and a burst
   *  of them coalesces into one check. */
  readonly extension: Extension = EditorView.updateListener.of((update) => {
    const installs = update.transactions.some((tr) => tr.effects.length > 0 && !tr.annotation(reconciled));
    if (this.pending || !installs) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      // A pane torn down in the meantime has left the document.
      if (update.view.dom.isConnected) this.reconcile(update.view);
    });
  });
}

/**
 * Subscribe the pane to trust and path changes; returns the linter
 * arguments (`infoWhenTrusted`, `onRawLint` for each lint's raw findings) and
 * `trustSeverity`, the extension that re-checks after every transaction.
 */
export function useTrustedSeveritySync(
  viewRef: RefObject<EditorView | null>,
  tabId: string,
  infoWhenTrusted: readonly string[] | undefined,
): {
  infoWhenTrusted: readonly string[] | undefined;
  onRawLint: (raw: RawLint) => void;
  trustSeverity: Extension;
} {
  const [controller] = useState(() => new TrustSeverityController());

  useEffect(() => {
    controller.configure(tabId, infoWhenTrusted);
    if (!infoWhenTrusted || infoWhenTrusted.length === 0) return;
    // The stores change on every edit in EVERY tab; only a change of THIS
    // pane's trust (the grant, or its path) can change the answer.
    let last = controller.trustedNow();
    const sync = () => {
      const trusted = controller.trustedNow();
      if (trusted === last) return;
      last = trusted;
      const view = viewRef.current;
      if (view) controller.reconcile(view);
    };
    const unsubscribeTrust = useHtmlTrustStore.subscribe(sync);
    const unsubscribeDocs = useDocumentStore.subscribe(sync);
    return () => {
      unsubscribeTrust();
      unsubscribeDocs();
    };
  }, [controller, viewRef, tabId, infoWhenTrusted]);

  return useMemo(
    () => ({ infoWhenTrusted, onRawLint: controller.onRawLint, trustSeverity: controller.extension }),
    [controller, infoWhenTrusted],
  );
}
