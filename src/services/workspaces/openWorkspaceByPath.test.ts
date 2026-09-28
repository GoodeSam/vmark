// @vitest-environment node
// Shared open-workspace-by-path helper (plan WI-1.1b / ADR-1).
// Both the "Open Folder" menu command and the open_workspace MCP handler call
// this, so opening a folder is one code path and can't half-open (store set but
// tabs/rail/split not restored). It owns the per-window transition guard.
import { describe, it, expect, beforeEach, vi } from "vitest";

const calls: string[] = [];
const openWorkspaceWithConfig = vi.fn(async () => ({ documents: [] }));
const showSidebarWithView = vi.fn(() => calls.push("sidebar"));
const addWorkspace = vi.fn(() => calls.push("recents"));
const restoreWorkspaceTabs = vi.fn(async () => calls.push("restoreTabs"));
const restoreSplitLayout = vi.fn(() => calls.push("restoreSplit"));

vi.mock("@/services/workspaces/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...a: unknown[]) => {
    calls.push("openWorkspaceWithConfig");
    return openWorkspaceWithConfig(...(a as []));
  },
}));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: () => ({ showSidebarWithView }) },
}));
vi.mock("@/stores/workspaceStore", () => ({
  useRecentWorkspacesStore: { getState: () => ({ addWorkspace }) },
}));
vi.mock("@/services/navigation/restoreWorkspaceTabs", () => ({
  restoreWorkspaceTabs: (...a: unknown[]) => restoreWorkspaceTabs(...(a as [])),
  restoreSplitLayout: (...a: unknown[]) => restoreSplitLayout(...(a as [])),
}));
vi.mock("@/services/persistence/sessionTabs", () => ({
  documentPathsForRestore: () => [],
}));

const mockInvoke = vi.fn(async () => undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => {
    calls.push("scope");
    return mockInvoke(cmd as never, args as never);
  },
}));

import { openWorkspaceByPath, WORKSPACE_TRANSITION_GUARD } from "./openWorkspaceByPath";

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe("openWorkspaceByPath", () => {
  it("exports the shared transition-guard key (callers hold it)", () => {
    expect(WORKSPACE_TRANSITION_GUARD).toBe("workspace-transition");
  });

  it("runs the full open sequence in order", async () => {
    await openWorkspaceByPath("/some/folder", { windowLabel: "doc-1" });
    expect(calls).toEqual([
      "openWorkspaceWithConfig",
      "sidebar",
      "recents",
      "restoreTabs",
      "restoreSplit",
    ]);
  });

  // Audit F2 #145 — access is the CALLER's to settle, and every caller does
  // (the picker grants its pick; Open Recent and open_workspace ask Rust and
  // act on the answer). Re-granting here asked Rust a second time for the same
  // folder — a second canonicalize, a second grant, a second post-grant check.
  it("does not ask Rust for access: the caller already settled it", async () => {
    await openWorkspaceByPath("/some/folder", { windowLabel: "doc-1" });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("passes the window label through (default main)", async () => {
    await openWorkspaceByPath("/f");
    expect(restoreSplitLayout).toHaveBeenCalledWith("main", "/f");
  });

  it("returns true when the sequence completes", async () => {
    await expect(openWorkspaceByPath("/f")).resolves.toBe(true);
  });

  it("returns false on an open failure without throwing (does not break the caller)", async () => {
    openWorkspaceWithConfig.mockRejectedValueOnce(new Error("boom"));
    await expect(openWorkspaceByPath("/f")).resolves.toBe(false);
  });
});
