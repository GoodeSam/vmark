// RW-2 (L4), WI-LX2.2 — WorkflowSidePanel behavior tests
/**
 * WorkflowSidePanel — behavior tests.
 *
 * Covers the panel's user-visible contract:
 * - Renders nothing when the preview panel is closed.
 * - Shows the Run button (disabled until a graph is parsed) when idle.
 * - Run reads YAML from the panel's OWN tab + workspace root and calls
 *   useWorkflowExecution.start with them — never the active tab of window
 *   "main" (WI-LX2.2).
 * - When this tab's run is active, the panel shows Cancel instead of Run, and
 *   Cancel calls useWorkflowExecution.cancel.
 * - A parse error is surfaced and suppresses the graph canvas.
 *
 * WorkflowPreview (React Flow) is mocked to a stub so we test the panel's
 * own wiring, not the canvas. The execution hook is mocked to assert the
 * start/cancel calls. The real stores drive panel + execution state.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { useWorkflowStore } from "@/stores/workflowStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { WorkflowGraph } from "@/lib/workflow/types";

const mockStart = vi.fn(() => Promise.resolve("exec-id"));
const mockCancel = vi.fn(() => Promise.resolve());

vi.mock("@/hooks/useWorkflowExecution", () => ({
  useWorkflowExecution: () => ({
    start: mockStart,
    cancel: mockCancel,
    respondApproval: vi.fn(),
  }),
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
      useWorkflowStore.getState().previewOpenPanel();
      render(<WorkflowSidePanel tabId="tab-1" />);
      expect(document.querySelector(".workflow-side-panel")).toBeInTheDocument();
    });
  });

  describe("idle (no execution)", () => {
    it("shows the Run button, disabled when there is no graph", () => {
      useWorkflowStore.getState().previewOpenPanel();
      render(<WorkflowSidePanel tabId="tab-1" />);
      const run = runButton();
      expect(run).toBeInTheDocument();
      expect(run).toBeDisabled();
      expect(cancelButton()).not.toBeInTheDocument();
    });

    it("enables Run once a graph is parsed with no error", () => {
      useWorkflowStore.getState().previewOpenPanel();
      useWorkflowStore.getState().setGraph(GRAPH);
      render(<WorkflowSidePanel tabId="tab-1" />);
      expect(runButton()).toBeEnabled();
    });

    it("Run reads THIS panel's tab + workspace root and calls start", async () => {
      useWorkflowStore.getState().previewOpenPanel();
      useWorkflowStore.getState().setGraph(GRAPH);
      render(<WorkflowSidePanel tabId="tab-1" />);

      fireEvent.click(runButton()!);

      await waitFor(() => {
        expect(mockStart).toHaveBeenCalledWith({
          yaml: "name: ci\n",
          workspaceRoot: "/work",
        });
      });
    });

    it("Run does not call start when there is no workspace root", async () => {
      useWorkspaceStore.setState({ rootPath: null } as never);
      useWorkflowStore.getState().previewOpenPanel();
      useWorkflowStore.getState().setGraph(GRAPH);
      render(<WorkflowSidePanel tabId="tab-1" />);

      fireEvent.click(runButton()!);

      // Guard short-circuits before start(); give any microtasks a beat.
      await Promise.resolve();
      expect(mockStart).not.toHaveBeenCalled();
    });
  });

  describe("running (execution active)", () => {
    beforeEach(() => {
      useWorkflowStore.getState().previewOpenPanel();
      useWorkflowStore.getState().setGraph(GRAPH);
      useWorkflowStore.getState().setExecution("exec-1");
      useWorkflowStore.getState().bindRunToTab("exec-1", "tab-1");
    });

    it("shows Cancel instead of Run", () => {
      render(<WorkflowSidePanel tabId="tab-1" />);
      expect(cancelButton()).toBeInTheDocument();
      expect(runButton()).not.toBeInTheDocument();
    });

    it("Cancel calls the execution hook's cancel", async () => {
      render(<WorkflowSidePanel tabId="tab-1" />);
      fireEvent.click(cancelButton()!);
      await waitFor(() => {
        expect(mockCancel).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("parse error", () => {
    it("surfaces the parse error and hides the preview canvas", () => {
      useWorkflowStore.getState().previewOpenPanel();
      useWorkflowStore.getState().setGraph(null, "bad indentation at line 3");
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
