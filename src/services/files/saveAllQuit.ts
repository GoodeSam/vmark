/**
 * Save All and Quit
 *
 * Purpose: save every open document that still needs it, then quit — the
 *   quit-time counterpart of the whole-window close, without its prompts.
 *
 * Key decisions:
 *   - Open TABS decide what is saved, through the same collector the window
 *     close uses. The document store is never iterated: a document with no
 *     live tab is not open, and writing it would put a discarded buffer on
 *     disk.
 *   - Divergent documents are saved too. Quitting is a close, and a document
 *     the user kept after an external edit is exactly what a close must not
 *     drop in silence; "save all" is the explicit instruction to write it.
 *   - The app quits only when the batch reports every document saved. A
 *     cancelled dialog or a failed write leaves the app open.
 *
 * @coordinates-with services/windowClose/dirtyContexts.ts — which tabs still need saving
 * @coordinates-with services/windowClose/closeSaveBatch.ts — the batch writer
 * @coordinates-with services/commands/fileCommands.ts — binds the command (via fileSave.ts)
 * @module services/files/saveAllQuit
 */

import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { imeToast as toast } from "@/services/ime/imeToast";
import { useTabStore } from "@/stores/tabStore";
import { flushAllWysiwygNow } from "@/utils/wysiwygFlush";
import { withReentryGuard } from "@/utils/reentryGuard";
import { saveAllDocuments } from "@/services/windowClose/closeSaveBatch";
import { collectDirtyContexts } from "@/services/windowClose/dirtyContexts";
import type { CloseSaveContext } from "@/services/windowClose/closeSaveShared";
import { fileOpsError } from "@/utils/debug";

/** Save contexts for every open tab, in every window this store holds, that still needs saving. */
function collectOpenDirtyContexts(): CloseSaveContext[] {
  return Object.entries(useTabStore.getState().tabs).flatMap(([label, tabs]) =>
    collectDirtyContexts(label, tabs),
  );
}

/**
 * Handle Save All and Quit — save every open document that needs it, then
 * force quit. Stays in the app when a save is cancelled or fails.
 */
export async function handleSaveAllQuit(windowLabel: string): Promise<void> {
  await withReentryGuard(windowLabel, "save-all-quit", async () => {
    try {
      // Flush ALL mounted editors before reading dirty state (Save All spans
      // every tab, not just the focused one).
      flushAllWysiwygNow();
      const contexts = collectOpenDirtyContexts();
      if (contexts.length > 0) {
        // Prompts for a path (one untitled document) or a folder (several).
        const result = await saveAllDocuments(contexts);
        if (result.action !== "saved-all") return; // cancelled: stay in the app
      }
      await invoke("force_quit");
    } catch (error) {
      fileOpsError("SaveAllQuit failed:", error);
      toast.error(i18n.t("dialog:toast.failedToSaveDocuments"));
    }
  });
}
