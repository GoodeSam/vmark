/**
 * useWorkflowExecution — the window's event owner and the run commands.
 *
 * The event ROUTING rules live with the subscription and are pinned in
 * `services/workflow/workflowRunEvents.test.ts`. These pin what this module
 * adds on top (audit 20260928 #113–#115):
 *   - ONE subscription per window, held by the lifecycle hook — mounting any
 *     number of run panels next to the approval dialog adds no listener;
 *   - start/cancel/respond are plain commands that subscribe nothing;
 *   - a start registers its id (and owner) before `run_workflow` resolves, rolls
 *     back only its own claim, and refuses while another run is registered;
 *   - cancel names an EXPLICIT execution id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook } from "@testing-library/react";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

type Listener = (event: { payload: unknown }) => void;
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import {
  cancelWorkflowRun,
  respondWorkflowApproval,
  startWorkflowRun,
  useWorkflowEventLifecycle,
} from "./useWorkflowExecution";
import { resetWorkflowEvents, workflowEventsReady } from "@/services/workflow/workflowRunEvents";
import { ApprovalDialog } from "@/components/WorkflowApproval/ApprovalDialog";
import { useWorkflowRunControls } from "@/components/Editor/WorkflowPanel/useWorkflowRunControls";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useAiProviderStore } from "@/stores/aiStore";
import { useSettingsStore } from "@/stores/settingsStore";

const initialWorkflowState = useWorkflowStore.getState();
const initialAiProviderState = useAiProviderStore.getState();
const unlistens: Array<ReturnType<typeof vi.fn>> = [];

beforeEach(() => {
  resetWorkflowEvents();
  invokeMock.mockReset();
  listenMock.mockReset();
  unlistens.length = 0;
  listenMock.mockImplementation(async (_name: string, _handler: Listener) => {
    const unlisten = vi.fn();
    unlistens.push(unlisten);
    return unlisten;
  });
  useWorkflowStore.setState(initialWorkflowState, true);
  useAiProviderStore.setState(initialAiProviderState, true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Mount the window's event owner and wait for its subscription. */
async function mountOwner() {
  const owner = renderHook(() => useWorkflowEventLifecycle());
  await workflowEventsReady();
  return owner;
}

describe("the window's ONE workflow-event subscription (#115)", () => {
  function Panels({ tabs }: { tabs: string[] }) {
    return (
      <>
        {tabs.map((tab) => (
          <Panel key={tab} tabId={tab} />
        ))}
      </>
    );
  }
  function Panel({ tabId }: { tabId: string }) {
    useWorkflowRunControls(tabId);
    return null;
  }

  it("several run panels plus the approval dialog subscribe each runner event exactly once", async () => {
    const { unmount } = render(
      <>
        <ApprovalDialog />
        <Panels tabs={["tab-a", "tab-b", "tab-c"]} />
      </>,
    );
    await workflowEventsReady();

    const events = listenMock.mock.calls.map(([name]) => name as string).sort();
    expect(events).toEqual([
      "workflow:approval-request",
      "workflow:complete",
      "workflow:step-update",
    ]);

    unmount();
    expect(unlistens).toHaveLength(3);
    expect(unlistens.every((u) => u.mock.calls.length === 1)).toBe(true);
  });

  it("run panels alone subscribe nothing — they only start and cancel", async () => {
    render(<Panels tabs={["tab-a", "tab-b"]} />);
    await Promise.resolve();
    expect(listenMock).not.toHaveBeenCalled();
  });

  it("the lifecycle hook releases every listener on unmount", async () => {
    const { unmount } = await mountOwner();
    unmount();
    expect(unlistens.every((u) => u.mock.calls.length === 1)).toBe(true);
  });
});

describe("startWorkflowRun", () => {
  it("registers the id — and its owner — BEFORE run_workflow resolves", async () => {
    await mountOwner();
    let atInvoke: { id: string | null; owner: string | null } | null = null;
    invokeMock.mockImplementation(async (cmd: string, args: { executionId: string }) => {
      if (cmd !== "run_workflow") return undefined;
      const { executionId, runTabId } = useWorkflowStore.getState().preview;
      atInvoke = { id: executionId, owner: runTabId };
      return args.executionId;
    });

    const id = await startWorkflowRun({ yaml: "name: x", workspaceRoot: "/w", ownerTabId: "tab-1" });

    expect(atInvoke).toEqual({ id, owner: "tab-1" });
    expect(useWorkflowStore.getState().preview.runSource).toBe("name: x");
  });

  it("refuses to start when no event owner is mounted, registering nothing", async () => {
    await expect(startWorkflowRun({ yaml: "name: x", workspaceRoot: "/w" })).rejects.toThrow(
      /no workflow event owner/i,
    );
    expect(invokeMock).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().preview.executionId).toBeNull();
  });

  it("a rejected run_workflow rolls back its own registration", async () => {
    await mountOwner();
    invokeMock.mockRejectedValueOnce(new Error("concurrency guard"));
    await expect(startWorkflowRun({ yaml: "name: x", workspaceRoot: "/w" })).rejects.toThrow(
      "concurrency guard",
    );
    expect(useWorkflowStore.getState().preview.executionId).toBeNull();
  });

  // Audit #770 — a second start used to overwrite the live run's id.
  it("refuses a second start while a run is registered, leaving the first intact", async () => {
    await mountOwner();
    invokeMock.mockResolvedValue("first-id");
    await startWorkflowRun({ yaml: "name: a", workspaceRoot: "/w" });
    const firstId = useWorkflowStore.getState().preview.executionId;
    invokeMock.mockClear();

    await expect(startWorkflowRun({ yaml: "name: b", workspaceRoot: "/w" })).rejects.toThrow(
      /already running/i,
    );
    expect(invokeMock).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().preview.executionId).toBe(firstId);
  });

  it("produces a timestamp-suffix id when crypto.randomUUID is unavailable", async () => {
    await mountOwner();
    const realCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) },
      configurable: true,
    });
    try {
      invokeMock.mockResolvedValueOnce("server-id");
      await startWorkflowRun({ yaml: "name: x", workspaceRoot: "/w" });
      expect(useWorkflowStore.getState().preview.executionId).toMatch(/^\d+-[a-z0-9]+$/);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: realCrypto, configurable: true });
    }
  });

  it("sends the active provider, or null when none is active", async () => {
    await mountOwner();
    invokeMock.mockResolvedValue("server-id");
    await startWorkflowRun({ yaml: "name: x", workspaceRoot: "/w" });
    const bare = invokeMock.mock.calls.find((c) => c[0] === "run_workflow")?.[1] as { provider: unknown };
    expect(bare.provider).toBeNull();

    useAiProviderStore.setState({
      activeProvider: "anthropic",
      cliProviders: [],
      restProviders: [
        { type: "anthropic", name: "Anthropic", endpoint: "https://api.anthropic.com", apiKey: "sk-test", model: "claude" },
      ],
      detecting: false,
    } as Partial<ReturnType<typeof useAiProviderStore.getState>>);
    useWorkflowStore.getState().finishExecution(useWorkflowStore.getState().preview.executionId!, "completed");
    invokeMock.mockClear();
    await startWorkflowRun({ yaml: "name: x", workspaceRoot: "/w" });
    const withProvider = invokeMock.mock.calls.find((c) => c[0] === "run_workflow")?.[1] as { provider: unknown };
    expect(withProvider.provider).toEqual({
      provider: "anthropic",
      apiKey: "sk-test",
      endpoint: "https://api.anthropic.com",
      cliPath: null,
    });
  });

  // WI-LX1.4 — the capture-on-save setting reaches the runner, read at start.
  it.each([
    [true, "adopt"],
    [false, "tracked-only"],
  ])("sends capturePolicy for coherenceCaptureOnSave=%s", async (on, policy) => {
    await mountOwner();
    useSettingsStore.setState({
      general: { ...useSettingsStore.getState().general, coherenceCaptureOnSave: on },
    });
    invokeMock.mockResolvedValueOnce("server-id");
    await startWorkflowRun({ yaml: "name: x", workspaceRoot: "/w" });
    const call = invokeMock.mock.calls.find((c) => c[0] === "run_workflow");
    expect((call?.[1] as { capturePolicy?: unknown }).capturePolicy).toBe(policy);
  });
});

describe("cancelWorkflowRun / respondWorkflowApproval", () => {
  it("cancel names the EXPLICIT execution id, whatever the store holds", async () => {
    invokeMock.mockResolvedValue(undefined);
    useWorkflowStore.getState().setExecution("someone-elses");
    await cancelWorkflowRun("mine");
    expect(invokeMock).toHaveBeenCalledWith("cancel_workflow", { executionId: "mine" });
  });

  it("respond sends the verdict for one step of one run", async () => {
    invokeMock.mockResolvedValue(undefined);
    await respondWorkflowApproval("exec-1", "step-1", true);
    expect(invokeMock).toHaveBeenCalledWith("respond_workflow_approval", {
      executionId: "exec-1",
      stepId: "step-1",
      approved: true,
    });
  });

  it("neither command subscribes to anything", async () => {
    invokeMock.mockResolvedValue(undefined);
    await cancelWorkflowRun("x");
    await respondWorkflowApproval("x", "s", false);
    expect(listenMock).not.toHaveBeenCalled();
  });
});
