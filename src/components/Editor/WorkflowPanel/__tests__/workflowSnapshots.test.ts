// @vitest-environment node
// WI-LX2.3 — the webview side of snapshot restore: the two IPC calls, validated at the boundary.
import { describe, expect, it, vi, beforeEach } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  findRunSnapshot,
  listWorkflowSnapshots,
  restoreWorkflowSnapshot,
} from "../workflowSnapshots";

const SUMMARY = { id: "snap-r1", executionId: "r1", timestamp: 5, fileCount: 2, createdCount: 1 };

beforeEach(() => invoke.mockReset());

describe("listWorkflowSnapshots", () => {
  it("calls list_workflow_snapshots and returns the summaries", async () => {
    invoke.mockResolvedValueOnce([SUMMARY]);
    await expect(listWorkflowSnapshots()).resolves.toEqual([SUMMARY]);
    expect(invoke).toHaveBeenCalledWith("list_workflow_snapshots");
  });

  it("drops malformed entries rather than trusting the wire", async () => {
    invoke.mockResolvedValueOnce([SUMMARY, { id: 3 }, null, { ...SUMMARY, fileCount: "2" }]);
    await expect(listWorkflowSnapshots()).resolves.toEqual([SUMMARY]);
  });

  // Audit fix-round #117: `typeof "number"` let NaN, Infinity, negatives,
  // fractions and unsafe integers through — `NaN files will be put back`.
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a negative count", -1],
    ["a fraction", 1.5],
    ["an unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("drops a summary whose count is %s", async (_label, bad) => {
    invoke.mockResolvedValueOnce([
      SUMMARY,
      { ...SUMMARY, id: "f", fileCount: bad },
      { ...SUMMARY, id: "c", createdCount: bad },
      { ...SUMMARY, id: "t", timestamp: bad },
    ]);
    await expect(listWorkflowSnapshots()).resolves.toEqual([SUMMARY]);
  });

  it("treats a non-array reply as no snapshots", async () => {
    invoke.mockResolvedValueOnce({ nope: true });
    await expect(listWorkflowSnapshots()).resolves.toEqual([]);
  });

  it("propagates a rejection — the caller decides how to surface it", async () => {
    const err = { code: "io", message: "boom" };
    invoke.mockRejectedValueOnce(err);
    await expect(listWorkflowSnapshots()).rejects.toBe(err);
  });
});

describe("findRunSnapshot", () => {
  it("finds the snapshot a given run took", async () => {
    invoke.mockResolvedValueOnce([{ ...SUMMARY, id: "snap-r0", executionId: "r0" }, SUMMARY]);
    await expect(findRunSnapshot("r1")).resolves.toEqual(SUMMARY);
  });

  it("returns null when the run took none (an action-only workflow writes nothing)", async () => {
    invoke.mockResolvedValueOnce([SUMMARY]);
    await expect(findRunSnapshot("other")).resolves.toBeNull();
  });
});

describe("restoreWorkflowSnapshot", () => {
  it("calls restore_workflow_snapshot with the id only — never a root", async () => {
    invoke.mockResolvedValueOnce({ restored: 2, deleted: 1, skipped: 0 });
    await expect(restoreWorkflowSnapshot("snap-r1")).resolves.toEqual({
      restored: 2,
      deleted: 1,
      skipped: 0,
    });
    expect(invoke).toHaveBeenCalledWith("restore_workflow_snapshot", { snapshotId: "snap-r1" });
  });

  it("refuses a malformed report instead of rendering NaN counts", async () => {
    invoke.mockResolvedValueOnce({ restored: "2" });
    await expect(restoreWorkflowSnapshot("snap-r1")).rejects.toThrow(/restore report/);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "refuses a report carrying the count %s",
    async (bad) => {
      invoke.mockResolvedValueOnce({ restored: 1, deleted: 0, skipped: bad });
      await expect(restoreWorkflowSnapshot("snap-r1")).rejects.toThrow(/restore report/);
    },
  );
});
