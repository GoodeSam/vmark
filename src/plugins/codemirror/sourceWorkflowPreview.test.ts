// WI-LX2.4 — the markdown-surface opener of the engine side panel: parses on open, not only on the first edit.
/**
 * The plugin is loaded by the markdown Source editor for a YAML path (a
 * `.yml` file associated with markdown). It used to parse only on a
 * `docChanged` update, so a workflow file opened as it was never showed its
 * panel until the user typed; and its `destroy` reset the whole preview slice,
 * wiping a LIVE run's registration so the run's events stopped routing. The
 * last block runs against the real store, where the run's statuses are visible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { bindWorkflowPort, resetWorkflowPort } from "./workflowPort";
import { sourceWorkflowPreviewExtensions } from "./sourceWorkflowPreview";
import type { WorkflowGraph } from "@/lib/workflow/types";
import { docPreview, useWorkflowStore } from "@/stores/workflowStore";

const ENGINE = "name: demo\nsteps:\n  - id: a\n    uses: action/notify\n";

const TAB = "tab-1";
const calls = {
  setGraph: [] as Array<[WorkflowGraph | null, string | undefined]>,
  tabs: new Set<string>(),
  open: 0,
  close: 0,
};
let panelOpen = false;

beforeEach(() => {
  vi.useFakeTimers();
  calls.setGraph = [];
  calls.tabs = new Set();
  calls.open = calls.close = 0;
  panelOpen = false;
  bindWorkflowPort({
    getState: () => ({
      gha: { byTab: {} },
      view: { selectedJobId: null },
      setGraph: (tabId, graph, error) => {
        calls.tabs.add(tabId);
        calls.setGraph.push([graph, error]);
      },
      previewOpenPanel: (tabId) => {
        calls.tabs.add(tabId);
        calls.open += 1;
        panelOpen = true;
      },
      previewClosePanel: (tabId) => {
        calls.tabs.add(tabId);
        calls.close += 1;
        panelOpen = false;
      },
      selectJob: () => {},
    }),
  });
});

afterEach(() => {
  resetWorkflowPort();
  vi.useRealTimers();
});

function mount(doc: string, tabId = TAB): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, extensions: sourceWorkflowPreviewExtensions(tabId) }),
  });
}

describe("sourceWorkflowPreview", () => {
  it("parses the document it OPENS with — no edit needed to show the panel", () => {
    const view = mount(ENGINE);
    vi.runAllTimers();
    expect(calls.setGraph).toHaveLength(1);
    expect(calls.setGraph[0][0]?.name).toBe("demo");
    expect(calls.open).toBe(1);
    expect([...calls.tabs]).toEqual([TAB]); // every write names its own tab (#129)
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

  it("on leaving the file, clears the graph and closes the panel", () => {
    const view = mount(ENGINE);
    vi.runAllTimers();
    view.destroy();
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

// Audit fix-round #130: the mocked port above records calls, so it could not
// see what `setGraph` DID to the store — which was to wipe the step statuses.
// Opening, re-parsing and leaving the file during a live run erased its
// progress. Against the real store, the run and its statuses survive all three.
describe("sourceWorkflowPreview — against the real workflow store", () => {
  const initialWorkflow = useWorkflowStore.getState();

  beforeEach(() => {
    useWorkflowStore.setState(initialWorkflow, true);
    bindWorkflowPort(useWorkflowStore as never);
    useWorkflowStore.getState().setExecution("run-1", { tabId: TAB, source: ENGINE });
    useWorkflowStore.getState().setStepStatus("a", { status: "success" });
  });

  it("opening, editing and leaving the file keep a live run and its progress", () => {
    const view = mount(ENGINE);
    vi.runAllTimers();
    view.dispatch({ changes: { from: 6, to: 10, insert: "renamed" } });
    vi.runAllTimers();
    expect(docPreview(useWorkflowStore.getState().preview, TAB).graph?.name).toBe("renamed");
    view.destroy();

    const preview = useWorkflowStore.getState().preview;
    expect(docPreview(preview, TAB).graph).toBeNull();
    expect(docPreview(preview, TAB).panelOpen).toBe(false);
    expect(preview.executionId).toBe("run-1");
    expect(preview.runTabId).toBe("tab-1");
    expect(preview.stepStatuses).toEqual({ a: { status: "success" } });
  });
});

// Audit 20260928 #129 — every mounted editor parsed into ONE unkeyed slot, so
// the last debounce timer decided which pane's graph both side panels showed,
// and either editor's destroy cleared the other's graph and closed its panel.
describe("sourceWorkflowPreview — two editors, two tabs (#129)", () => {
  const initialWorkflow = useWorkflowStore.getState();
  const OTHER = "name: other\nsteps:\n  - id: b\n    uses: action/copy\n";

  beforeEach(() => {
    useWorkflowStore.setState(initialWorkflow, true);
    bindWorkflowPort(useWorkflowStore as never);
  });

  it("each editor keeps its own graph and panel, and one's teardown leaves the other's", () => {
    const left = mount(ENGINE, "tab-left");
    const right = mount(OTHER, "tab-right");
    vi.runAllTimers();

    const both = useWorkflowStore.getState().preview;
    expect(docPreview(both, "tab-left").graph?.name).toBe("demo");
    expect(docPreview(both, "tab-right").graph?.name).toBe("other");
    expect(docPreview(both, "tab-left").panelOpen).toBe(true);
    expect(docPreview(both, "tab-right").panelOpen).toBe(true);

    // An edit in the left editor re-parses the left tab only.
    left.dispatch({ changes: { from: 6, to: 10, insert: "left" } });
    vi.runAllTimers();
    expect(docPreview(useWorkflowStore.getState().preview, "tab-right").graph?.name).toBe("other");

    left.destroy();
    const after = useWorkflowStore.getState().preview;
    expect(after.docs["tab-left"]).toBeUndefined();
    expect(docPreview(after, "tab-right").graph?.name).toBe("other");
    expect(docPreview(after, "tab-right").panelOpen).toBe(true);
    right.destroy();
    expect(useWorkflowStore.getState().preview.docs).toEqual({});
  });
});
