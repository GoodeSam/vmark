// WI-RA19.2 — "Close All" closes every unpinned tab while pinned tabs stay.
// It used to hand the pinned ids to the bulk close too; the close lifecycle
// refuses a pinned tab and stops at the first refusal, and pinned tabs sit at
// the left of the strip, so with any tab pinned Close All closed nothing.
// Runs against the REAL tab store and close lifecycle — the sibling suite
// mocks the lifecycle, which is how the refusal went unnoticed.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { bootstrapFormats } from "@/lib/formats";
import { useTabStore } from "@/stores/tabStore";
import { useTabContextMenuActions, type TabMenuItem } from "./useTabContextMenuActions";

const WINDOW = "main";

function seed(pinned: readonly number[], count: number): string[] {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(useTabStore.getState().createTab(WINDOW));
  for (const i of pinned) useTabStore.getState().togglePin(WINDOW, ids[i]);
  return ids;
}

function closeAllItem(): TabMenuItem {
  const tabs = useTabStore.getState().getTabsByWindow(WINDOW);
  const tab = tabs[0];
  if (!tab) throw new Error("no tabs seeded");
  const { result } = renderHook(() =>
    useTabContextMenuActions({
      tab,
      tabs,
      filePath: null,
      windowLabel: WINDOW,
      workspaceRoot: null,
      revealLabel: "Reveal",
      closeShortcutLabel: "",
      onClose: () => undefined,
    }),
  );
  const item = result.current.find((entry) => entry.id === "closeAll");
  if (!item) throw new Error("no closeAll item");
  return item;
}

const openIds = () => useTabStore.getState().getTabsByWindow(WINDOW).map((t) => t.id);

beforeAll(() => {
  bootstrapFormats();
});

beforeEach(() => {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
});

describe("Close All with pinned tabs", () => {
  it("closes every unpinned tab and keeps the pinned one", async () => {
    const [a] = seed([0], 3);
    await closeAllItem().action();
    expect(openIds()).toEqual([a]);
  });

  it("keeps several pinned tabs and closes the rest", async () => {
    const ids = seed([0, 2], 4);
    await closeAllItem().action();
    expect(new Set(openIds())).toEqual(new Set([ids[0], ids[2]]));
  });

  it("closes everything when nothing is pinned", async () => {
    seed([], 3);
    await closeAllItem().action();
    expect(openIds()).toEqual([]);
  });

  it("is disabled when every tab is pinned, since it could close nothing", () => {
    seed([0, 1], 2);
    expect(closeAllItem().disabled).toBe(true);
  });
});
