/**
 * SourcePane — trust-aware severity on the CodeMirror surface.
 *
 * Integration, with the REAL document and trust stores: a trust grant must
 * re-present the findings the pane already has — "Script tag detected" as
 * info once the user trusted the file, warning otherwise — without an edit,
 * without rebuilding the editor, and without losing the finding. Written
 * from a refute review (Codex) of the first design, whose checks these are:
 *   - forceLinting() is a no-op when no lint is pending, so a trust change
 *     must replace diagnostics directly, not "re-lint";
 *   - Save As changes the path without changing content, so the path is an
 *     input exactly like the grant;
 *   - a test asserting "0 warnings" also passes if the diagnostic vanished,
 *     so each step asserts the finding, its message and its range survive.
 */
import { render, cleanup, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { forEachDiagnostic, forceLinting } from "@codemirror/lint";
import { undo } from "@codemirror/commands";
import { SourcePane } from "./SourcePane";
import { useDocumentStore } from "@/stores/documentStore";
import { useHtmlTrustStore } from "@/stores/htmlTrustStore";
import { htmlFormat } from "@/lib/formats/adapters/html";

const TAB = "tab-trust";
const A = "/docs/a.html";
const B = "/docs/b.html";
const TOKEN = "a".repeat(64);
const DOC = "<!doctype html>\n<p>x</p><script>1</script>\n";

function mount(path: string | null = A) {
  useDocumentStore.getState().initDocument(TAB, DOC, path);
  const r = render(<SourcePane tabId={TAB} formatId="html" formatConfig={htmlFormat} />);
  const view = EditorView.findFromDOM(r.container.querySelector(".cm-editor") as HTMLElement)!;
  forceLinting(view);
  return { ...r, view };
}

function findings(view: EditorView) {
  const out: { severity: string; message: string; from: number; to: number }[] = [];
  forEachDiagnostic(view.state, (d, from, to) => out.push({ severity: d.severity, message: d.message, from, to }));
  return out;
}
const severities = (view: EditorView) => findings(view).map((f) => f.severity);

beforeEach(() => {
  useHtmlTrustStore.getState().clearAll();
});

afterEach(() => {
  cleanup();
  useHtmlTrustStore.getState().clearAll();
});

describe("SourcePane trust-aware severity", () => {
  it("shows the script finding as a warning while the document is untrusted", async () => {
    const { view } = mount();
    await waitFor(() => expect(severities(view)).toEqual(["warning"]));
  });

  it("grant → info, revoke → warning, clearAll → warning — no edit, same finding, same editor", async () => {
    const { view, container } = mount();
    await waitFor(() => expect(severities(view)).toEqual(["warning"]));
    const [before] = findings(view);

    act(() => useHtmlTrustStore.getState().grant(A, TOKEN));
    expect(findings(view)).toEqual([{ ...before, severity: "info" }]);

    act(() => useHtmlTrustStore.getState().revoke(A));
    expect(findings(view)).toEqual([before]);

    act(() => useHtmlTrustStore.getState().grant(A, TOKEN));
    act(() => useHtmlTrustStore.getState().clearAll());
    expect(findings(view)).toEqual([before]);

    expect(EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)).toBe(view);
  });

  it("follows the path: Save As to an untrusted path shows the warning again", async () => {
    const { view } = mount(A);
    await waitFor(() => expect(severities(view)).toEqual(["warning"]));
    act(() => useHtmlTrustStore.getState().grant(A, TOKEN));
    expect(severities(view)).toEqual(["info"]);

    act(() => useDocumentStore.getState().setFilePath(TAB, B));
    expect(severities(view)).toEqual(["warning"]);
    act(() => useDocumentStore.getState().setFilePath(TAB, A));
    expect(severities(view)).toEqual(["info"]);
    act(() => useDocumentStore.getState().setFilePath(TAB, null));
    expect(severities(view)).toEqual(["warning"]);
  });

  it("a grant for another path changes nothing", async () => {
    const { view } = mount(A);
    await waitFor(() => expect(severities(view)).toEqual(["warning"]));
    act(() => useHtmlTrustStore.getState().grant(B, TOKEN));
    expect(severities(view)).toEqual(["warning"]);
  });

  it("keeps the undo history across a trust toggle", async () => {
    const { view } = mount(A);
    await waitFor(() => expect(severities(view)).toEqual(["warning"]));
    act(() => view.dispatch({ changes: { from: 0, insert: "<!-- x -->" } }));
    act(() => useHtmlTrustStore.getState().grant(A, TOKEN));
    act(() => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("survives rapid toggles and ends in the state of the last one", async () => {
    const { view } = mount(A);
    await waitFor(() => expect(severities(view)).toEqual(["warning"]));
    act(() => {
      for (let i = 0; i < 10; i += 1) {
        useHtmlTrustStore.getState().grant(A, TOKEN);
        useHtmlTrustStore.getState().revoke(A);
      }
      useHtmlTrustStore.getState().grant(A, TOKEN);
    });
    expect(severities(view)).toEqual(["info"]);
  });

  it("stops listening on unmount", async () => {
    const { view, unmount } = mount(A);
    await waitFor(() => expect(severities(view)).toEqual(["warning"]));
    unmount();
    const dispatch = vi.spyOn(view, "dispatch");
    act(() => useHtmlTrustStore.getState().grant(A, TOKEN));
    expect(dispatch).not.toHaveBeenCalled();
  });
});
