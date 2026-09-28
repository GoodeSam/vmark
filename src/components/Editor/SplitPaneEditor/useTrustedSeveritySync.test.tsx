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
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forEachDiagnostic, lintGutter } from "@codemirror/lint";
import { useDocumentStore } from "@/stores/documentStore";
import { useHtmlTrustStore } from "@/stores/htmlTrustStore";
import { useTrustedSeveritySync } from "./useTrustedSeveritySync";
import { setDiagnostics } from "@codemirror/lint";
import * as presentation from "@/lib/formats/diagnosticPresentation";

// Count reconciliation work: every reconcile presents the findings once.
vi.mock("@/lib/formats/diagnosticPresentation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/formats/diagnosticPresentation")>();
  return { ...actual, presentDiagnostics: vi.fn(actual.presentDiagnostics) };
});
const presentCalls = () => vi.mocked(presentation.presentDiagnostics).mock.calls.length;
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

// Reconciling re-presents every finding and compares two signatures, so it
// must run only when something that can change the answer happened: a lint
// install (a transaction carrying effects) or this pane's trust flipping. On
// a 10,000-finding file, running it per cursor move cost 1.1 s per 100 moves,
// and edits in OTHER tabs paid it too (review finding).
describe("useTrustedSeveritySync — reconciles only on relevant change", () => {
  function setupWithListener() {
    useDocumentStore.getState().initDocument(TAB, "abcdef", PATH);
    useDocumentStore.getState().initDocument("tab-other", "zzz", "/docs/other.html");
    const viewRef: { current: EditorView | null } = { current: null };
    const { result, unmount } = renderHook(() => useTrustedSeveritySync(viewRef, TAB, RULES));
    const view = new EditorView({
      state: EditorState.create({ doc: "abcdef", extensions: [lintGutter(), result.current.trustSeverity] }),
    });
    document.body.append(view.dom);
    viewRef.current = view;
    result.current.onRawLint({ doc: view.state.doc, diagnostics: [finding] });
    return { view, unmount };
  }
  const flush = () => act(async () => { await Promise.resolve(); });

  it("does no work for selection-only transactions", async () => {
    const { view, unmount } = setupWithListener();
    await flush();
    const before = presentCalls();
    for (let i = 0; i < 100; i += 1) view.dispatch({ selection: { anchor: i % 6 } });
    await flush();
    expect(presentCalls()).toBe(before);
    unmount();
    view.destroy();
  });

  it("does no work for edits in another tab", async () => {
    const { view, unmount } = setupWithListener();
    await flush();
    const before = presentCalls();
    act(() => {
      for (let i = 0; i < 20; i += 1) useDocumentStore.getState().setEditorContent("tab-other", `z${i}`);
    });
    await flush();
    expect(presentCalls()).toBe(before);
    unmount();
    view.destroy();
  });

  it("coalesces a burst of lint installs into one reconcile, and still corrects them", async () => {
    const { view, unmount } = setupWithListener();
    act(() => useHtmlTrustStore.getState().grant(PATH, "t".repeat(64)));
    await flush();
    const before = presentCalls();
    const stale = [{ from: 0, to: 3, severity: "warning" as const, message: "m", source: "html/script-blocked" }];
    for (let i = 0; i < 5; i += 1) view.dispatch(setDiagnostics(view.state, stale));
    await flush();
    expect(presentCalls() - before).toBe(1);
    expect(severities(view)).toEqual(["info"]);
    unmount();
    view.destroy();
  });
});
