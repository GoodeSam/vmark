// @vitest-environment node
// WI-LX2.4 — the preview slice's pure transitions, including which tab owns a run.
import { describe, expect, it } from "vitest";
import type { WorkflowGraph } from "@/lib/workflow/types";
import {
  bindRunToTab,
  finishExecution,
  initialPreview,
  resetStatuses,
  setActiveStepId,
  setExecution,
  setGraph,
  setPanelOpen,
  setStepStatus,
  togglePanel,
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
  it("starts idle, closed, owned by nobody", () => {
    expect(initialPreview).toEqual({
      panelOpen: false,
      graph: null,
      parseError: null,
      activeStepId: null,
      executionId: null,
      stepStatuses: {},
      lastRunOutcome: null,
      lastExecutionId: null,
      runTabId: null,
    });
  });
});

describe("panel open state", () => {
  it("setPanelOpen sets, togglePanel flips", () => {
    expect(setPanelOpen(slice(), true).panelOpen).toBe(true);
    expect(togglePanel(slice({ panelOpen: true })).panelOpen).toBe(false);
    expect(togglePanel(slice()).panelOpen).toBe(true);
  });
});

describe("setGraph", () => {
  it("replaces the graph and clears selection + statuses, but keeps the live run", () => {
    const before = slice({
      activeStepId: "a",
      stepStatuses: { a: { status: "success" } },
      executionId: "run-1",
      runTabId: "tab-1",
    });
    const next = setGraph(before, GRAPH);
    expect(next.graph).toBe(GRAPH);
    expect(next.parseError).toBeNull();
    expect(next.activeStepId).toBeNull();
    expect(next.stepStatuses).toEqual({});
    expect(next.executionId).toBe("run-1");
    expect(next.runTabId).toBe("tab-1");
  });

  it("records a parse error with no graph", () => {
    const next = setGraph(slice({ graph: GRAPH }), null, "bad yaml");
    expect(next.graph).toBeNull();
    expect(next.parseError).toBe("bad yaml");
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
  });

  it("setExecution(null) — a rolled-back start — leaves nothing owned", () => {
    const next = setExecution(slice({ executionId: "run-1", runTabId: "tab-1" }), null);
    expect(next.executionId).toBeNull();
    expect(next.runTabId).toBeNull();
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

describe("bindRunToTab", () => {
  it("binds the live run to the tab that started it", () => {
    const next = bindRunToTab(slice({ executionId: "run-1" }), "run-1", "tab-1");
    expect(next.runTabId).toBe("tab-1");
  });

  it("binds a run that already FINISHED — a fast workflow can end before invoke resolves", () => {
    const finished = finishExecution(slice({ executionId: "run-1" }), "run-1", "completed");
    expect(bindRunToTab(finished, "run-1", "tab-1").runTabId).toBe("tab-1");
  });

  it("refuses to bind a run this window is not tracking (same reference)", () => {
    const other = slice({ executionId: "run-2" });
    expect(bindRunToTab(other, "run-1", "tab-1")).toBe(other);
    const idle = slice();
    expect(bindRunToTab(idle, "run-1", "tab-1")).toBe(idle);
  });

  it("re-binding to the same tab is a no-op (same reference)", () => {
    const bound = slice({ executionId: "run-1", runTabId: "tab-1" });
    expect(bindRunToTab(bound, "run-1", "tab-1")).toBe(bound);
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

  it("setActiveStepId selects and deselects", () => {
    expect(setActiveStepId(slice(), "a").activeStepId).toBe("a");
    expect(setActiveStepId(slice({ activeStepId: "a" }), null).activeStepId).toBeNull();
  });
});
