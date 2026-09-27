/**
 * useWorkflowRunControls — Run / Cancel for ONE workflow document.
 *
 * Purpose: the logic behind the run panel's toolbar, shared by both places the
 * panel mounts (the yaml split pane and the markdown surface's side panel).
 *
 * Key decisions:
 *   - **The document is the panel's own tab**, read at click time from the
 *     document store (WI-LX2.2). The side panel used to read the active tab of
 *     window `"main"`, so in any other window — or with another tab active —
 *     Run executed a different document, or nothing.
 *   - **A run belongs to the tab that started it** (`preview.runTabId`,
 *     bound once `run_workflow` resolves). Only that tab paints the run's
 *     statuses and offers Cancel; any other panel in the window — or one
 *     looking at a workflow genie's run — says Run is busy instead. The
 *     runner is one-at-a-time app-wide, so "busy" is the truth.
 *   - **A refused start is SHOWN** — engine off, invalid YAML, already
 *     running, snapshot failed — through `imeToast.errorDetail`, which renders
 *     a typed `CommandError` with `commandErrorMessage`. It used to be logged
 *     and nothing else, so a click on Run could simply do nothing.
 *   - `starting` covers the gap before the run is bound: the snapshot is taken
 *     inside `run_workflow`, so a start can take seconds, and the Cancel it
 *     shows then works — the id is already registered and published.
 *
 * @coordinates-with hooks/useWorkflowExecution.ts — start / cancel / events
 * @coordinates-with stores/workflowPreviewSlice.ts — runTabId, the ownership rule
 * @coordinates-with components/Editor/WorkflowPanel/WorkflowRunPanel.tsx — the UI
 * @module components/Editor/WorkflowPanel/useWorkflowRunControls
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkflowExecution } from "@/hooks/useWorkflowExecution";
import { useWorkflowStore, type WorkflowRunOutcome } from "@/stores/workflowStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { imeToast as toast } from "@/services/ime/imeToast";
import { workflowWarn } from "@/utils/debug";
import type { StepStatusEntry } from "@/lib/workflow/types";

/** Why Run is unavailable — each is an i18n key under `workflow:run.*`. */
type RunBlockedReason = "needsWorkspace" | "busy";

export interface WorkflowRunControls {
  /** This tab started the window's current or last run. */
  owned: boolean;
  /** A run this tab owns is live, or is being started. */
  running: boolean;
  blockedReason: RunBlockedReason | null;
  /** How this tab's last run ended, once it has. */
  outcome: WorkflowRunOutcome | null;
  /** Live statuses — only for the run this tab owns. */
  stepStatuses: Record<string, StepStatusEntry> | undefined;
  run: () => Promise<void>;
  cancel: () => void;
}

export function useWorkflowRunControls(tabId: string | null): WorkflowRunControls {
  // Loads the `workflow` namespace; a bare `useTranslation()` never does, so a
  // `workflow:` key would render its English default in every language.
  const { t } = useTranslation("workflow");
  const { start, cancel: cancelRun } = useWorkflowExecution();
  const [starting, setStarting] = useState(false);
  const executionId = useWorkflowStore((s) => s.preview.executionId);
  const runTabId = useWorkflowStore((s) => s.preview.runTabId);
  const lastRunOutcome = useWorkflowStore((s) => s.preview.lastRunOutcome);
  const stepStatuses = useWorkflowStore((s) => s.preview.stepStatuses);
  const workspaceRoot = useWorkspaceStore((s) => s.rootPath);

  const owned = tabId !== null && runTabId === tabId;
  const running = starting || (owned && executionId !== null);
  const blockedReason: RunBlockedReason | null = !workspaceRoot
    ? "needsWorkspace"
    : executionId !== null && !running
      ? "busy"
      : null;

  const run = useCallback(async () => {
    if (!tabId) return;
    const yaml = useDocumentStore.getState().documents?.[tabId]?.content ?? "";
    const root = useWorkspaceStore.getState().rootPath;
    if (!root || yaml.trim().length === 0) return;
    setStarting(true);
    try {
      const id = await start({ yaml, workspaceRoot: root });
      useWorkflowStore.getState().bindRunToTab(id, tabId);
    } catch (error) {
      workflowWarn("Workflow run failed to start:", error);
      toast.errorDetail(t("workflow:run.failedToStart"), error);
    } finally {
      setStarting(false);
    }
  }, [start, t, tabId]);

  const cancel = useCallback(() => {
    // A cancel racing the run's own end is refused (`not-found`) — benign.
    cancelRun().catch((error: unknown) => workflowWarn("Workflow cancel refused:", error));
  }, [cancelRun]);

  return {
    owned,
    running,
    blockedReason,
    outcome: owned && executionId === null ? lastRunOutcome : null,
    stepStatuses: owned ? stepStatuses : undefined,
    run,
    cancel,
  };
}
