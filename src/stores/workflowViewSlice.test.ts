// @vitest-environment node
// WI-LX2.4 — the canvas view slice: selection per document, layout direction as a preference.
import { describe, expect, it } from "vitest";
import {
  clearSelection,
  initialView,
  resetView,
  selectJob,
  selectStep,
  setLayoutDirection,
  type ViewSlice,
} from "./workflowViewSlice";

function view(patch: Partial<ViewSlice> = {}): ViewSlice {
  return { ...initialView, ...patch };
}

describe("workflowViewSlice", () => {
  it("starts with no selection, top-down", () => {
    expect(initialView).toEqual({
      selectedJobId: null,
      selectedStepId: null,
      layoutDirection: "TD",
    });
  });

  it("selectJob selects the job and drops any step selection", () => {
    expect(selectJob(view({ selectedJobId: "a", selectedStepId: "s" }), "b")).toEqual(
      view({ selectedJobId: "b", selectedStepId: null }),
    );
  });

  it("selectStep selects both the job and the step", () => {
    expect(selectStep(view(), "a", "s")).toEqual(view({ selectedJobId: "a", selectedStepId: "s" }));
  });

  it("clearSelection clears both and keeps the direction", () => {
    expect(
      clearSelection(view({ selectedJobId: "a", selectedStepId: "s", layoutDirection: "LR" })),
    ).toEqual(view({ layoutDirection: "LR" }));
  });

  it.each(["TD", "LR", "BT", "RL"] as const)("setLayoutDirection(%s)", (dir) => {
    expect(setLayoutDirection(view(), dir).layoutDirection).toBe(dir);
  });

  it("resetView — a switch to another document — clears the selection but keeps the chosen direction", () => {
    // The direction is how the user likes to READ a workflow, not a fact about
    // one document; the workbench resets the view on every document switch.
    expect(
      resetView(view({ selectedJobId: "a", selectedStepId: "s", layoutDirection: "LR" })),
    ).toEqual(view({ layoutDirection: "LR" }));
  });

  it("carries no matrix-expansion state — nothing renders an expanded matrix", () => {
    expect(Object.keys(initialView)).not.toContain("expandedMatrices");
  });
});
