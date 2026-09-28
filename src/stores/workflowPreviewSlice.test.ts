// @vitest-environment node
// WI-LX2.4 — the preview slice's pure transitions, including which tab owns a run.
import { describe, expect, it } from "vitest";
import type { WorkflowGraph } from "@/lib/workflow/types";
import {
  docPreview,
  finishExecution,
  initialPreview,
  markRunRestored,
  resetStatuses,
  setExecution,
  setGraph,
  setPanelOpen,
  setStepStatus,
  type PreviewSlice,
} from "./workflowPreviewSlice";

const GRAPH: WorkflowGraph = {
  name: "demo",
  triggers: [],
  env: {},
  defaults: {},
  steps: [],
  edges: [],
};

function slice(patch: Partial<PreviewSlice> = {}): PreviewSlice {
  return { ...initialPreview, ...patch };
}

describe("initialPreview", () => {
  it("starts idle, with no document preview, owned by nobody", () => {
    expect(initialPreview).toEqual({
      docs: {},
      executionId: null,
      stepStatuses: {},
      lastRunOutcome: null,
      lastExecutionId: null,
      runTabId: null,
      runSource: null,
      restoredExecutionId: null,
      displacedRun: null,
    });
  });
});

// Audit 20260928 #129 — the markdown surface's preview (graph, parse error,
// panel open) is PER TAB. It was one window-global slot, so two Source editors
// in a split overwrote each other on every re-parse, and either one's teardown
// cleared the other's graph and closed its panel.
describe("per-tab document preview (#129)", () => {
  it("a tab with no preview reads as closed, graphless and error-free", () => {
    expect(docPreview(slice(), "tab-1")).toEqual({ panelOpen: false, graph: null, parseError: null });
    expect(docPreview(slice(), null)).toEqual({ panelOpen: false, graph: null, parseError: null });
    // Stable reference, so a selector over it never re-renders on its own.
    expect(docPreview(slice(), "tab-1")).toBe(docPreview(slice(), "tab-2"));
  });

  it("setPanelOpen opens and closes ONE tab's panel", () => {
    const open = setPanelOpen(slice(), "tab-1", true);
    expect(docPreview(open, "tab-1").panelOpen).toBe(true);
    expect(docPreview(open, "tab-2").panelOpen).toBe(false);
    expect(setPanelOpen(open, "tab-1", false).docs).toEqual({});
  });

  it("two tabs keep their own graph and error; clearing one leaves the other", () => {
    const both = setGraph(setGraph(slice(), "tab-1", GRAPH), "tab-2", null, "bad yaml");
    expect(docPreview(both, "tab-1").graph).toBe(GRAPH);
    expect(docPreview(both, "tab-2").parseError).toBe("bad yaml");
    const left = setGraph(both, "tab-1", null);
    expect(left.docs["tab-1"]).toBeUndefined(); // an empty preview is dropped, not kept
    expect(docPreview(left, "tab-2").parseError).toBe("bad yaml");
  });
});

describe("setGraph", () => {
  // Audit fix-round #130: clearing the statuses here wiped a LIVE run's progress
  // every time the source pane re-parsed — on open, on every keystroke, and on
  // leaving the file. Statuses belong to the run; whether they are painted is
  // decided against the text that ran (`runSource`), not by erasing them.
  it("replaces the tab's graph, but keeps the run and its statuses", () => {
    const before = slice({
      stepStatuses: { a: { status: "success" } },
      executionId: "run-1",
      runTabId: "tab-1",
    });
    const next = setGraph(before, "tab-1", GRAPH);
    expect(docPreview(next, "tab-1").graph).toBe(GRAPH);
    expect(docPreview(next, "tab-1").parseError).toBeNull();
    expect(next.stepStatuses).toEqual({ a: { status: "success" } });
    expect(next.executionId).toBe("run-1");
    expect(next.runTabId).toBe("tab-1");
  });

  it("records a parse error with no graph", () => {
    const next = setGraph(setGraph(slice(), "tab-1", GRAPH), "tab-1", null, "bad yaml");
    expect(docPreview(next, "tab-1").graph).toBeNull();
    expect(docPreview(next, "tab-1").parseError).toBe("bad yaml");
  });
});

describe("a run's lifecycle", () => {
  it("setExecution starts a fresh, UNOWNED run and forgets the previous one", () => {
    const before = slice({
      stepStatuses: { a: { status: "error" } },
      lastRunOutcome: "failed",
      lastExecutionId: "run-0",
      runTabId: "tab-1",
    });
    const next = setExecution(before, "run-1");
    expect(next.executionId).toBe("run-1");
    expect(next.stepStatuses).toEqual({});
    expect(next.lastRunOutcome).toBeNull();
    expect(next.lastExecutionId).toBeNull();
    expect(next.runTabId).toBeNull();
    expect(next.runSource).toBeNull();
  });

  // Audit 20260928 #113/#114 — ownership is registered WITH the run, in one
  // write. Binding it after the start resolved left a window in which the run
  // was registered but nobody's: a panel's Cancel could then target a run that
  // another pane or a genie had registered, and a panel remounted during the
  // start saw its own run as someone else's.
  it("setExecution with an owner registers the run AND its owner in one write", () => {
    const next = setExecution(slice(), "run-1", { tabId: "tab-1", source: "name: a\n" });
    expect(next.executionId).toBe("run-1");
    expect(next.runTabId).toBe("tab-1");
    expect(next.runSource).toBe("name: a\n");
  });

  it("setExecution(null) — a rolled-back start — leaves nothing owned", () => {
    const next = setExecution(slice({ executionId: "run-1", runTabId: "tab-1" }), null);
    expect(next.executionId).toBeNull();
    expect(next.runTabId).toBeNull();
  });

  // Audit fix-round #156: a start used to ERASE the finished run before the
  // backend admitted it, so a refused start left that run's outcome, owner and
  // restore offer unreachable. The refused start now puts it back.
  it("a refused start puts back the finished run it displaced", () => {
    const finished = slice({
      stepStatuses: { a: { status: "error" } },
      lastRunOutcome: "failed",
      lastExecutionId: "run-0",
      runTabId: "tab-1",
      runSource: "name: a\n",
    });
    const rolledBack = setExecution(setExecution(finished, "run-1"), null);
    expect(rolledBack.executionId).toBeNull();
    expect(rolledBack.lastExecutionId).toBe("run-0");
    expect(rolledBack.lastRunOutcome).toBe("failed");
    expect(rolledBack.runTabId).toBe("tab-1");
    expect(rolledBack.runSource).toBe("name: a\n");
    expect(rolledBack.stepStatuses).toEqual({ a: { status: "error" } });
    expect(rolledBack.displacedRun).toBeNull();
  });

  it("a FINISHED start drops the displaced run for good", () => {
    const finished = slice({ lastExecutionId: "run-0", lastRunOutcome: "completed", runTabId: "t" });
    const ended = finishExecution(setExecution(finished, "run-1"), "run-1", "cancelled");
    expect(ended.displacedRun).toBeNull();
    expect(setExecution(ended, null).lastExecutionId).toBeNull();
  });

  it("finishExecution keeps the statuses and the owner, and remembers WHICH run ended", () => {
    const running = slice({
      executionId: "run-1",
      runTabId: "tab-1",
      stepStatuses: { a: { status: "success", duration: 5 } },
    });
    const done = finishExecution(running, "run-1", "completed");
    expect(done.executionId).toBeNull();
    expect(done.lastRunOutcome).toBe("completed");
    expect(done.lastExecutionId).toBe("run-1");
    expect(done.runTabId).toBe("tab-1");
    expect(done.stepStatuses).toEqual({ a: { status: "success", duration: 5 } });
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "records the %s outcome",
    (outcome) => {
      expect(finishExecution(slice({ executionId: "r" }), "r", outcome).lastRunOutcome).toBe(
        outcome,
      );
    },
  );

  it("a terminal frame for another run is a no-op (same reference)", () => {
    const running = slice({ executionId: "run-2" });
    expect(finishExecution(running, "run-1", "failed")).toBe(running);
    const idle = slice();
    expect(finishExecution(idle, "run-1", "failed")).toBe(idle);
  });
});

describe("markRunRestored", () => {
  // Audit fix-round #109: the "offered once" rule lived in one component's
  // state, so a remounted panel offered the same restore again.
  it("records the run whose snapshot was restored, in the store", () => {
    const done = slice({ lastExecutionId: "run-1" });
    expect(markRunRestored(done, "run-1").restoredExecutionId).toBe("run-1");
  });

  it("survives a refused start that puts the run back", () => {
    const restored = markRunRestored(slice({ lastExecutionId: "run-1" }), "run-1");
    const back = setExecution(setExecution(restored, "run-2"), null);
    expect(back.lastExecutionId).toBe("run-1");
    expect(back.restoredExecutionId).toBe("run-1");
  });
});

describe("step status transitions", () => {
  it("setStepStatus adds without disturbing other steps", () => {
    const next = setStepStatus(slice({ stepStatuses: { a: { status: "success" } } }), "b", {
      status: "running",
    });
    expect(next.stepStatuses).toEqual({ a: { status: "success" }, b: { status: "running" } });
  });

  it("resetStatuses clears only the statuses", () => {
    const next = resetStatuses(slice({ stepStatuses: { a: { status: "success" } }, executionId: "r" }));
    expect(next.stepStatuses).toEqual({});
    expect(next.executionId).toBe("r");
  });
});
