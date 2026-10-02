/**
 * Purpose: `vmark.workspace.save` handler — persist a tab's buffer to
 * its file path, through the same save pipeline a human save uses.
 * Extracted from workspace.ts (size baseline); re-exported there so dispatch
 * imports are unchanged.
 *
 * @coordinates-with workspace.ts — sibling workspace handlers
 * @coordinates-with bridgeSave.ts — the path guard and the save pipeline
 * @module services/mcpBridge/v2/workspaceSave
 */

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { respond } from "@/services/mcpBridge/utils";
import { v2ErrorString } from "./types";
import { wrapHandler } from "./wrapHandler";
import { respondSaveFailed, saveTabForBridge } from "./bridgeSave";
import type { V2Error } from "./types";

function structuredError(id: string, err: V2Error): Promise<void> {
  return respond({ id, success: false, error: v2ErrorString(err) });
}

interface SaveResolution {
  tabId: string;
  filePath: string;
  content: string;
}

function resolveTabForSave(
  tabIdArg: string | undefined,
): SaveResolution | V2Error {
  const tabState = useTabStore.getState();
  const docState = useDocumentStore.getState();

  let tabId: string;
  if (tabIdArg) {
    if (
      !Object.values(tabState.tabs).some((list) =>
        list.some((t) => t.id === tabIdArg),
      )
    ) {
      return { error: "INVALID_TAB", message: "Unknown tabId" };
    }
    tabId = tabIdArg;
  } else {
    const focused = getCurrentWindowLabel();
    const active = tabState.activeTabId[focused];
    if (!active) {
      return { error: "INVALID_TAB", message: "No focused tab" };
    }
    tabId = active;
  }
  const doc = docState.documents[tabId];
  if (!doc) {
    return { error: "INVALID_TAB", message: "No document for tab" };
  }
  if (!doc.filePath) {
    return {
      error: "INVALID_PATH",
      message: "Tab has no filePath; use save_as instead",
    };
  }
  return { tabId, filePath: doc.filePath, content: doc.content };
}

/**
 * Handle `vmark.workspace.save`. Args: `{tabId?: string}`.
 */
export async function handleWorkspaceSave(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  return wrapHandler(id, async () => {
    const tabIdArg =
      typeof args.tabId === "string" ? args.tabId : undefined;
    const resolved = resolveTabForSave(tabIdArg);
    if ("error" in resolved) {
      await structuredError(id, resolved);
      return;
    }
    const outcome = await saveTabForBridge(
      resolved.tabId,
      resolved.filePath,
      resolved.content,
      "workspace.save",
    );
    if (!outcome.saved) {
      await respondSaveFailed(id, outcome);
      return;
    }
    const revision = useRevisionStore.getState().getRevision(resolved.tabId);
    await respond({
      id,
      success: true,
      data: { filePath: resolved.filePath, revision },
    });
  });
}
