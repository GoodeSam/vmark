/**
 * useRunSnapshot — "Restore Files" for the run this panel just finished.
 *
 * Purpose: a run with `action/save-file` steps is REFUSED unless its targets
 * are snapshotted first (`prepare.rs`, #266), and until WI-LX2.3 nothing could
 * put a snapshot back. Once this tab's run has ended, look up the snapshot it
 * took; if there is one, offer it, confirm, restore, and say what happened.
 *
 * Key decisions:
 *   - Only the OWNER's finished run is looked up (`owned`, from
 *     `useWorkflowRunControls`), never a live run's: restoring under a running
 *     workflow is refused by Rust anyway, and offering it would invite that.
 *   - The confirmation names the consequence — how many files go back, how
 *     many the run created are deleted, and that later edits are lost —
 *     through the one `confirmAction` funnel (rule: the verb on the button).
 *   - After a successful restore the offer disappears. The snapshot stays on
 *     disk, but a second click would overwrite edits made since, so the UI
 *     does not invite it.
 *   - The found snapshot is stored WITH the id it was found for, so a stale
 *     answer for an earlier run can never be offered for a later one.
 *
 * @coordinates-with components/Editor/WorkflowPanel/workflowSnapshots.ts — the IPC
 * @coordinates-with components/Editor/WorkflowPanel/WorkflowRunPanel.tsx — the button
 * @module components/Editor/WorkflowPanel/useRunSnapshot
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkflowStore } from "@/stores/workflowStore";
import { confirmAction } from "@/services/dialogs/confirmAction";
import { imeToast as toast } from "@/services/ime/imeToast";
import { workflowWarn } from "@/utils/debug";
import {
  findRunSnapshot,
  restoreWorkflowSnapshot,
  type SnapshotSummary,
} from "./workflowSnapshots";

export interface RunSnapshot {
  snapshot: SnapshotSummary | null;
  restoring: boolean;
  restore: () => Promise<void>;
}

interface Found {
  forExecutionId: string;
  snapshot: SnapshotSummary | null;
}

export function useRunSnapshot(owned: boolean): RunSnapshot {
  const { t } = useTranslation("workflow");
  const executionId = useWorkflowStore((s) => s.preview.executionId);
  const lastExecutionId = useWorkflowStore((s) => s.preview.lastExecutionId);
  const target = owned && executionId === null ? lastExecutionId : null;
  const [found, setFound] = useState<Found | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    findRunSnapshot(target)
      .then((snapshot) => {
        if (!cancelled) setFound({ forExecutionId: target, snapshot });
      })
      .catch((error: unknown) => workflowWarn("Could not list workflow snapshots:", error));
    return () => {
      cancelled = true;
    };
  }, [target]);

  const snapshot = found && found.forExecutionId === target ? found.snapshot : null;

  const restore = useCallback(async () => {
    if (!snapshot || !target || restoring) return;
    const message = [
      snapshot.fileCount > 0
        ? t("workflow:restore.confirmChanged", { count: snapshot.fileCount })
        : null,
      snapshot.createdCount > 0
        ? t("workflow:restore.confirmCreated", { count: snapshot.createdCount })
        : null,
      t("workflow:restore.confirmLoss"),
    ]
      .filter((part): part is string => part !== null)
      .join(" ");
    const confirmed = await confirmAction({
      title: t("workflow:restore.title"),
      message,
      actionLabel: t("workflow:restore.action"),
      kind: "warning",
    });
    if (!confirmed) return;

    setRestoring(true);
    try {
      const report = await restoreWorkflowSnapshot(snapshot.id);
      if (report.skipped > 0) {
        toast.warning(t("workflow:restore.partial", { count: report.skipped }));
      } else {
        toast.success(t("workflow:restore.done"));
      }
      setFound({ forExecutionId: target, snapshot: null });
    } catch (error) {
      toast.errorDetail(t("workflow:restore.failed"), error);
    } finally {
      setRestoring(false);
    }
  }, [restoring, snapshot, t, target]);

  return { snapshot, restoring, restore };
}
