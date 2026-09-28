// @vitest-environment node
/**
 * The one `run_workflow` dispatch transaction (audit-fix 20260928 #120/#122).
 *
 * `useWorkflowExecution.start` and `useGenieInvocation`'s workflow path each
 * carried their own copy of: id generation, the one-run-per-window guard, the
 * store claim, the rollback on a rejected invoke, and the payload — and adding
 * `capturePolicy` (WI-LX1.4) had to be done twice. These pin the shared rules
 * so a third field cannot reach one entry point and miss the other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkflowStore } from "@/stores/workflowStore";
import { dispatchWorkflowRun } from "./dispatchWorkflowRun";
import { resetWorkflowEvents, retainWorkflowEvents } from "./workflowRunEvents";

const PROVIDER = { provider: "openai", apiKey: "k", endpoint: null, cliPath: null } as never;

function setCaptureOnSave(on: boolean): void {
  const general = useSettingsStore.getState().general;
  useSettingsStore.setState({ general: { ...general, coherenceCaptureOnSave: on } });
}

beforeEach(() => {
  invoke.mockReset();
  useWorkflowStore.getState().setExecution(null);
  setCaptureOnSave(false);
  // The window's event owner (the approval dialog in the app) holds the
  // subscription a dispatch waits for.
  resetWorkflowEvents();
  retainWorkflowEvents();
});

afterEach(() => {
  resetWorkflowEvents();
});

describe("dispatchWorkflowRun", () => {
  it("claims the store with a fresh id BEFORE invoking, and sends the full payload", async () => {
    let idAtInvoke: string | null = null;
    invoke.mockImplementation(async () => {
      idAtInvoke = useWorkflowStore.getState().preview.executionId;
      return "backend-id";
    });

    const outcome = await dispatchWorkflowRun({
      yaml: "steps: []",
      workspaceRoot: "/ws",
      env: { A: "1" },
      provider: PROVIDER,
    });

    expect(outcome).toEqual({ status: "dispatched", returnedId: "backend-id" });
    const [cmd, args] = invoke.mock.calls[0];
    expect(cmd).toBe("run_workflow");
    expect(args).toEqual({
      yaml: "steps: []",
      env: { A: "1" },
      workspaceRoot: "/ws",
      provider: PROVIDER,
      executionId: idAtInvoke,
      capturePolicy: "tracked-only",
    });
    expect(idAtInvoke).toEqual(expect.any(String));
    expect(useWorkflowStore.getState().preview.executionId).toBe(idAtInvoke);
  });

  it("defaults env to {} and reads the capture policy at dispatch time", async () => {
    invoke.mockResolvedValue("x");
    setCaptureOnSave(true);

    await dispatchWorkflowRun({ yaml: "y", workspaceRoot: "/ws", provider: null });

    expect(invoke.mock.calls[0][1]).toMatchObject({ env: {}, provider: null, capturePolicy: "adopt" });
  });

  it("refuses a second run without touching the live registration or invoking", async () => {
    useWorkflowStore.getState().setExecution("live");

    const outcome = await dispatchWorkflowRun({ yaml: "y", workspaceRoot: "/ws", provider: null });

    expect(outcome).toEqual({ status: "already-running" });
    expect(invoke).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().preview.executionId).toBe("live");
  });

  it("two dispatches in one tick: exactly one claims the slot", async () => {
    invoke.mockReturnValue(new Promise(() => {}));

    const first = dispatchWorkflowRun({ yaml: "a", workspaceRoot: "/ws", provider: null });
    const second = await dispatchWorkflowRun({ yaml: "b", workspaceRoot: "/ws", provider: null });

    expect(second).toEqual({ status: "already-running" });
    expect(invoke).toHaveBeenCalledTimes(1);
    void first;
  });

  it("a rejected invoke rolls back its own registration and rethrows the original error", async () => {
    const failure = { code: "feature-disabled", message: "off" };
    invoke.mockRejectedValue(failure);

    await expect(
      dispatchWorkflowRun({ yaml: "y", workspaceRoot: "/ws", provider: null }),
    ).rejects.toBe(failure);
    expect(useWorkflowStore.getState().preview.executionId).toBeNull();
  });

  it("a rejected invoke never clears a run registered after it", async () => {
    let reject!: (e: unknown) => void;
    invoke.mockReturnValue(new Promise((_, r) => (reject = r)));

    const pending = dispatchWorkflowRun({ yaml: "y", workspaceRoot: "/ws", provider: null });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled()); // claimed, invoke in flight
    useWorkflowStore.getState().setExecution("newer");
    reject(new Error("boom"));

    await expect(pending).rejects.toThrow("boom");
    expect(useWorkflowStore.getState().preview.executionId).toBe("newer");
  });

  // Audit 20260928 #113/#114: ownership is registered WITH the run, so there
  // is no moment in which the run exists but is nobody's.
  it("registers the owning tab and the YAML it runs WITH the id, before invoking", async () => {
    let atInvoke: { runTabId: string | null; runSource: string | null } | null = null;
    invoke.mockImplementation(async () => {
      const { runTabId, runSource } = useWorkflowStore.getState().preview;
      atInvoke = { runTabId, runSource };
      return "id";
    });

    await dispatchWorkflowRun({
      yaml: "name: a",
      workspaceRoot: "/ws",
      provider: null,
      owner: { tabId: "tab-1", source: "name: a" },
    });

    expect(atInvoke).toEqual({ runTabId: "tab-1", runSource: "name: a" });
  });

  it("a run with no owner (a workflow genie) is registered unowned", async () => {
    invoke.mockResolvedValue("id");
    await dispatchWorkflowRun({ yaml: "y", workspaceRoot: "/ws", provider: null });
    expect(useWorkflowStore.getState().preview.runTabId).toBeNull();
  });

  // #769, now for BOTH entry points: the genie path never waited for the
  // listeners, so a fast genie workflow's first frames could go unrouted.
  it("refuses to dispatch when no event owner holds the subscription, claiming nothing", async () => {
    resetWorkflowEvents();

    await expect(
      dispatchWorkflowRun({ yaml: "y", workspaceRoot: "/ws", provider: null }),
    ).rejects.toThrow(/no workflow event owner/i);
    expect(invoke).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().preview.executionId).toBeNull();
  });
});
