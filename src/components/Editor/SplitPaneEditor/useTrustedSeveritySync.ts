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
 *
 * @coordinates-with sourcePaneExtensions.ts — records each lint's raw findings
 * @coordinates-with lib/formats/diagnosticPresentation.ts — the mapping
 * @module components/Editor/SplitPaneEditor/useTrustedSeveritySync
 */
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { setDiagnostics } from "@codemirror/lint";
import { useDocumentStore } from "@/stores/documentStore";
import { useHtmlTrustStore } from "@/stores/htmlTrustStore";
import { presentDiagnostics } from "@/lib/formats/diagnosticPresentation";
import { diagnosticToCodemirror, isDocumentTrusted, type RawLint } from "./sourcePaneExtensions";

/**
 * Subscribe the pane to trust and path changes; returns the linter
 * arguments (`infoWhenTrusted`, and `onRawLint` for each lint's raw findings).
 */
export function useTrustedSeveritySync(
  viewRef: RefObject<EditorView | null>,
  tabId: string,
  infoWhenTrusted: readonly string[] | undefined,
): { infoWhenTrusted: readonly string[] | undefined; onRawLint: (raw: RawLint) => void } {
  const rawRef = useRef<RawLint | null>(null);

  useEffect(() => {
    if (!infoWhenTrusted || infoWhenTrusted.length === 0) return;
    const trustedNow = () =>
      isDocumentTrusted(useDocumentStore.getState().documents?.[tabId]?.filePath ?? null);
    let last = trustedNow();
    const sync = () => {
      const trusted = trustedNow();
      if (trusted === last) return;
      last = trusted;
      const view = viewRef.current;
      const raw = rawRef.current;
      if (!view || !raw || raw.doc !== view.state.doc) return;
      const shown = presentDiagnostics(raw.diagnostics, infoWhenTrusted, trusted);
      view.dispatch(setDiagnostics(view.state, shown.map((d) => diagnosticToCodemirror(view.state.doc, d))));
    };
    const unsubscribeTrust = useHtmlTrustStore.subscribe(sync);
    const unsubscribeDocs = useDocumentStore.subscribe(sync);
    return () => {
      unsubscribeTrust();
      unsubscribeDocs();
    };
  }, [viewRef, tabId, infoWhenTrusted]);

  const onRawLint = useCallback((raw: RawLint) => {
    rawRef.current = raw;
  }, []);
  return useMemo(() => ({ infoWhenTrusted, onRawLint }), [infoWhenTrusted, onRawLint]);
}
