/**
 * workspaceAccess — the frontend half of Rust-owned workspace grants (WI-LX1.1).
 *
 * Purpose: a folder outside the static fs scope (`$HOME/**`, `/Volumes/**`,
 *   `/mnt/**`, `/media/**`, and `C:\` to `F:\` on Windows) is readable only
 *   through a RUNTIME grant, and Rust makes that grant only for a folder it can
 *   attribute to the user: one picked in the folder dialog Rust shows, one
 *   opened from Finder, or one recorded from those in an earlier session. This
 *   module asks about a folder and turns the answer into what the caller should
 *   do; it cannot make Rust grant anything.
 *
 * Key decisions:
 *   - Rust answers only "was this chosen before?". Whether the static scope
 *     already reads the folder is MEASURED with one `exists()` probe, never
 *     modelled here: the capability globs (and their dot-file rule) are the
 *     fs plugin's to evaluate, and a hand copy would drift.
 *   - Anything that is not a clean typed answer is `unverified`, never read as
 *     permission. Callers decide how to degrade.
 *   - Confirming a folder is the picker, opened AT that folder, so it is one
 *     click on Open. `requestWorkspaceConfirmation` does not wait for it: the
 *     MCP transport cannot hold a request open for a person.
 *
 * @coordinates-with src-tauri/src/workspace_grants/commands.rs — allow_workspace_access, pick_workspace_folder
 * @coordinates-with services/workspaces/openWorkspaceByPath.ts — re-grants before reading
 * @coordinates-with services/commands/workspaceCommands.ts — File → Open Workspace (the picker)
 * @coordinates-with services/commands/recentWorkspacesCommands.ts — Open Recent
 * @coordinates-with services/mcpBridge/v2/workspaceOpenFolder.ts — the open_workspace tool
 * @module services/workspaces/workspaceAccess
 */
import { invoke } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";
import { parseCommandError } from "@/services/commands/commandError";
import { workspaceError, workspaceWarn } from "@/utils/debug";

/** What the caller may do with a folder it wants to open as a workspace. */
export type WorkspaceAccess =
  /** Chosen before (or inside a chosen folder): granted again. */
  | { kind: "granted"; root: string }
  /** Not chosen, but the static scope already reads it — nothing to grant. */
  | { kind: "readable" }
  /** Gone, or not a folder. */
  | { kind: "missing" }
  /** Not chosen and unreadable: only the user, in the picker, can grant it. */
  | { kind: "needs-confirmation" }
  /** No usable answer (IPC failure, unexpected code, malformed reply). */
  | { kind: "unverified"; error: unknown };

/** Is `path` readable by the webview without a runtime grant? */
async function readableWithoutGrant(path: string): Promise<boolean> {
  try {
    await exists(path);
    return true;
  } catch {
    // Out of scope rejects with "forbidden path"; an in-scope folder resolves.
    return false;
  }
}

/** Ask Rust about `path` and turn the answer into a {@link WorkspaceAccess}. */
export async function resolveWorkspaceAccess(path: string): Promise<WorkspaceAccess> {
  let root: unknown;
  try {
    root = await invoke<string>("allow_workspace_access", { path });
  } catch (error) {
    const code = parseCommandError(error)?.code;
    if (code === "not-found" || code === "invalid-input") return { kind: "missing" };
    if (code !== "permission-denied") return { kind: "unverified", error };
    return (await readableWithoutGrant(path))
      ? { kind: "readable" }
      : { kind: "needs-confirmation" };
  }
  if (typeof root !== "string" || root.length === 0) {
    return { kind: "unverified", error: new Error("allow_workspace_access returned no root") };
  }
  return { kind: "granted", root };
}

/**
 * Show the folder picker Rust owns; Rust grants and records what the user
 * picks. Resolves to the canonical folder, or `null` when cancelled. Rejects
 * when a picker is already open (`conflict`) or the IPC fails.
 */
export async function pickWorkspaceFolder(
  options: { defaultPath?: string } = {},
): Promise<string | null> {
  const picked = await invoke<string | null>("pick_workspace_folder", {
    defaultPath: options.defaultPath ?? null,
  });
  return typeof picked === "string" && picked.length > 0 ? picked : null;
}

/**
 * Ask the user to confirm `path` in the picker, without waiting for them.
 * A refusal (another picker is open) or an IPC failure is logged, not thrown.
 */
export function requestWorkspaceConfirmation(path: string): void {
  pickWorkspaceFolder({ defaultPath: path }).catch((error: unknown) => {
    if (parseCommandError(error)?.code === "conflict") {
      workspaceWarn("A folder dialog is already open; not opening another for", path);
      return;
    }
    workspaceError("Could not open the folder dialog:", error);
  });
}

/**
 * Re-issue the grant for `path` if the user chose it before. Never throws: a
 * refusal is the ordinary answer for a folder the static scope covers, and any
 * other failure leaves the open to surface its own read errors.
 */
export async function regrantWorkspaceAccess(path: string): Promise<void> {
  try {
    await invoke<string>("allow_workspace_access", { path });
  } catch (error) {
    if (parseCommandError(error)?.code !== "permission-denied") {
      workspaceError("Could not re-grant workspace access:", error);
    }
  }
}
