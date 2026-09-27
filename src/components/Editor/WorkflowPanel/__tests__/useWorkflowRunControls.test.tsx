// WI-LX2.1/WI-LX2.2 — Run/Cancel for ONE document: its own content, its own run, failures shown.
/**
 * Only the IPC boundary is faked (`invoke`, `listen`); the execution hook,
 * the workflow/document/workspace stores and the ownership rule are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

type Listener = (event: { payload: unknown }) => void;
const listeners = vi.hoisted(() => new Map<string, Listener>());
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: Listener) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  },
}));

import { useWorkflowRunControls } from "../useWorkflowRunControls";
import { useWorkflowStore } from "@/stores/workflowStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { imeToast } from "@/services/ime/imeToast";

const initialWorkflow = useWorkflowStore.getState();
const YAML_A = "name: a\nsteps:\n  - uses: action/notify\n";
const YAML_B = "name: b\nsteps:\n  - uses: action/copy\n";

function runWorkflowCalls(): Array<Record<string, unknown>> {
  return invoke.mock.calls
    .filter(([cmd]) => cmd === "run_workflow")
    .map(([, args]) => args as Record<string, unknown>);
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) =>
    cmd === "run_workflow" ? args?.executionId : undefined,
  );
  listeners.clear();
  useWorkflowStore.setState(initialWorkflow, true);
  useDocumentStore.setState({
    documents: { "tab-a": { content: YAML_A }, "tab-b": { content: YAML_B } },
  } as never);
  useWorkspaceStore.setState({ rootPath: "/work" } as never);
  // The ACTIVE tab of window "main" is another document: the panel must not
  // care (WI-LX2.2 — it used to read `getActiveTab("main")`).
  useTabStore.setState({ activeTabId: { main: "tab-a" } } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWorkflowRunControls — starting a run", () => {
  it("runs THIS tab's document against the workspace root, whatever tab is active elsewhere", async () => {
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await result.current.run();
    });
    const [call] = runWorkflowCalls();
    expect(call.yaml).toBe(YAML_B);
    expect(call.workspaceRoot).toBe("/work");
  });

  it("owns the run it started: running, Cancel available, statuses visible", async () => {
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await result.current.run();
    });
    const id = useWorkflowStore.getState().preview.executionId;
    expect(id).not.toBeNull();
    expect(useWorkflowStore.getState().preview.runTabId).toBe("tab-b");
    expect(result.current.owned).toBe(true);
    expect(result.current.running).toBe(true);

    act(() => {
      listeners.get("workflow:step-update")?.({
        payload: { executionId: id, stepId: "copy", status: "success" },
      });
    });
    expect(result.current.stepStatuses).toEqual({ copy: { status: "success" } });
  });

  it("keeps ownership and reports the outcome after the run completes", async () => {
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await result.current.run();
    });
    const id = useWorkflowStore.getState().preview.executionId;
    act(() => {
      listeners.get("workflow:complete")?.({ payload: { executionId: id, status: "failed" } });
    });
    expect(result.current.running).toBe(false);
    expect(result.current.owned).toBe(true);
    expect(result.current.outcome).toBe("failed");
  });

  it("cancel asks the runner to stop THIS run", async () => {
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await result.current.run();
    });
    const id = useWorkflowStore.getState().preview.executionId;
    await act(async () => {
      result.current.cancel();
    });
    expect(invoke).toHaveBeenCalledWith("cancel_workflow", { executionId: id });
  });
});

describe("useWorkflowRunControls — when it cannot run", () => {
  it("says a folder is needed and starts nothing without a workspace", async () => {
    useWorkspaceStore.setState({ rootPath: null } as never);
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    expect(result.current.blockedReason).toBe("needsWorkspace");
    await act(async () => {
      await result.current.run();
    });
    expect(runWorkflowCalls()).toHaveLength(0);
  });

  it("does not claim a run another surface started (a workflow genie)", () => {
    useWorkflowStore.getState().setExecution("genie-run");
    useWorkflowStore.getState().setStepStatus("copy", { status: "running" });
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    expect(result.current.owned).toBe(false);
    expect(result.current.running).toBe(false);
    expect(result.current.blockedReason).toBe("busy");
    expect(result.current.stepStatuses).toBeUndefined();
  });

  it("another tab's run is not this tab's: busy here, owned there", async () => {
    const a = renderHook(() => useWorkflowRunControls("tab-a"));
    const b = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await a.result.current.run();
    });
    expect(a.result.current.owned).toBe(true);
    expect(b.result.current.owned).toBe(false);
    expect(b.result.current.blockedReason).toBe("busy");
  });

  it("with no tab, it never runs", async () => {
    const { result } = renderHook(() => useWorkflowRunControls(null));
    await act(async () => {
      await result.current.run();
    });
    expect(runWorkflowCalls()).toHaveLength(0);
  });

  it("an empty document starts nothing", async () => {
    useDocumentStore.setState({ documents: { "tab-b": { content: "   " } } } as never);
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await result.current.run();
    });
    expect(runWorkflowCalls()).toHaveLength(0);
  });
});

describe("useWorkflowRunControls — a start the backend refuses", () => {
  it("shows the typed error to the user and leaves nothing running", async () => {
    const refusal = {
      code: "feature-disabled",
      message: "The workflow engine is turned off in Settings",
    };
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "run_workflow") throw refusal;
      return undefined;
    });
    const errorDetail = vi.spyOn(imeToast, "errorDetail").mockReturnValue("t" as never);
    const { result } = renderHook(() => useWorkflowRunControls("tab-b"));
    await act(async () => {
      await result.current.run();
    });
    // The test i18n map does not load the `workflow` namespace, so the key
    // itself is what renders here; the English text lives in workflow.json.
    expect(errorDetail).toHaveBeenCalledWith("workflow:run.failedToStart", refusal);
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(useWorkflowStore.getState().preview.executionId).toBeNull();
    expect(result.current.owned).toBe(false);
  });
});
