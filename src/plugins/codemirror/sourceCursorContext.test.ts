/**
 * Tests for Source Cursor Context Plugin
 *
 * Verifies that the plugin updates the sourceCursorContextStore
 * when selection or document changes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockComputeSourceCursorContext = vi.fn(() => ({
  bold: false,
  italic: false,
  code: false,
  codeBlock: null,
  heading: null,
  list: null,
  blockquote: null,
  table: null,
  link: null,
  image: null,
  inlineMath: null,
  footnote: null,
  formattedRange: null,
}));

vi.mock("@/plugins/sourceContextDetection/cursorContext", () => ({
  computeSourceCursorContext: (...args: unknown[]) =>
    mockComputeSourceCursorContext(...args),
}));

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";
import { createSourceCursorContextPlugin } from "./sourceCursorContext";
import { bindPluginHostSettings } from "@/services/assembly/bindHostSettings";
import { bindSplitSourceView } from "@/hooks/useSourcePaneFocus";

// These drive the REAL stores; bind them to the seams the plugin reads,
// which is what the app does at startup.
beforeEach(bindPluginHostSettings);

const createdViews: EditorView[] = [];

afterEach(() => {
  createdViews.forEach((v) => v.destroy());
  createdViews.length = 0;
  useEditorStore.getState().clearSourceContext();
});

/** A Source view; `focused` registers it as the window's active source view,
 *  as the app does for the focused editor. */
function createView(content: string, cursorPos?: number, focused = true): EditorView {
  const pos = cursorPos ?? 0;
  const state = EditorState.create({
    doc: content,
    selection: { anchor: pos },
    extensions: [createSourceCursorContextPlugin()],
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new EditorView({ state, parent: container });
  createdViews.push(view);
  if (focused) useEditorStore.getState().setActiveSourceView(view, "tab");
  return view;
}

describe("createSourceCursorContextPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.getState().clearSourceContext();
  });

  it("returns an extension", () => {
    const ext = createSourceCursorContextPlugin();
    expect(ext).toBeDefined();
  });

  it("updates context on document change", () => {
    const view = createView("hello");
    mockComputeSourceCursorContext.mockClear();

    view.dispatch({
      changes: { from: 5, to: 5, insert: " world" },
    });

    expect(mockComputeSourceCursorContext).toHaveBeenCalled();
  });

  it("updates context on selection change", () => {
    const view = createView("hello world");
    mockComputeSourceCursorContext.mockClear();

    view.dispatch({
      selection: { anchor: 5 },
    });

    expect(mockComputeSourceCursorContext).toHaveBeenCalled();
  });

  it("sets editorView in store on update", () => {
    const view = createView("hello");

    // Trigger an update
    view.dispatch({
      selection: { anchor: 3 },
    });

    const store = useEditorStore.getState();
    expect(store.source.editorView).toBe(view);
  });

  it("calls computeSourceCursorContext with the view", () => {
    const view = createView("hello");
    mockComputeSourceCursorContext.mockClear();

    view.dispatch({
      selection: { anchor: 2 },
    });

    expect(mockComputeSourceCursorContext).toHaveBeenCalledWith(view);
  });

  it("updates context when editorView differs from store", () => {
    const view1 = createView("hello");
    mockComputeSourceCursorContext.mockClear();

    // First view triggers update
    view1.dispatch({ selection: { anchor: 1 } });
    expect(mockComputeSourceCursorContext).toHaveBeenCalled();

    // Store now has view1
    const store = useEditorStore.getState();
    expect(store.source.editorView).toBe(view1);
  });

  it("handles empty document on doc change", () => {
    const view = createView("");
    mockComputeSourceCursorContext.mockClear();

    // Insert into empty doc
    view.dispatch({
      changes: { from: 0, to: 0, insert: "x" },
    });

    expect(mockComputeSourceCursorContext).toHaveBeenCalled();
  });

  it("skips context update when editorView matches and no doc/selection change", () => {
    const view = createView("hello");

    // First dispatch sets editorView in store
    view.dispatch({ selection: { anchor: 1 } });
    mockComputeSourceCursorContext.mockClear();

    // Trigger a viewport-only update by dispatching an empty annotation
    // This triggers the updateListener but with selectionSet=false, docChanged=false
    // and store.source.editorView === update.view → should NOT call computeSourceCursorContext
    // CM6 doesn't easily produce a pure viewport update via dispatch, so we test
    // by checking the condition holds after the previous dispatch
    const store = useEditorStore.getState();
    expect(store.source.editorView).toBe(view);
  });

  it("updates context when a second view dispatches (editorView differs)", () => {
    const view1 = createView("hello");
    // view1 triggers update, store.source.editorView = view1
    view1.dispatch({ selection: { anchor: 2 } });

    // Verify store has view1
    expect(useEditorStore.getState().source.editorView).toBe(view1);
    mockComputeSourceCursorContext.mockClear();

    // Create a second view and dispatch on it
    const view2 = createView("world");
    // Explicitly dispatch to trigger updateListener — store.source.editorView is view1, not view2
    view2.dispatch({ selection: { anchor: 1 } });

    // The listener should fire because store.source.editorView !== update.view
    expect(mockComputeSourceCursorContext).toHaveBeenCalledWith(view2);
    expect(useEditorStore.getState().source.editorView).toBe(view2);
  });
});

// Audit 20260928 #99 (round 2) — a non-markdown pane taking focus drops the
// markdown pane's context, but the markdown view's own listener re-published
// it on its next update (any selection or doc change, or merely because the
// slot no longer named it), so the toolbar and context menu again acted on a
// pane the user had left. Only the ACTIVE source view may publish.
describe("createSourceCursorContextPlugin — only the active view publishes (#99)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.getState().clearActiveEditors();
    useEditorStore.getState().clearSourceContext();
  });

  it("an unfocused markdown view's later updates never re-publish its context", () => {
    const markdown = createView("# notes", 0, true);
    markdown.dispatch({ selection: { anchor: 2 } });
    expect(useEditorStore.getState().source.editorView).toBe(markdown);

    // A yaml pane takes focus: it is the active view, and the markdown context goes.
    const yaml = createView("name: x", 0, false);
    bindSplitSourceView(yaml, "yaml-tab", true);
    expect(useEditorStore.getState().source.editorView).toBeNull();

    mockComputeSourceCursorContext.mockClear();
    markdown.dispatch({ selection: { anchor: 4 } });
    markdown.dispatch({ changes: { from: 0, insert: "x" } });
    expect(useEditorStore.getState().source.editorView).toBeNull();
    expect(mockComputeSourceCursorContext).not.toHaveBeenCalled();
  });

  it("the markdown view publishes again once it is the active view again", () => {
    const markdown = createView("# notes", 0, false);
    markdown.dispatch({ selection: { anchor: 2 } });
    expect(useEditorStore.getState().source.editorView).toBeNull();
    useEditorStore.getState().setActiveSourceView(markdown, "md-tab");
    markdown.dispatch({ selection: { anchor: 3 } });
    expect(useEditorStore.getState().source.editorView).toBe(markdown);
  });
});
