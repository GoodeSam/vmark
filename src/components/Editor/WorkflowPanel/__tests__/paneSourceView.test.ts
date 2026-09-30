// WI-LX2.4 — the workbench reaches ITS pane's source view, never another document's.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EditorView } from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";
import { paneSourceView } from "../paneSourceView";

/** Two split-pane editors side by side, as a document split lays them out. */
function twoPanes() {
  const make = () => {
    const pane = document.createElement("div");
    pane.className = "split-pane-editor";
    const source = document.createElement("div");
    source.className = "cm-editor";
    const workbench = document.createElement("div");
    pane.append(source, workbench);
    document.body.append(pane);
    return { source, workbench };
  };
  return { left: make(), right: make() };
}

function register(dom: HTMLElement) {
  const view = { dom } as unknown as EditorView;
  useEditorStore.getState().setActiveSourceView(view, "tab");
  return view;
}

beforeEach(() => useEditorStore.getState().clearActiveEditors());
afterEach(() => {
  document.body.replaceChildren();
});

describe("paneSourceView", () => {
  it("returns the active source view when it lives in the same split pane", () => {
    const { left } = twoPanes();
    const view = register(left.source);
    expect(paneSourceView(left.workbench)).toBe(view);
  });

  it("refuses the active view of the OTHER pane — a line jump would move another document's caret", () => {
    const { left, right } = twoPanes();
    register(left.source);
    expect(paneSourceView(right.workbench)).toBeNull();
  });

  it("refuses a markdown Source editor that is in no split pane at all", () => {
    const { right } = twoPanes();
    const markdown = document.createElement("div");
    document.body.append(markdown);
    register(markdown);
    expect(paneSourceView(right.workbench)).toBeNull();
  });

  it("refuses a view that is no longer in the document", () => {
    const { left } = twoPanes();
    register(left.source);
    left.source.remove();
    expect(paneSourceView(left.workbench)).toBeNull();
  });

  it("returns null with no active view", () => {
    const { left } = twoPanes();
    expect(paneSourceView(left.workbench)).toBeNull();
  });

  it("outside any split pane, the active view is the only candidate", () => {
    const loose = document.createElement("div");
    const source = document.createElement("div");
    document.body.append(loose, source);
    const view = register(source);
    expect(paneSourceView(loose)).toBe(view);
  });
});
