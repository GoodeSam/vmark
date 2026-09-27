// WI-LX2.4 — the markdown-surface opener of the engine side panel: parses on open, not only on the first edit.
/**
 * The plugin is loaded by the markdown Source editor for a YAML path (a
 * `.yml` file associated with markdown). It used to parse only on a
 * `docChanged` update, so a workflow file opened as it was never showed its
 * panel until the user typed; and its `destroy` reset the whole preview slice,
 * wiping a LIVE run's registration so the run's events stopped routing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { bindWorkflowPort, resetWorkflowPort } from "./workflowPort";
import { sourceWorkflowPreviewExtensions } from "./sourceWorkflowPreview";
import type { WorkflowGraph } from "@/lib/workflow/types";

const ENGINE = "name: demo\nsteps:\n  - id: a\n    uses: action/notify\n";

const calls = {
  setGraph: [] as Array<[WorkflowGraph | null, string | undefined]>,
  open: 0,
  close: 0,
  reset: 0,
};
let panelOpen = false;

beforeEach(() => {
  vi.useFakeTimers();
  calls.setGraph = [];
  calls.open = calls.close = calls.reset = 0;
  panelOpen = false;
  bindWorkflowPort({
    getState: () => ({
      preview: { panelOpen },
      gha: { byTab: {} },
      view: { selectedJobId: null },
      setGraph: (graph, error) => calls.setGraph.push([graph, error]),
      previewOpenPanel: () => {
        calls.open += 1;
        panelOpen = true;
      },
      previewClosePanel: () => {
        calls.close += 1;
        panelOpen = false;
      },
      resetPreview: () => {
        calls.reset += 1;
      },
      selectJob: () => {},
    }),
  });
});

afterEach(() => {
  resetWorkflowPort();
  vi.useRealTimers();
});

function mount(doc: string): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, extensions: sourceWorkflowPreviewExtensions }),
  });
}

describe("sourceWorkflowPreview", () => {
  it("parses the document it OPENS with — no edit needed to show the panel", () => {
    const view = mount(ENGINE);
    vi.runAllTimers();
    expect(calls.setGraph).toHaveLength(1);
    expect(calls.setGraph[0][0]?.name).toBe("demo");
    expect(calls.open).toBe(1);
    view.destroy();
  });

  it("re-parses after an edit, debounced", () => {
    const view = mount(ENGINE);
    vi.runAllTimers();
    view.dispatch({ changes: { from: 6, to: 10, insert: "renamed" } });
    view.dispatch({ changes: { from: 0, insert: "" } });
    vi.runAllTimers();
    expect(calls.setGraph.at(-1)?.[0]?.name).toBe("renamed");
    view.destroy();
  });

  it("reports a validation error instead of a graph", () => {
    const view = mount("steps:\n  - uses: action/notify\n");
    vi.runAllTimers();
    expect(calls.setGraph[0]).toEqual([null, "Workflow must have a 'name' field"]);
    expect(calls.open).toBe(0);
    view.destroy();
  });

  it("closes the panel for YAML that is not an engine workflow", () => {
    const view = mount("name: config\nversion: 1\n");
    vi.runAllTimers();
    expect(calls.setGraph[0]).toEqual([null, undefined]);
    expect(calls.close).toBe(1);
    view.destroy();
  });

  it("on leaving the file, clears the graph and closes the panel — but never resets a live run", () => {
    const view = mount(ENGINE);
    vi.runAllTimers();
    view.destroy();
    expect(calls.reset).toBe(0);
    expect(calls.setGraph.at(-1)).toEqual([null, undefined]);
    expect(panelOpen).toBe(false);
  });

  it("a pending parse does not fire after the view is gone", () => {
    const view = mount(ENGINE);
    view.destroy();
    const before = calls.setGraph.length;
    vi.runAllTimers();
    expect(calls.setGraph).toHaveLength(before);
  });
});
