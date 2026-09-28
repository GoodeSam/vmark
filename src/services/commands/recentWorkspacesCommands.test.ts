// @vitest-environment node
/**
 * Tests for Open Recent Workspace command (ADR-012).
 *
 * Covers arg validation, missing-workspace removal, the dirty-tab new-window
 * flow (including IPC failure feedback), and the tab-restore path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExists = vi.fn();
const mockAsk = vi.fn();
// WI-LX1.1 — the menu's folder picker is Rust's (`pick_workspace_folder`); the
// plugin dialog's `open` is mocked only so nothing reaches a real dialog.
const mockPickFolder = vi.fn();
const mockDialogOpen = vi.fn();
const mockInvoke = vi.fn();
const mockOpenWorkspaceWithConfig = vi.fn();
const mockRestoreWorkspaceTabs = vi.fn();
const mockToastError = vi.fn();
const mockPersistWorkspaceSession = vi.fn();

const mockStat = vi.fn();
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: (...a: unknown[]) => mockExists(...a),
  stat: (...a: unknown[]) => mockStat(...a),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...a: unknown[]) => mockAsk(...a),
  open: (...a: unknown[]) => mockDialogOpen(...a),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => mockInvoke(...a) }));
vi.mock("@/services/workspaces/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: (...a: unknown[]) => mockOpenWorkspaceWithConfig(...a),
}));
vi.mock("@/services/workspaces/workspaceSession", () => ({
  persistWorkspaceSession: (...a: unknown[]) => mockPersistWorkspaceSession(...a),
}));
vi.mock("@/services/navigation/restoreWorkspaceTabs", () => ({
  restoreWorkspaceTabs: (...a: unknown[]) => mockRestoreWorkspaceTabs(...a),
  restoreSplitLayout: () => {},
}));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { error: (...a: unknown[]) => mockToastError(...a) } }));

import { executeCommand, listCommands, _resetCommandBus } from "./CommandBus";
import { registerRecentWorkspacesCommands } from "./recentWorkspacesCommands";
import { registerWorkspaceCommands } from "./workspaceCommands";
import { useRecentWorkspacesStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

// The dirty-tab tests below stub the stores' METHODS via setState. Zustand
// merges, so those stubs would leak into every later test unless the real
// implementations (captured here, before any test runs) are restored each time.
const realGetTabsByWindow = useTabStore.getState().getTabsByWindow;
const realGetDocument = useDocumentStore.getState().getDocument;

beforeEach(() => {
  _resetCommandBus();
  [mockExists, mockStat, mockAsk, mockPickFolder, mockDialogOpen, mockInvoke, mockOpenWorkspaceWithConfig,
    mockRestoreWorkspaceTabs, mockToastError, mockPersistWorkspaceSession]
    .forEach((m) => m.mockReset());
  mockExists.mockResolvedValue(true);
  mockStat.mockResolvedValue({ isDirectory: true });
  mockOpenWorkspaceWithConfig.mockResolvedValue(null);
  mockRestoreWorkspaceTabs.mockResolvedValue(0);
  // Rust's access answer for a folder the user chose before: the canonical
  // root. Every other command resolves to nothing.
  mockInvoke.mockImplementation(async (cmd: string, args?: { path?: string }) => {
    if (cmd === "allow_workspace_access") return args?.path;
    if (cmd === "pick_workspace_folder") return mockPickFolder(args);
    return undefined;
  });
  mockPersistWorkspaceSession.mockResolvedValue(undefined);
  useRecentWorkspacesStore.setState({ workspaces: [{ path: "/repo" }] } as never);
  useTabStore.setState({
    tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {},
    getTabsByWindow: realGetTabsByWindow,
  } as never);
  useDocumentStore.setState({ documents: {}, getDocument: realGetDocument } as never);
  registerRecentWorkspacesCommands();
});

afterEach(() => _resetCommandBus());

describe("HMR re-registration (dev-only Vite reload)", () => {
  it("re-registering the owner batch replaces it instead of throwing", () => {
    const before = listCommands().length;
    // Vite HMR re-runs the registrar module against a REGISTRY that survives.
    // `registerCommands` replaces the owner's own previous batch, which is the
    // whole idempotence guard — there is no module-level flag to reset.
    expect(() => registerRecentWorkspacesCommands()).not.toThrow();
    expect(listCommands().length).toBe(before);
  });
});

describe("workspace.openRecent", () => {
  it.each([[[]], [[null]], [null], [undefined], [""]])(
    "rejects non-string args (%j) without touching the filesystem",
    async (args) => {
      await executeCommand("workspace.openRecent", args, { windowLabel: "main" });
      expect(mockExists).not.toHaveBeenCalled();
    },
  );

  it("removes a missing workspace from recents on confirm", async () => {
    mockExists.mockResolvedValue(false);
    mockAsk.mockResolvedValue(true);

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(useRecentWorkspacesStore.getState().workspaces).toEqual([]);
    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
  });

  it("opens the workspace and restores its tabs when not dirty", async () => {
    mockExists.mockResolvedValue(true);
    mockOpenWorkspaceWithConfig.mockResolvedValue({ lastOpenTabs: ["/repo/a.md"] });

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/repo", { windowLabel: "main" });
    expect(mockRestoreWorkspaceTabs).toHaveBeenCalledWith("main", ["/repo/a.md"]);
    expect(useRecentWorkspacesStore.getState().workspaces).toContainEqual(
      expect.objectContaining({ path: "/repo" }),
    );
  });

  it("opens in a new window when there are dirty tabs and the user confirms", async () => {
    useTabStore.setState({
      tabs: { main: [{ id: "t1", filePath: "/x.md" }] },
      activeTabId: { main: "t1" },
      getTabsByWindow: () => [{ id: "t1", filePath: "/x.md" }],
    } as never);
    useDocumentStore.setState({
      documents: { t1: { isDirty: true } },
      getDocument: () => ({ isDirty: true }),
    } as never);
    mockAsk.mockResolvedValue(true);

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", {
      workspaceRoot: "/repo",
      filePath: null,
    });
    // Did not open in the current window.
    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
  });

  it("is skipped while a workspace open is already in flight in the same window", async () => {
    registerWorkspaceCommands();
    let resolvePicker!: (value: string | null) => void;
    mockPickFolder.mockImplementation(
      () => new Promise<string | null>((resolve) => { resolvePicker = resolve; }),
    );

    const opening = executeCommand("workspace.openFolder", {}, { windowLabel: "main" });
    // Both commands are workspace transitions for the same window. Running them
    // concurrently restores tabs/split layout into whichever workspace lands
    // last — they must share one guard, not two independent keys.
    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockExists).not.toHaveBeenCalled();
    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();

    resolvePicker(null);
    await opening;

    // Guard released after the first transition completes.
    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });
    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/repo", { windowLabel: "main" });
  });

  it("does not block a workspace open in a different window", async () => {
    registerWorkspaceCommands();
    let resolvePicker!: (value: string | null) => void;
    mockPickFolder.mockImplementation(
      () => new Promise<string | null>((resolve) => { resolvePicker = resolve; }),
    );

    const opening = executeCommand("workspace.openFolder", {}, { windowLabel: "main" });
    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "doc-1" });

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/repo", { windowLabel: "doc-1" });

    resolvePicker(null);
    await opening;
  });

  it("toasts a localized error when the dirty-tab new-window IPC fails", async () => {
    useTabStore.setState({
      tabs: { main: [{ id: "t1", filePath: "/x.md" }] },
      activeTabId: { main: "t1" },
      getTabsByWindow: () => [{ id: "t1", filePath: "/x.md" }],
    } as never);
    useDocumentStore.setState({
      documents: { t1: { isDirty: true } },
      getDocument: () => ({ isDirty: true }),
    } as never);
    mockAsk.mockResolvedValue(true);
    mockInvoke.mockRejectedValue(new Error("ipc down"));

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockToastError).toHaveBeenCalled();
  });
});

// Audit #937 — `exists()` is true for a regular FILE, and
// `openWorkspaceWithConfig` falls back to store defaults on any read failure,
// so a file standing where the folder used to be would have been installed as
// the workspace root.
describe("workspace.openRecent requires a DIRECTORY (#937)", () => {
  it("treats a file at the recorded path as a missing workspace", async () => {
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ isDirectory: false });
    mockAsk.mockResolvedValue(true);

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
    expect(useRecentWorkspacesStore.getState().workspaces).toEqual([]);
  });

  it("still opens a real directory", async () => {
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ isDirectory: true });

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/repo", { windowLabel: "main" });
  });

  it("a stat that cannot RUN keeps the older verdict: continue, do not offer removal", async () => {
    // Offering to remove a workspace that exists is the worse outcome — the
    // same reasoning the exists() probe already carries.
    mockExists.mockResolvedValue(true);
    mockStat.mockRejectedValue(new Error("forbidden path"));

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/repo", { windowLabel: "main" });
    expect(useRecentWorkspacesStore.getState().workspaces).toEqual([{ path: "/repo" }]);
  });
});

// Audit #938 — the in-window transition is `openWorkspaceByPath`, not a local
// re-implementation of it. The copy this command used to keep had no top-level
// error boundary, so a throw from anywhere inside the sequence escaped the
// command; the shared one logs and reports "did not open" instead.
describe("workspace.openRecent delegates the accepted transition", () => {
  it("does not reject when the transition throws", async () => {
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ isDirectory: true });
    mockOpenWorkspaceWithConfig.mockRejectedValue(new Error("config unreadable"));

    await expect(
      executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" }),
    ).resolves.toBe(true);

    expect(mockRestoreWorkspaceTabs).not.toHaveBeenCalled();
  });

  it("records the workspace in recents through the shared transition", async () => {
    useRecentWorkspacesStore.setState({ workspaces: [] } as never);
    mockExists.mockResolvedValue(true);
    mockStat.mockResolvedValue({ isDirectory: true });
    mockOpenWorkspaceWithConfig.mockResolvedValue(null);

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(useRecentWorkspacesStore.getState().workspaces).toContainEqual(
      expect.objectContaining({ path: "/repo" }),
    );
  });
});

// WI-LX1.1 — Rust decides whether a recents entry may be granted. The entry is
// webview data, so it is never granted on its own say-so: a folder the user did
// not choose (in the picker, from Finder, or recorded from those) and that the
// static scope cannot read goes back through the picker, opened AT that folder.
describe("workspace.openRecent asks Rust for access first (WI-LX1.1)", () => {
  const refused = { code: "permission-denied", message: "not granted" };
  const commandsCalled = () => mockInvoke.mock.calls.map((call) => call[0]);

  it("asks for access before probing the folder", async () => {
    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockInvoke).toHaveBeenCalledWith("allow_workspace_access", { path: "/repo" });
    expect(mockInvoke.mock.invocationCallOrder[0]).toBeLessThan(
      mockExists.mock.invocationCallOrder[0],
    );
  });

  it("offers removal without probing when Rust says the folder is gone", async () => {
    mockInvoke.mockRejectedValueOnce({ code: "not-found", message: "gone" });
    mockAsk.mockResolvedValue(true);

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(useRecentWorkspacesStore.getState().workspaces).toEqual([]);
    expect(mockExists).not.toHaveBeenCalled();
    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
  });

  it("opens a folder the static scope already reads, with no picker", async () => {
    mockInvoke.mockRejectedValueOnce(refused);
    mockExists.mockResolvedValue(true);

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(commandsCalled()).not.toContain("pick_workspace_folder");
    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/repo", { windowLabel: "main" });
  });

  it("sends an unreadable, unchosen folder through the picker and opens the pick", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "allow_workspace_access") throw refused;
      if (cmd === "pick_workspace_folder") return "/private/opt/repo";
      return undefined;
    });
    mockExists.mockRejectedValueOnce(new Error("forbidden path: /opt/repo"));

    await executeCommand("workspace.openRecent", "/opt/repo", { windowLabel: "main" });

    expect(mockInvoke).toHaveBeenCalledWith("pick_workspace_folder", { defaultPath: "/opt/repo" });
    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/private/opt/repo", {
      windowLabel: "main",
    });
  });

  it.each([
    ["the user cancels the picker", async () => null],
    ["a picker is already open", async () => { throw { code: "conflict", message: "busy" }; }],
  ])("opens nothing and offers no removal when %s", async (_label, pick) => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "allow_workspace_access") throw refused;
      if (cmd === "pick_workspace_folder") return pick();
      return undefined;
    });
    mockExists.mockRejectedValue(new Error("forbidden path: /opt/repo"));

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
    expect(mockAsk).not.toHaveBeenCalled();
    expect(useRecentWorkspacesStore.getState().workspaces).toEqual([{ path: "/repo" }]);
  });

  it("hands the picked folder, not the stale entry, to a new window when tabs are dirty", async () => {
    useTabStore.setState({
      tabs: { main: [{ id: "t1", filePath: "/x.md" }] },
      activeTabId: { main: "t1" },
      getTabsByWindow: () => [{ id: "t1", filePath: "/x.md" }],
    } as never);
    useDocumentStore.setState({
      documents: { t1: { isDirty: true } },
      getDocument: () => ({ isDirty: true }),
    } as never);
    mockAsk.mockResolvedValue(true);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "allow_workspace_access") throw refused;
      if (cmd === "pick_workspace_folder") return "/private/opt/repo";
      return undefined;
    });
    mockExists.mockRejectedValueOnce(new Error("forbidden path: /opt/repo"));

    await executeCommand("workspace.openRecent", "/opt/repo", { windowLabel: "main" });

    expect(mockInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", {
      workspaceRoot: "/private/opt/repo",
      filePath: null,
    });
  });
});

// Audit F2 — what Rust answers is what opens, and a failure the user did not
// cause is reported to them rather than read as "cancelled" or "present".
describe("workspace.openRecent acts on Rust's answer, and reports failures", () => {
  const refused = { code: "permission-denied", message: "not granted" };

  function rustAnswers(access: () => Promise<unknown>, pick?: () => Promise<unknown>): void {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "allow_workspace_access") return access();
      if (cmd === "pick_workspace_folder" && pick) return pick();
      return undefined;
    });
  }

  // Audit F2 #145 — one question to Rust per open, not one here and another
  // inside the shared transition.
  it("asks Rust for access exactly once per open", async () => {
    rustAnswers(async () => "/repo");

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    const asks = mockInvoke.mock.calls.filter(([cmd]) => cmd === "allow_workspace_access");
    expect(asks).toHaveLength(1);
    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalled();
  });

  // #250: Rust judged the folder the entry RESOLVES to, and granted that. The
  // canonical root is what opens — never the name it was asked about.
  it("opens the canonical root Rust granted, not the entry's spelling", async () => {
    rustAnswers(async () => "/private/repo");

    await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

    expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/private/repo", {
      windowLabel: "main",
    });
  });

  describe("when the access check cannot run", () => {
    beforeEach(() => rustAnswers(async () => { throw new Error("ipc down"); }));

    it("opens a folder the static scope still reads", async () => {
      mockExists.mockResolvedValue(true);

      await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

      expect(mockOpenWorkspaceWithConfig).toHaveBeenCalledWith("/repo", { windowLabel: "main" });
      expect(mockToastError).not.toHaveBeenCalled();
    });

    it("offers removal for a folder the probe finds gone", async () => {
      mockExists.mockResolvedValue(false);
      mockAsk.mockResolvedValue(true);

      await executeCommand("workspace.openRecent", "/repo", { windowLabel: "main" });

      expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
      expect(useRecentWorkspacesStore.getState().workspaces).toEqual([]);
    });

    it.each([
      ["outside every scope", "forbidden path: /opt/repo"],
      ["unreadable for another reason", new Error("probe failed")],
    ])("stops and says so for a folder %s — never installs an unreadable workspace", async (_l, probeError) => {
      mockExists.mockRejectedValue(probeError);

      await executeCommand("workspace.openRecent", "/opt/repo", { windowLabel: "main" });

      expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
      expect(mockAsk).not.toHaveBeenCalled();
      expect(mockToastError).toHaveBeenCalledTimes(1);
      expect(useRecentWorkspacesStore.getState().workspaces).toEqual([{ path: "/repo" }]);
    });
  });

  it.each([
    ["another folder dialog is open", { code: "conflict", message: "A folder dialog is already open" }],
    ["the picker call fails", new Error("ipc down")],
  ])("tells the user when %s instead of doing nothing", async (_l, failure) => {
    rustAnswers(async () => { throw refused; }, async () => { throw failure; });
    mockExists.mockRejectedValue(new Error("forbidden path: /opt/repo"));

    await executeCommand("workspace.openRecent", "/opt/repo", { windowLabel: "main" });

    expect(mockOpenWorkspaceWithConfig).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the user cancels the picker", async () => {
    rustAnswers(async () => { throw refused; }, async () => null);
    mockExists.mockRejectedValue(new Error("forbidden path: /opt/repo"));

    await executeCommand("workspace.openRecent", "/opt/repo", { windowLabel: "main" });

    expect(mockToastError).not.toHaveBeenCalled();
  });
});
