/**
 * Close All — every tab of the given set, pinned ones included.
 *
 * Purpose: a pin protects a tab from an ACCIDENTAL close, so every other
 * close refuses it. Close All is the one deliberate "empty the strip" action:
 * it asks once, naming how many pinned tabs would go, and on confirmation
 * closes them with the rest. Without pinned tabs it asks nothing.
 *
 * Key decisions:
 *   - The close itself is still `closeTabWithDirtyCheck`, one tab at a time,
 *     so each unsaved document gets its own save prompt and a cancelled
 *     prompt stops the rest. A pinned tab is unpinned immediately before its
 *     own close, never in advance: a cancel leaves every tab not yet reached
 *     exactly as it was.
 *   - Unpinned tabs go first, then pinned ones from right to left. Least
 *     protected first means a cancel among the unpinned tabs touches no pin;
 *     right to left means the tab being unpinned is always the last of the
 *     pinned group, so re-pinning it after a refused close puts it back in the
 *     same position.
 *   - Pin state is read LIVE after the confirmation: the list handed in is the
 *     menu's snapshot, and the dialog is an await.
 *   - A second call for a window while one is running joins it rather than
 *     opening a second confirmation.
 *
 * @coordinates-with tabOperations.ts — the per-tab close lifecycle
 * @coordinates-with services/dialogs/confirmAction.ts — the confirmation
 * @coordinates-with components/Tabs/useTabContextMenuActions.ts — the caller
 * @module services/tabs/closeAllTabs
 */
import { useTabStore, type Tab } from "@/stores/tabStore";
import { confirmAction } from "@/services/dialogs/confirmAction";
import i18n from "@/i18n";
import { closeTabWithDirtyCheck } from "./tabOperations";

const inFlight = new Map<string, Promise<boolean>>();

const liveTab = (windowLabel: string, tabId: string): Tab | undefined =>
  useTabStore.getState().getTabsByWindow(windowLabel).find((tab) => tab.id === tabId);

/** The targeted tabs that still exist, in strip order, with their live pin state. */
function liveTargets(windowLabel: string, targetIds: ReadonlySet<string>): Tab[] {
  return useTabStore.getState().getTabsByWindow(windowLabel).filter((tab) => targetIds.has(tab.id));
}

/** Close one tab through the lifecycle, lifting its pin for the attempt only. */
async function closeLiftingPin(windowLabel: string, tabId: string): Promise<boolean> {
  const before = liveTab(windowLabel, tabId);
  if (!before) return true;
  const { togglePin } = useTabStore.getState();
  if (before.isPinned) togglePin(windowLabel, tabId);

  const closed = await closeTabWithDirtyCheck(windowLabel, tabId);

  // Refused (cancelled save prompt): the tab stays, so its pin comes back.
  const after = liveTab(windowLabel, tabId);
  if (!closed && before.isPinned && after && !after.isPinned) togglePin(windowLabel, tabId);
  return closed;
}

async function run(windowLabel: string, tabs: readonly Tab[]): Promise<boolean> {
  const targetIds = new Set(tabs.map((tab) => tab.id));
  const pinnedCount = liveTargets(windowLabel, targetIds).filter((tab) => tab.isPinned).length;

  if (pinnedCount > 0) {
    const confirmed = await confirmAction({
      title: i18n.t("dialog:closeAll.pinnedTitle"),
      message: i18n.t("dialog:closeAll.pinnedPrompt", { count: pinnedCount }),
      actionLabel: i18n.t("dialog:closeAll.confirmClose"),
      kind: "warning",
    });
    if (!confirmed) return false;
  }

  const targets = liveTargets(windowLabel, targetIds);
  const order = [
    ...targets.filter((tab) => !tab.isPinned),
    ...targets.filter((tab) => tab.isPinned).reverse(),
  ];
  for (const tab of order) {
    if (!(await closeLiftingPin(windowLabel, tab.id))) return false;
  }
  return true;
}

/**
 * Close every given tab, asking first when any of them is pinned.
 *
 * @returns true when all of them closed; false when the confirmation or a
 *   save prompt was cancelled (tabs closed before that point stay closed).
 */
export async function closeAllTabs(windowLabel: string, tabs: readonly Tab[]): Promise<boolean> {
  const existing = inFlight.get(windowLabel);
  if (existing) return existing;
  const pending = run(windowLabel, tabs);
  inFlight.set(windowLabel, pending);
  try {
    return await pending;
  } finally {
    inFlight.delete(windowLabel);
  }
}
