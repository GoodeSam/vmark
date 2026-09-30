// RW-2 (L4), WI-LX2.2 — WorkflowSidePanel behavior tests
/**
 * WorkflowSidePanel — behavior tests.
 *
 * Covers the panel's user-visible contract:
 * - Renders nothing when the preview panel is closed.
 * - Shows the Run button (disabled until a graph is parsed) when idle.
 * - Run reads YAML from the panel's OWN tab + workspace root and calls
 *   startWorkflowRun with them, owned by that tab — never the active tab of
 *   window "main" (WI-LX2.2).
 * - When this tab's run is active, the panel shows Cancel instead of Run, and
 *   Cancel calls cancelWorkflowRun with THAT run's id.
 * - It shows ITS tab's preview only: another tab's graph or open panel is not
 *   this panel's (#129).
 * - A parse error is surfaced and suppresses the graph canvas.
 *
 * WorkflowPreview (React Flow) is mocked to a stub so we test the panel's
 * own wiring, not the canvas. The execution hook is mocked to assert the
 * start/cancel calls. The real stores drive panel + execution state.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

import { useWorkflowStore } from "@/stores/workflowStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { WorkflowGraph } from "@/lib/workflow/types";

const mockStart = vi.fn((..._args: unknown[]) => Promise.resolve("exec-id"));
const mockCancel = vi.fn((..._args: unknown[]) => Promise.resolve());

vi.mock("@/hooks/useWorkflowExecution", () => ({
  startWorkflowRun: (...args: unknown[]) => mockStart(...args),
  cancelWorkflowRun: (...args: unknown[]) => mockCancel(...args),
}));

// Stub the React Flow canvas — we only verify the panel wiring around it.
vi.mock("@/plugins/workflowPreview/WorkflowPreview", () => ({
  WorkflowPreview: () => <div data-testid="workflow-preview-stub" />,
}));

import { WorkflowSidePanel } from "../WorkflowSidePanel";

const GRAPH: WorkflowGraph = {
  name: "ci",
  steps: [],
  edges: [],
} as unknown as WorkflowGraph;

function runButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    ".workflow-side-panel__btn--run",
  );
}
function cancelButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    ".workflow-side-panel__btn--cancel",
  );
}

describe("WorkflowSidePanel", () => {
  beforeEach(() => {
    useWorkflowStore.getState().resetPreview();
    mockStart.mockClear();
    mockCancel.mockClear();

    // The ACTIVE tab of window "main" is a different document: the panel
    // runs its own tab, whatever window or tab is active (WI-LX2.2).
    useTabStore.setState({
      tabs: { main: [{ id: "tab-other" }] },
      activeTabId: { main: "tab-other" },
    } as never);
    useDocumentStore.setState({
      documents: {
        "tab-1": { content: "name: ci\n" },
        "tab-other": { content: "name: other\n" },
      },
    } as never);
    useWorkspaceStore.setState({ rootPath: "/work" } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("visibility", () => {
    it("renders nothing when the panel is closed", () => {
      render(<WorkflowSidePanel tabId="tab-1" />);
      expect(
        document.querySelector(".workflow-side-panel"),
      ).not.toBeInTheDocument();
    });

    it("renders the panel when open", () => {
      useWorkflowStore.getState().previewOpenPanel("tab-1");
      render(<WorkflowSidePanel tabId="tab-1" />);
      expect(document.querySelector(".workflow-side-panel")).toBeInTheDocument();
    });
  });

  describe("idle (no execution)", () => {
    it("shows the Run button, disabled when there is no graph", () => {
      useWorkflowStore.getState().previewOpenPanel("tab-1");
      render(<WorkflowSidePanel tabId="tab-1" />);
      const run = runButton();
      expect(run).toBeInTheDocument();
      expect(run).toBeDisabled();
      expect(cancelButton()).not.toBeInTheDocument();
    });

    it("enables Run once a graph is parsed with no error", () => {
      useWorkflowStore.getState().previewOpenPanel("tab-1");
      useWorkflowStore.getState().setGraph("tab-1", GRAPH);
      render(<WorkflowSidePanel tabId="tab-1" />);
      expect(runButton()).toBeEnabled();
    });

    it("Run reads THIS panel's tab + workspace root and calls start", async () => {
      useWorkflowStore.getState().previewOpenPanel("tab-1");
      useWorkflowStore.getState().setGraph("tab-1", GRAPH);
      render(<WorkflowSidePanel tabId="tab-1" />);

      fireEvent.click(runButton()!);

      await waitFor(() => {
        expect(mockStart).toHaveBeenCalledWith({
          yaml: "name: ci\n",
          workspaceRoot: "/work",
          ownerTabId: "tab-1",
        });
      });
    });

    it("Run does not call start when there is no workspace root", async () => {
      useWorkspaceStore.setState({ rootPath: null } as never);
      useWorkflowStore.getState().previewOpenPanel("tab-1");
      useWorkflowStore.getState().setGraph("tab-1", GRAPH);
      render(<WorkflowSidePanel tabId="tab-1" />);

      fireEvent.click(runButton()!);

      // Guard short-circuits before start(); give any microtasks a beat.
      await Promise.resolve();
      expect(mockStart).not.toHaveBeenCalled();
    });
  });

  describe("running (execution active)", () => {
    beforeEach(() => {
      useWorkflowStore.getState().previewOpenPanel("tab-1");
      useWorkflowStore.getState().setGraph("tab-1", GRAPH);
      useWorkflowStore.getState().setExecution("exec-1", { tabId: "tab-1", source: "name: demo\n" });
    });

    it("shows Cancel instead of Run", () => {
      render(<WorkflowSidePanel tabId="tab-1" />);
      expect(cancelButton()).toBeInTheDocument();
      expect(runButton()).not.toBeInTheDocument();
    });

    it("Cancel cancels THIS tab's run, by its id", async () => {
      render(<WorkflowSidePanel tabId="tab-1" />);
      fireEvent.click(cancelButton()!);
      await waitFor(() => {
        expect(mockCancel).toHaveBeenCalledWith("exec-1");
      });
    });
  });

  // Audit 20260928 #129 — one window-global preview let a split's two panels
  // show each other's graph and open state.
  describe("per-tab preview (#129)", () => {
    it("another tab's open panel and graph are not this panel's", () => {
      useWorkflowStore.getState().previewOpenPanel("tab-other");
      useWorkflowStore.getState().setGraph("tab-other", GRAPH);
      render(<WorkflowSidePanel tabId="tab-1" />);
      expect(document.querySelector(".workflow-side-panel")).not.toBeInTheDocument();
    });

    it("two panels side by side show their own state", () => {
      useWorkflowStore.getState().previewOpenPanel("tab-1");
      useWorkflowStore.getState().setGraph("tab-1", null, "tab-1 is broken");
      useWorkflowStore.getState().previewOpenPanel("tab-other");
      useWorkflowStore.getState().setGraph("tab-other", GRAPH);
      render(
        <>
          <WorkflowSidePanel tabId="tab-1" />
          <WorkflowSidePanel tabId="tab-other" />
        </>,
      );
      expect(screen.getAllByText("tab-1 is broken")).toHaveLength(1);
      expect(screen.getAllByTestId("workflow-preview-stub")).toHaveLength(1);
    });
  });

  // Round 2 (#124/#126): malformed YAML is no longer an engine workflow, so
  // the preview closes the panel when the file stops parsing. A LIVE run this
  // tab owns keeps the panel — and its Cancel — until the run ends.
  describe("a live run keeps the panel (#124)", () => {
    it("stays mounted with Cancel while this tab's run is live, even with the preview closed", async () => {
      useWorkflowStore.getState().setExecution("exec-1", { tabId: "tab-1", source: "name: ci\n" });
      render(<WorkflowSidePanel tabId="tab-1" />);
      fireEvent.click(cancelButton()!);
      await waitFor(() => expect(mockCancel).toHaveBeenCalledWith("exec-1"));

      act(() => useWorkflowStore.getState().finishExecution("exec-1", "cancelled"));
      expect(document.querySelector(".workflow-side-panel")).not.toBeInTheDocument();
    });

    it("another tab's live run keeps nothing here", () => {
      useWorkflowStore.getState().setExecution("exec-1", { tabId: "tab-other", source: "x" });
      render(<WorkflowSidePanel tabId="tab-1" />);
      expect(document.querySelector(".workflow-side-panel")).not.toBeInTheDocument();
    });
  });

  describe("parse error", () => {
    it("surfaces the parse error and hides the preview canvas", () => {
      useWorkflowStore.getState().previewOpenPanel("tab-1");
      useWorkflowStore.getState().setGraph("tab-1", null, "bad indentation at line 3");
      render(<WorkflowSidePanel tabId="tab-1" />);

      expect(
        screen.getByText("bad indentation at line 3"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("workflow-preview-stub"),
      ).not.toBeInTheDocument();
      // Run stays disabled while there is a parse error.
      expect(runButton()).toBeDisabled();
    });
  });
});
