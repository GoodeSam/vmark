/**
 * useTrustedSeveritySync — re-presenting findings when trust or path changes.
 *
 * The behavioural cycle (grant/revoke/clearAll/Save As/unmount) is proven
 * end-to-end in SourcePane.trustSeverity.test.tsx. This pins the guard the
 * integration cannot easily reach: findings recorded for an OLDER document
 * version are never re-applied to newer text — their positions no longer
 * mean anything, and the lint the edit scheduled will present fresh ones.
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forEachDiagnostic, lintGutter } from "@codemirror/lint";
import { useDocumentStore } from "@/stores/documentStore";
import { useHtmlTrustStore } from "@/stores/htmlTrustStore";
import { useTrustedSeveritySync } from "./useTrustedSeveritySync";
import type { ValidationDiagnostic } from "@/lib/formats/types";

const TAB = "tab-sync";
const PATH = "/docs/s.html";
const RULES = ["html/script-blocked"];
const finding: ValidationDiagnostic = {
  severity: "warning", line: 1, column: 1, endLine: 1, endColumn: 4, message: "m", ruleId: "html/script-blocked",
};

function setup() {
  useDocumentStore.getState().initDocument(TAB, "abcdef", PATH);
  const view = new EditorView({ state: EditorState.create({ doc: "abcdef", extensions: [lintGutter()] }) });
  const viewRef = { current: view };
  const { result, unmount } = renderHook(() => useTrustedSeveritySync(viewRef, TAB, RULES));
  return { view, onRawLint: result.current.onRawLint, unmount };
}

const severities = (view: EditorView) => {
  const out: string[] = [];
  forEachDiagnostic(view.state, (d) => out.push(d.severity));
  return out;
};

afterEach(() => useHtmlTrustStore.getState().clearAll());

describe("useTrustedSeveritySync", () => {
  it("re-presents the recorded findings when trust flips", () => {
    const { view, onRawLint, unmount } = setup();
    onRawLint({ doc: view.state.doc, diagnostics: [finding] });
    act(() => useHtmlTrustStore.getState().grant(PATH, "t".repeat(64)));
    expect(severities(view)).toEqual(["info"]);
    unmount();
    view.destroy();
  });

  it("does not re-apply findings recorded for an older document version", () => {
    const { view, onRawLint, unmount } = setup();
    onRawLint({ doc: view.state.doc, diagnostics: [finding] });
    view.dispatch({ changes: { from: 0, insert: "XYZ" } });
    act(() => useHtmlTrustStore.getState().grant(PATH, "t".repeat(64)));
    expect(severities(view)).toEqual([]);
    unmount();
    view.destroy();
  });
});
