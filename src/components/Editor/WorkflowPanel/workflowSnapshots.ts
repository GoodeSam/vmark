/**
 * The run panel's view of workflow snapshots (WI-LX2.3).
 *
 * Purpose: the two IPC calls behind "Restore files" — which runs took a
 * pre-run snapshot, and putting one back. Both commands return a typed
 * `CommandError`, so callers render failures with `commandErrorMessage`.
 *
 * Key decisions:
 *   - The reply is validated here, at the boundary: a malformed summary is
 *     dropped and a malformed report throws, rather than a UI rendering
 *     `NaN files restored`.
 *   - The restore takes the snapshot id ONLY. The root it writes under comes
 *     from the snapshot's own record in Rust, so the webview cannot aim it.
 *
 * @coordinates-with src-tauri/src/workflow/snapshot_commands.rs — the commands
 * @coordinates-with components/Editor/WorkflowPanel/useRunSnapshot.ts — the caller
 * @module components/Editor/WorkflowPanel/workflowSnapshots
 */
import { invoke } from "@tauri-apps/api/core";

export interface SnapshotSummary {
  id: string;
  executionId: string;
  timestamp: number;
  /** Files that existed before the run and a restore puts back. */
  fileCount: number;
  /** Files the run created, which a restore deletes. */
  createdCount: number;
}

export interface RestoreReport {
  restored: number;
  deleted: number;
  skipped: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A count or timestamp as Rust sends it (`usize`/`u64`): a safe, non-negative
 *  integer. `typeof "number"` alone admits NaN, Infinity, negatives and fractions. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSummary(value: unknown): value is SnapshotSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.executionId === "string" &&
    isCount(value.timestamp) &&
    isCount(value.fileCount) &&
    isCount(value.createdCount)
  );
}

export async function listWorkflowSnapshots(): Promise<SnapshotSummary[]> {
  const reply: unknown = await invoke("list_workflow_snapshots");
  return Array.isArray(reply) ? reply.filter(isSummary) : [];
}

/** The snapshot `executionId` took before it ran, or null if it took none. */
export async function findRunSnapshot(executionId: string): Promise<SnapshotSummary | null> {
  const all = await listWorkflowSnapshots();
  return all.find((s) => s.executionId === executionId) ?? null;
}

export async function restoreWorkflowSnapshot(snapshotId: string): Promise<RestoreReport> {
  const reply: unknown = await invoke("restore_workflow_snapshot", { snapshotId });
  if (isRecord(reply) && isCount(reply.restored) && isCount(reply.deleted) && isCount(reply.skipped)) {
    return { restored: reply.restored, deleted: reply.deleted, skipped: reply.skipped };
  }
  throw new Error("restore_workflow_snapshot returned a malformed restore report");
}
