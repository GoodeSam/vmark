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
 *   - Nothing captured before a dialog is trusted after it. The Save As dialog
 *     and the folder picker stay open for as long as the user takes, and an
 *     edit (human or MCP), a save through another path or a tab close can land
 *     meanwhile. Each write therefore re-reads the live document: what is
 *     written is what the buffer holds at that moment, and a document that no
 *     longer needs saving is not written at all.
 *   - The dirty set is REVALIDATED after every save pass, the same loop the
 *     window close runs. Saves yield, so an edit can land during a write; it
 *     gets another pass instead of being lost to the quit. The app quits only
 *     from a pass that found nothing left to save, with no await between that
 *     check and the quit. Bounded: documents that will not come to rest are a
 *     refusal, never a quit over unsaved content.
 *   - A cancelled dialog or a failed write leaves the app open.
 *
 * @coordinates-with services/windowClose/dirtyContexts.ts — which tabs still need saving, and the loop bound
 * @coordinates-with services/windowClose/closeSaveBatch.ts — the batch writer and its revalidate hook
 * @coordinates-with services/windowClose/windowCloseFlow.ts — the loop this mirrors
 * @coordinates-with services/commands/fileCommands.ts — binds the command (via fileSave.ts)
 * @module services/files/saveAllQuit
 */

import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { imeToast as toast } from "@/services/ime/imeToast";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { flushAllWysiwygNow } from "@/utils/wysiwygFlush";
import { withReentryGuard } from "@/utils/reentryGuard";
import { saveAllDocuments } from "@/services/windowClose/closeSaveBatch";
import {
  collectDirtyContexts,
  needsResolution,
  MAX_RESOLUTION_ATTEMPTS,
} from "@/services/windowClose/dirtyContexts";
import type { CloseSaveContext } from "@/services/windowClose/closeSaveShared";
import { fileOpsError } from "@/utils/debug";

/** Save contexts for every open tab, in every window this store holds, that still needs saving. */
function collectOpenDirtyContexts(): CloseSaveContext[] {
  // Sync every mounted editor first: an edit still in the debounce window is
  // otherwise invisible to the check (Save All spans every tab).
  flushAllWysiwygNow();
  return Object.entries(useTabStore.getState().tabs).flatMap(([label, tabs]) =>
    collectDirtyContexts(label, tabs),
  );
}

/**
 * The context to write NOW, or `null` when there is nothing left to save: the
 * tab was closed, or the document came to rest by another path, since the
 * context was captured.
 */
function liveContext(context: CloseSaveContext): CloseSaveContext | null {
  flushAllWysiwygNow();
  if (!useTabStore.getState().findTabById(context.tabId)) return null;
  const doc = useDocumentStore.getState().getDocument(context.tabId);
  if (!doc || !needsResolution(doc)) return null;
  return { ...context, filePath: doc.filePath ?? context.filePath, content: doc.content };
}

/**
 * Handle Save All and Quit — save every open document that needs it, then
 * force quit. Stays in the app when a save is cancelled or fails, or when the
 * documents will not come to rest.
 */
export async function handleSaveAllQuit(windowLabel: string): Promise<void> {
  await withReentryGuard(windowLabel, "save-all-quit", async () => {
    try {
      for (let attempt = 0; attempt < MAX_RESOLUTION_ATTEMPTS; attempt++) {
        const contexts = collectOpenDirtyContexts();
        if (contexts.length === 0) {
          // Nothing between this check and the quit yields, so a buffer at
          // rest HERE cannot be dirtied before the app is gone.
          await invoke("force_quit");
          return;
        }
        // Prompts for a path (one untitled document) or a folder (several).
        const result = await saveAllDocuments(contexts, { revalidate: liveContext });
        if (result.action !== "saved-all") return; // cancelled: stay in the app
        // Loop: revalidate. A document dirty again after its save was edited
        // while the batch ran — it gets another pass, not a quit over it.
      }
      // Documents kept changing faster than they could be saved — refuse.
      fileOpsError("SaveAllQuit abandoned: documents would not come to rest");
      toast.error(i18n.t("dialog:toast.failedToSaveDocuments"));
    } catch (error) {
      fileOpsError("SaveAllQuit failed:", error);
      toast.error(i18n.t("dialog:toast.failedToSaveDocuments"));
    }
  });
}
