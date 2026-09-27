// WI-LX2.3 — after a run, its pre-run snapshot is offered back, confirmed, and restored.
/**
 * Only the IPC and native-dialog boundaries are faked (`invoke`, `ask`); the
 * workflow store, the snapshot wrappers and the hook are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const ask = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask }));

import { useRunSnapshot } from "../useRunSnapshot";
import { useWorkflowStore } from "@/stores/workflowStore";
import { imeToast } from "@/services/ime/imeToast";

const initialWorkflow = useWorkflowStore.getState();
const SNAPSHOT = { id: "snap-r1", executionId: "r1", timestamp: 9, fileCount: 2, createdCount: 1 };

/** A run owned by tab-1 that has finished. */
function finishedOwnedRun(id = "r1") {
  useWorkflowStore.getState().setExecution(id);
  useWorkflowStore.getState().bindRunToTab(id, "tab-1");
  useWorkflowStore.getState().finishExecution(id, "completed");
}

beforeEach(() => {
  useWorkflowStore.setState(initialWorkflow, true);
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "list_workflow_snapshots") return [SNAPSHOT];
    if (cmd === "restore_workflow_snapshot") return { restored: 2, deleted: 1, skipped: 0 };
    return undefined;
  });
  ask.mockReset();
  ask.mockResolvedValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe("useRunSnapshot — finding the snapshot", () => {
  it("offers the snapshot the owner's finished run took", async () => {
    finishedOwnedRun();
    const { result } = renderHook(() => useRunSnapshot(true));
    await waitFor(() => expect(result.current.snapshot).toEqual(SNAPSHOT));
  });

  it("offers nothing when this tab does not own the run", async () => {
    finishedOwnedRun();
    const { result } = renderHook(() => useRunSnapshot(false));
    await Promise.resolve();
    expect(result.current.snapshot).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("offers nothing while the run is still going", async () => {
    useWorkflowStore.getState().setExecution("r1");
    useWorkflowStore.getState().bindRunToTab("r1", "tab-1");
    const { result } = renderHook(() => useRunSnapshot(true));
    await Promise.resolve();
    expect(result.current.snapshot).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("offers nothing when the run took no snapshot (it wrote no files)", async () => {
    finishedOwnedRun("r2");
    const { result } = renderHook(() => useRunSnapshot(true));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_workflow_snapshots"));
    expect(result.current.snapshot).toBeNull();
  });

  it("a failed listing offers nothing and does not throw", async () => {
    invoke.mockRejectedValue({ code: "io", message: "disk" });
    finishedOwnedRun();
    const { result } = renderHook(() => useRunSnapshot(true));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(result.current.snapshot).toBeNull();
  });
});

describe("useRunSnapshot — restoring", () => {
  async function ready() {
    finishedOwnedRun();
    const hook = renderHook(() => useRunSnapshot(true));
    await waitFor(() => expect(hook.result.current.snapshot).not.toBeNull());
    return hook;
  }

  it("asks first, naming what will change, then restores by id and reports success", async () => {
    const success = vi.spyOn(imeToast, "success").mockImplementation(() => undefined);
    const { result } = await ready();
    await act(async () => {
      await result.current.restore();
    });
    const [message, options] = ask.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain("workflow:restore.confirmChanged");
    expect(message).toContain("workflow:restore.confirmCreated");
    expect(message).toContain("workflow:restore.confirmLoss");
    expect(options.kind).toBe("warning");
    expect(options.okLabel).toBe("workflow:restore.action");
    expect(invoke).toHaveBeenCalledWith("restore_workflow_snapshot", { snapshotId: "snap-r1" });
    expect(success).toHaveBeenCalledWith("workflow:restore.done");
    // Offered once: a second click would clobber edits made since.
    expect(result.current.snapshot).toBeNull();
  });

  it("does nothing when the user declines", async () => {
    ask.mockResolvedValue(false);
    const { result } = await ready();
    await act(async () => {
      await result.current.restore();
    });
    expect(invoke).not.toHaveBeenCalledWith("restore_workflow_snapshot", expect.anything());
    expect(result.current.snapshot).toEqual(SNAPSHOT);
  });

  it("warns with a count when some files could not be restored", async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === "list_workflow_snapshots" ? [SNAPSHOT] : { restored: 1, deleted: 1, skipped: 2 },
    );
    const warning = vi.spyOn(imeToast, "warning").mockReturnValue("w" as never);
    const { result } = await ready();
    await act(async () => {
      await result.current.restore();
    });
    expect(warning).toHaveBeenCalledWith("workflow:restore.partial");
  });

  it("shows a refused restore with its typed message, and keeps the offer", async () => {
    const refusal = { code: "conflict", message: "A workflow is running." };
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_workflow_snapshots") return [SNAPSHOT];
      throw refusal;
    });
    const errorDetail = vi.spyOn(imeToast, "errorDetail").mockReturnValue("e" as never);
    const { result } = await ready();
    await act(async () => {
      await result.current.restore();
    });
    expect(errorDetail).toHaveBeenCalledWith("workflow:restore.failed", refusal);
    expect(result.current.snapshot).toEqual(SNAPSHOT);
    expect(result.current.restoring).toBe(false);
  });
});
