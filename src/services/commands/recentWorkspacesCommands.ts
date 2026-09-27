/**
 * Recent-workspaces commands — ADR-012 migration of
 * useRecentWorkspacesMenuEvents.
 *
 * Two commands: clear the list, and open one.
 *
 * What is LOCAL here is the decision: is this entry still a folder, and does
 * this window's unsaved work mean the workspace belongs in a new window? The
 * accepted in-window transition itself is `openWorkspaceByPath` (audit #938).
 * This file used to re-implement that sequence — config, sidebar, tab restore,
 * split restore, recents — and the copy was missing the original's top-level
 * error boundary, so a throw anywhere inside it escaped the command instead of
 * being logged and reported as "did not open".
 *
 * Access comes first (WI-LX1.1): the entry is webview data, so Rust grants it
 * only if the user chose that folder before. A folder the static scope cannot
 * read, and nobody chose, goes back through the folder picker opened AT it.
 *
 * @coordinates-with services/workspaces/openWorkspaceByPath.ts — the shared transition
 * @coordinates-with services/workspaces/workspaceAccess.ts — the access question and the picker
 * @module services/commands/recentWorkspacesCommands
 */

import { exists, stat } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { imeToast as toast } from "@/services/ime/imeToast";
import { registerCommands, type CommandDefinition } from "./CommandBus";
import { useRecentWorkspacesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { withReentryGuard } from "@/utils/reentryGuard";
import i18n from "@/i18n";
import { workspaceError } from "@/utils/debug";
import { parseRecentPathArgs } from "./recentPathArgs";
import {
  WORKSPACE_TRANSITION_GUARD,
  openWorkspaceByPath,
} from "@/services/workspaces/openWorkspaceByPath";
import { confirmAction } from "@/services/dialogs/confirmAction";
import {
  pickWorkspaceFolder,
  resolveWorkspaceAccess,
} from "@/services/workspaces/workspaceAccess";

type Ctx = { windowLabel?: string };

/**
 * Is this recents entry still a FOLDER we could open?
 *
 * Two refusals the plain `exists()` could not make:
 *   - `exists()` is true for a regular FILE too (audit #937), and
 *     `openWorkspaceWithConfig` falls back to store defaults on ANY read
 *     failure — so a file standing where the folder used to be would have been
 *     installed as the workspace root, with the whole window in workspace mode
 *     over something that has no file tree. Reported as not-found, which is
 *     what it is: the FOLDER is gone.
 *   - A probe that could not RUN is NOT evidence the workspace is gone.
 *     Offering to remove a workspace that exists is the worse outcome, so
 *     continue and let the open surface any real failure.
 */
async function recentWorkspaceIsPresent(workspacePath: string): Promise<boolean> {
  try {
    if (!(await exists(workspacePath))) return false;
    return (await stat(workspacePath)).isDirectory;
  } catch (error) {
    workspaceError("Could not probe recent workspace:", error);
    return true;
  }
}

/** Which folder this Open Recent goes on to open, if any. */
type RecentTarget =
  | { kind: "open"; path: string }
  | { kind: "missing" }
  | { kind: "cancelled" };

/**
 * Ask Rust for access to a recents entry, and settle what to open (WI-LX1.1).
 *
 * Granted, already readable, or unverifiable → the entry itself (an IPC
 * failure is not evidence the folder is gone; the open surfaces real errors).
 * Gone → `missing`. Unchosen and unreadable → the picker, opened at the entry:
 * the folder the user picks is what opens, and a cancel opens nothing.
 */
async function recentWorkspaceTarget(workspacePath: string): Promise<RecentTarget> {
  const access = await resolveWorkspaceAccess(workspacePath);
  switch (access.kind) {
    case "missing":
      return { kind: "missing" };
    case "needs-confirmation":
      try {
        const picked = await pickWorkspaceFolder({ defaultPath: workspacePath });
        return picked ? { kind: "open", path: picked } : { kind: "cancelled" };
      } catch (error) {
        workspaceError("Could not open the folder dialog:", error);
        return { kind: "cancelled" };
      }
    case "unverified":
      workspaceError("Could not check access to recent workspace:", access.error);
      return { kind: "open", path: workspacePath };
    case "granted":
    case "readable":
      return { kind: "open", path: workspacePath };
  }
}

/**
 * Hand the workspace to a NEW window because this one holds unsaved work.
 * Returns nothing: the IPC failure is the user's to see, not the caller's to
 * branch on.
 */
async function openRecentWorkspaceInNewWindow(workspacePath: string): Promise<void> {
  try {
    await invoke("open_workspace_in_new_window", {
      workspaceRoot: workspacePath,
      filePath: null,
    });
  } catch (error) {
    // IPC failure must surface to the user, not reject the command
    // silently — matches the localized feedback other paths use.
    workspaceError("Failed to open workspace in new window:", error);
    toast.error(i18n.t("dialog:toast.openWorkspaceInNewWindowFailed"));
  }
}

/** Owner token this batch registers under (HMR-safe, atomic — see viewCommands). */
const RECENT_WORKSPACES_COMMANDS_OWNER = "recent-workspaces-commands";

/** Build the recent-workspaces command specs (pure — no registration). */
function buildRecentWorkspacesCommandSpecs(): CommandDefinition[] {
  const specs: CommandDefinition[] = [];
  const add = (command: CommandDefinition): void => void specs.push(command);

  add({
    id: "workspace.clearRecent",
    title: () => i18n.t("commands:workspace.clearRecent"),
    category: "workspace",
    run: async (_args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const { workspaces } = useRecentWorkspacesStore.getState();
      if (workspaces.length === 0) return;
      await withReentryGuard(windowLabel, "clear-recent-workspaces", async () => {
        const confirmed = await confirmAction({
          title: i18n.t("dialog:clearRecentWorkspaces.title"),
          message: i18n.t("dialog:clearRecentWorkspaces.message"),
          actionLabel: i18n.t("dialog:action.clear"),
          kind: "warning",
        });
        if (confirmed) {
          useRecentWorkspacesStore.getState().clearAll();
        }
      });
    },
  });

  add({
    id: "workspace.openRecent",
    title: () => i18n.t("commands:workspace.openRecent"),
    category: "workspace",
    run: async (args, ctx: Ctx) => {
      const windowLabel = ctx.windowLabel ?? "main";
      const workspacePath = parseRecentPathArgs(args);
      if (!workspacePath) return;

      // Shares the workspace-transition guard with workspace.openFolder /
      // workspace.close — a per-command key would let two workspace opens race.
      await withReentryGuard(windowLabel, WORKSPACE_TRANSITION_GUARD, async () => {
        // #1252 / audit #936 — access comes BEFORE the probe. Grants do not
        // survive a restart, so a recents entry outside the static scope
        // (`G:\` on Windows, `/opt` on macOS) made `exists()` REJECT with
        // "forbidden path"; that rejection escaped the command and the menu
        // item did nothing at all, with no message. The transition re-grants
        // too — the grant is idempotent, and neither caller may assume the
        // other ran.
        const target = await recentWorkspaceTarget(workspacePath);
        if (target.kind === "cancelled") return;

        if (target.kind === "missing" || !(await recentWorkspaceIsPresent(target.path))) {
          const remove = await confirmAction({
            title: i18n.t("dialog:workspaceNotFound.title"),
            message: i18n.t("dialog:workspaceNotFound.message"),
            actionLabel: i18n.t("dialog:action.remove"),
            kind: "warning",
          });
          if (remove) {
            useRecentWorkspacesStore.getState().removeWorkspace(workspacePath);
          }
          return;
        }

        // Unsaved work stays where it is: the workspace opens in a new window
        // instead. This decision is the only part of the flow that is specific
        // to opening from RECENTS.
        const hasDirtyTabs = useTabStore
          .getState()
          .getTabsByWindow(windowLabel)
          .some((tab) => useDocumentStore.getState().getDocument(tab.id)?.isDirty);
        if (hasDirtyTabs) {
          const confirmed = await confirmAction({
            title: i18n.t("dialog:unsavedChanges.title"),
            message: i18n.t("dialog:unsavedChanges.openInNewWindow"),
            actionLabel: i18n.t("dialog:unsavedChanges.openInNewWindowOk"),
            kind: "warning",
            cancelLabel: i18n.t("dialog:unsavedChanges.openInNewWindowCancel"),
          });
          if (confirmed) await openRecentWorkspaceInNewWindow(target.path);
          return;
        }

        // The shared transition — config, sidebar, recents, tab restore, split
        // restore — under the guard this command already holds.
        await openWorkspaceByPath(target.path, { windowLabel });
      });
    },
  });

  return specs;
}

/**
 * Register both recent-workspace commands as ONE owner batch (audit #934).
 *
 * A `hasCommand("workspace.clearRecent")` sentinel suppressed
 * `workspace.openRecent` whenever that id was already taken, and gave no
 * atomicity of its own outside the bootstrap transaction.
 */
export function registerRecentWorkspacesCommands(): void {
  registerCommands(RECENT_WORKSPACES_COMMANDS_OWNER, buildRecentWorkspacesCommandSpecs());
}
