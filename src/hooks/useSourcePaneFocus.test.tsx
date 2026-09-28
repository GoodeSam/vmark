import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRef, type ReactNode, type MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";

// Avoid real CodeMirror state math — the hook only needs a context object.
vi.mock("@/plugins/sourceContextDetection/cursorContext", () => ({
  computeSourceCursorContext: () => ({ marks: {}, block: null }),
}));

import { useSourcePaneFocus, bindSplitSourceView } from "./useSourcePaneFocus";
import { usePaneStore } from "@/stores/paneStore";
import { useEditorStore } from "@/stores/editorStore";
import { useTabStore } from "@/stores/tabStore";
import { PaneProvider } from "@/contexts/PaneContext";
import type { PaneId } from "@/stores/paneStore";

const W = "main";

function fakeView(id: string): EditorView {
  return { id } as unknown as EditorView;
}

function paneWrapper(paneId: PaneId) {
  return ({ children }: { children: ReactNode }) => (
    <PaneProvider value={{ paneId, tabId: `${paneId}-tab` }}>{children}</PaneProvider>
  );
}

beforeEach(() => {
  usePaneStore.setState({ byWindow: {} });
  useEditorStore.getState().clearActiveEditors();
  useTabStore.setState({ activeTabId: { [W]: "tab-1" } } as never);
});

function renderWithView(
  view: EditorView | null,
  hidden: boolean,
  wrapper?: ReturnType<typeof paneWrapper>,
) {
  return renderHook(
    () => {
      const ref = useRef<EditorView | null>(view) as MutableRefObject<EditorView | null>;
      return useSourcePaneFocus(ref, W, hidden);
    },
    wrapper ? { wrapper } : undefined,
  );
}

describe("useSourcePaneFocus (#1081 — ADR-3)", () => {
  it("registers the source view when visible and focused (single pane)", () => {
    const view = fakeView("A");
    const { result } = renderWithView(view, false);
    expect(result.current.current).toBe(true);
    expect(useEditorStore.getState().active.activeSourceView).toBe(view);
    expect(useEditorStore.getState().active.activeSourceTabId).toBe("tab-1");
  });

  it("does not register when hidden", () => {
    const view = fakeView("A");
    renderWithView(view, true);
    expect(useEditorStore.getState().active.activeSourceView).toBeNull();
  });

  it("does not register when the view ref is empty", () => {
    renderWithView(null, false);
    expect(useEditorStore.getState().active.activeSourceView).toBeNull();
  });

  it("an unfocused split pane does not register (ref reflects unfocused)", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab"); // focus = secondary
    const view = fakeView("primary");
    const { result } = renderWithView(view, false, paneWrapper("primary"));
    expect(result.current.current).toBe(false);
    expect(useEditorStore.getState().active.activeSourceView).toBeNull();
  });

  it("the focused split pane registers its source view", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab"); // focus = secondary
    const view = fakeView("secondary");
    const { result } = renderWithView(view, false, paneWrapper("secondary"));
    expect(result.current.current).toBe(true);
    expect(useEditorStore.getState().active.activeSourceView).toBe(view);
  });
});

// WI-LX2.4 — the split-pane SourcePane (yaml, json, …) registers too, under its
// OWN tab and without the markdown cursor context, so the workflow UI and
// every other active-source-view reader can find it.
describe("useSourcePaneFocus — split-pane source (WI-LX2.4)", () => {
  function renderSplitSource(view: EditorView | null, wrapper?: ReturnType<typeof paneWrapper>) {
    return renderHook(
      () => {
        const ref = useRef<EditorView | null>(view) as MutableRefObject<EditorView | null>;
        return useSourcePaneFocus(ref, W, false, { tabId: "yaml-tab", cursorContext: false });
      },
      wrapper ? { wrapper } : undefined,
    );
  }

  it("registers under the pane's own tab id, not the window's active tab", () => {
    const view = fakeView("yaml");
    renderSplitSource(view);
    expect(useEditorStore.getState().active.activeSourceView).toBe(view);
    expect(useEditorStore.getState().active.activeSourceTabId).toBe("yaml-tab");
  });

  it("does not publish a markdown cursor context for a non-markdown source", () => {
    useEditorStore.getState().clearSourceContext(); // earlier suites publish one
    const view = fakeView("yaml");
    renderSplitSource(view);
    expect(useEditorStore.getState().source.editorView).toBeNull();
  });

  it("an unfocused split pane still does not register", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab");
    renderSplitSource(fakeView("primary"), paneWrapper("primary"));
    expect(useEditorStore.getState().active.activeSourceView).toBeNull();
  });
});

describe("bindSplitSourceView (WI-LX2.4)", () => {
  it("registers a freshly created view when focused, and the release forgets only that view", () => {
    const view = fakeView("yaml");
    const release = bindSplitSourceView(view, "yaml-tab", true);
    expect(useEditorStore.getState().active.activeSourceView).toBe(view);
    expect(useEditorStore.getState().active.activeSourceTabId).toBe("yaml-tab");

    // Another editor took over meanwhile: releasing must not clear IT.
    const other = fakeView("md");
    useEditorStore.getState().setActiveSourceView(other, "md-tab");
    release();
    expect(useEditorStore.getState().active.activeSourceView).toBe(other);
  });

  it("releasing the still-registered view clears it", () => {
    const view = fakeView("yaml");
    const release = bindSplitSourceView(view, "yaml-tab", true);
    release();
    expect(useEditorStore.getState().active.activeSourceView).toBeNull();
  });

  it("an unfocused pane's view is not registered", () => {
    bindSplitSourceView(fakeView("yaml"), "yaml-tab", false);
    expect(useEditorStore.getState().active.activeSourceView).toBeNull();
  });
});

// Audit 20260928 #98/#99/#121 — the registration is "the window's active source
// view WHILE this pane is focused". Registering on focus gain without
// forgetting on focus loss left a pane that moved focus to a preview/media pane
// (or any pane with no source editor) still published, so lint, IME and
// selection readers targeted a document the user had left.
describe("useSourcePaneFocus — focus transitions (audit 20260928)", () => {
  function renderPane(
    view: EditorView,
    paneId: PaneId,
    options?: { tabId?: string; cursorContext?: boolean },
  ) {
    return renderHook(
      () => {
        const ref = useRef<EditorView | null>(view) as MutableRefObject<EditorView | null>;
        return useSourcePaneFocus(ref, W, false, options);
      },
      { wrapper: paneWrapper(paneId) },
    );
  }

  it("forgets its view when split focus moves to a pane with no source editor", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab");
    usePaneStore.getState().setFocusedPane(W, "primary");
    const view = fakeView("yaml");
    renderPane(view, "primary", { tabId: "yaml-tab", cursorContext: false });
    expect(useEditorStore.getState().active.activeSourceView).toBe(view);

    act(() => usePaneStore.getState().setFocusedPane(W, "secondary"));
    expect(useEditorStore.getState().active.activeSourceView).toBeNull();
    expect(useEditorStore.getState().active.activeSourceTabId).toBeNull();
  });

  it("forgets a view registered at creation (bindSplitSourceView) when focus leaves", () => {
    // The pane's first effect run sees no view yet — the creation effect
    // registers it — so the loss must clear by identity, not by undoing a
    // registration this effect itself made.
    usePaneStore.getState().openSplit(W, "secondary-tab");
    usePaneStore.getState().setFocusedPane(W, "primary");
    const view = fakeView("yaml");
    const ref = { current: null as EditorView | null };
    renderHook(() => useSourcePaneFocus(ref, W, false, { tabId: "yaml-tab", cursorContext: false }), {
      wrapper: paneWrapper("primary"),
    });
    ref.current = view;
    bindSplitSourceView(view, "yaml-tab", true);
    expect(useEditorStore.getState().active.activeSourceView).toBe(view);

    act(() => usePaneStore.getState().setFocusedPane(W, "secondary"));
    expect(useEditorStore.getState().active.activeSourceView).toBeNull();
  });

  it("source → source: the newly focused pane wins, whichever effect runs first", () => {
    usePaneStore.getState().openSplit(W, "secondary-tab");
    usePaneStore.getState().setFocusedPane(W, "primary");
    const left = fakeView("left");
    const right = fakeView("right");
    renderPane(left, "primary", { tabId: "left-tab", cursorContext: false });
    renderPane(right, "secondary", { tabId: "right-tab", cursorContext: false });
    expect(useEditorStore.getState().active.activeSourceView).toBe(left);

    act(() => usePaneStore.getState().setFocusedPane(W, "secondary"));
    expect(useEditorStore.getState().active.activeSourceView).toBe(right);
    expect(useEditorStore.getState().active.activeSourceTabId).toBe("right-tab");

    act(() => usePaneStore.getState().setFocusedPane(W, "primary"));
    expect(useEditorStore.getState().active.activeSourceView).toBe(left);
    expect(useEditorStore.getState().active.activeSourceTabId).toBe("left-tab");
  });

  it("a non-markdown pane taking focus drops the markdown pane's cursor context", () => {
    // Otherwise the toolbar and context menu, which act on `source.editorView`,
    // would format the OTHER pane's markdown while the yaml pane is focused.
    usePaneStore.getState().openSplit(W, "secondary-tab");
    usePaneStore.getState().setFocusedPane(W, "primary");
    const md = fakeView("md");
    const yaml = fakeView("yaml");
    renderPane(md, "primary");
    renderPane(yaml, "secondary", { tabId: "yaml-tab", cursorContext: false });
    expect(useEditorStore.getState().source.editorView).toBe(md);

    act(() => usePaneStore.getState().setFocusedPane(W, "secondary"));
    expect(useEditorStore.getState().active.activeSourceView).toBe(yaml);
    expect(useEditorStore.getState().source.editorView).toBeNull();
  });

  it("bindSplitSourceView activating a non-markdown view drops a stale markdown context too", () => {
    const md = fakeView("md");
    useEditorStore.getState().setSourceContext({ marks: {}, block: null } as never, md);
    bindSplitSourceView(fakeView("yaml"), "yaml-tab", true);
    expect(useEditorStore.getState().source.editorView).toBeNull();
  });
});
