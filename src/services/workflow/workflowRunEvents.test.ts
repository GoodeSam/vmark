// @vitest-environment node
/**
 * The window's ONE workflow-event subscription (audit 20260928 #115).
 *
 * Every mounted run panel, plus the always-mounted approval dialog, used to
 * subscribe its own copy of the three runner events, so each frame was
 * handled N times. These pin the singleton: one listener set however many
 * retain it, released with the last retainer, transactional on failure, and
 * a readiness check a start can await without subscribing anything itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: { payload: unknown }) => void;
const listen = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({ listen }));

import { useWorkflowStore } from "@/stores/workflowStore";
import { resetWorkflowEvents, retainWorkflowEvents, workflowEventsReady } from "./workflowRunEvents";

const handlers = new Map<string, Listener>();
const unlistens: Array<ReturnType<typeof vi.fn>> = [];
const initialWorkflow = useWorkflowStore.getState();

function listenImmediately(): void {
  listen.mockImplementation(async (name: string, handler: Listener) => {
    handlers.set(name, handler);
    const unlisten = vi.fn(() => handlers.delete(name));
    unlistens.push(unlisten);
    return unlisten;
  });
}

beforeEach(() => {
  resetWorkflowEvents();
  listen.mockReset();
  handlers.clear();
  unlistens.length = 0;
  useWorkflowStore.setState(initialWorkflow, true);
  listenImmediately();
});

describe("retainWorkflowEvents — one subscription per window", () => {
  it("subscribes the three runner events ONCE however many retainers hold it", async () => {
    const releases = [retainWorkflowEvents(), retainWorkflowEvents(), retainWorkflowEvents()];
    await workflowEventsReady();
    expect(listen).toHaveBeenCalledTimes(3);
    expect([...handlers.keys()].sort()).toEqual([
      "workflow:approval-request",
      "workflow:complete",
      "workflow:step-update",
    ]);
    for (const release of releases) release();
  });

  it("stays subscribed until the LAST retainer releases", async () => {
    const a = retainWorkflowEvents();
    const b = retainWorkflowEvents();
    await workflowEventsReady();
    a();
    expect(unlistens.every((u) => u.mock.calls.length === 0)).toBe(true);
    b();
    expect(unlistens).toHaveLength(3);
    expect(unlistens.every((u) => u.mock.calls.length === 1)).toBe(true);
  });

  it("a release is idempotent: releasing twice cannot drop another retainer's hold", async () => {
    const a = retainWorkflowEvents();
    const b = retainWorkflowEvents();
    await workflowEventsReady();
    a();
    a();
    expect(unlistens.every((u) => u.mock.calls.length === 0)).toBe(true);
    b();
  });

  it("re-subscribes for a retainer that arrives after the last one left", async () => {
    const first = retainWorkflowEvents();
    await workflowEventsReady();
    first();
    expect(handlers.size).toBe(0);
    const again = retainWorkflowEvents();
    await workflowEventsReady();
    expect(listen).toHaveBeenCalledTimes(6);
    expect(handlers.size).toBe(3);
    again();
  });

  it("a subscription that finishes after its last retainer left drops itself (#768)", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    listen.mockImplementation(async (name: string, handler: Listener) => {
      await gate;
      handlers.set(name, handler);
      const unlisten = vi.fn(() => handlers.delete(name));
      unlistens.push(unlisten);
      return unlisten;
    });
    const release = retainWorkflowEvents();
    release();
    open();
    await vi.waitFor(() => expect(unlistens).toHaveLength(3));
    expect(unlistens.every((u) => u.mock.calls.length === 1)).toBe(true);
    expect(handlers.size).toBe(0);
  });

  it("rolls back every acquired listener when a later listen() rejects (#764), and retries on the next ready()", async () => {
    let calls = 0;
    listen.mockImplementation(async (name: string, handler: Listener) => {
      calls += 1;
      if (calls === 2) throw new Error("listen failed");
      handlers.set(name, handler);
      const unlisten = vi.fn(() => handlers.delete(name));
      unlistens.push(unlisten);
      return unlisten;
    });
    const release = retainWorkflowEvents();
    await expect(workflowEventsReady()).rejects.toThrow("listen failed");
    expect(unlistens[0].mock.calls.length).toBe(1);
    expect(handlers.size).toBe(0);

    await workflowEventsReady(); // a fresh attempt, now succeeding
    expect(handlers.size).toBe(3);
    release();
  });
});

describe("workflowEventsReady — a start's precondition, never a subscriber", () => {
  it("fails LOUD when nothing retains the events: a run's frames would go nowhere", async () => {
    await expect(workflowEventsReady()).rejects.toThrow(/no workflow event owner/i);
    expect(listen).not.toHaveBeenCalled();
  });

  it("waits for an in-flight subscription instead of starting a second one", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    listen.mockImplementation(async (name: string, handler: Listener) => {
      await gate;
      handlers.set(name, handler);
      return vi.fn();
    });
    const release = retainWorkflowEvents();
    let ready = false;
    const waiting = workflowEventsReady().then(() => (ready = true));
    await Promise.resolve();
    expect(ready).toBe(false);
    open();
    await waiting;
    expect(handlers.size).toBe(3);
    expect(listen).toHaveBeenCalledTimes(3);
    release();
  });
});

describe("event routing (#765, #767)", () => {
  it("routes only the CURRENT execution's frames, and completion keeps the statuses", async () => {
    const release = retainWorkflowEvents();
    await workflowEventsReady();
    useWorkflowStore.getState().setExecution("live");

    handlers.get("workflow:step-update")?.({ payload: { executionId: "other", stepId: "a", status: "success" } });
    handlers.get("workflow:step-update")?.({ payload: { executionId: "live", stepId: "b", status: "success" } });
    handlers.get("workflow:complete")?.({ payload: { executionId: "live", status: "failed" } });
    handlers.get("workflow:step-update")?.({ payload: { executionId: "live", stepId: "c", status: "running" } });

    const preview = useWorkflowStore.getState().preview;
    expect(preview.stepStatuses).toEqual({ b: { status: "success" } });
    expect(preview.executionId).toBeNull();
    expect(preview.lastRunOutcome).toBe("failed");
    release();
  });

  it("an approval request for the current run is queued, and completion dismisses it", async () => {
    const release = retainWorkflowEvents();
    await workflowEventsReady();
    useWorkflowStore.getState().setExecution("live");
    const request = { executionId: "live", stepId: "s", summary: "genie/x", preview: "p", model: null };

    handlers.get("workflow:approval-request")?.({ payload: { ...request, executionId: "stale" } });
    expect(useWorkflowStore.getState().approval.pending).toBeNull();
    handlers.get("workflow:approval-request")?.({ payload: request });
    expect(useWorkflowStore.getState().approval.pending).toMatchObject({ stepId: "s" });
    handlers.get("workflow:complete")?.({ payload: { executionId: "live", status: "completed" } });
    expect(useWorkflowStore.getState().approval.pending).toBeNull();
    release();
  });
});
