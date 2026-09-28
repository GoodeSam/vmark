// @vitest-environment node
// vmark.workspace.save_as → coherence capture (WI-1.6, WI-LX1.4, audit #152).
// Save As was the one MCP write path that never reached the capture funnel, so
// it recorded no provenance and ignored the capture-on-save setting entirely.
//
// Only the Tauri boundary is mocked: the REAL `captureMcpWrite` →
// `captureWrite` → `currentCapturePolicy` chain runs, so these tests pin the
// policy that reaches the kernel. What the kernel then does with
// `tracked-only` in a workspace with no ledger (create nothing, stamp nothing)
// is pinned on the Rust side by
// `tracked_only_disk_write_in_a_fresh_workspace_creates_nothing`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

const writeMock = vi.fn<(path: string, content: string) => Promise<void>>(async () => undefined);
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: (path: string, content: string) => writeMock(path, content),
  exists: async () => false,
}));

const registerPendingSaveMock = vi.fn((_path: string, _content: string) => 1);
vi.mock("@/utils/pendingSaves", () => ({
  registerPendingSave: (path: string, content: string) => registerPendingSaveMock(path, content),
  clearPendingSave: () => undefined,
}));

const checkBridgePathMock = vi.fn<(p: string) => Promise<{ allowed: boolean; reason?: string }>>(
  async () => ({ allowed: true })
);
vi.mock("@/services/mcpBridge/bridgePathGuard", () => ({
  checkBridgePath: (p: string) => checkBridgePathMock(p),
}));

vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { warning: vi.fn(), info: vi.fn() },
}));

type Receipt = {
  object: string;
  revision: string;
  entry_id: string | null;
  content_with_identity: string | null;
} | null;
const kernelReceipt = vi.fn<() => Receipt>(() => null);
const invokeMock = vi.fn(async (cmd: string, _args?: Record<string, unknown>) =>
  cmd === "coherence_capture" ? kernelReceipt() : null
);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

import { respond } from "@/services/mcpBridge/utils";
import { handleWorkspaceSaveAs } from "@/services/mcpBridge/v2/workspaceSaveAs";

interface CaptureCall {
  workspaceRoot: string;
  policy: string;
  request: { path: string; content: string; confidence: string; intent: { summary: string } };
}

function captureCalls(): CaptureCall[] {
  return invokeMock.mock.calls
    .filter((c) => c[0] === "coherence_capture")
    .map((c) => c[1] as unknown as CaptureCall);
}

function lastRespond() {
  const calls = vi.mocked(respond).mock.calls;
  return calls[calls.length - 1][0];
}

function seedTab(id: string, filePath: string | null, content: string) {
  useTabStore.setState({
    tabs: {
      main: [{ kind: "document", id, filePath, title: "t", isPinned: false, formatId: "markdown" }],
    },
    activeTabId: { main: id },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(id, content, filePath);
}

function setCaptureOnSave(on: boolean) {
  const s = useSettingsStore.getState();
  useSettingsStore.setState({ general: { ...s.general, coherenceCaptureOnSave: on } });
}

beforeEach(() => {
  vi.clearAllMocks();
  kernelReceipt.mockReturnValue(null);
  useDocumentStore.setState({ documents: {} });
  useWorkspaceStore.setState({ rootPath: "/ws" });
  const s = useSettingsStore.getState();
  useSettingsStore.setState({
    advanced: { ...s.advanced, mcpServer: { ...s.advanced.mcpServer, autoApproveEdits: true } },
  });
});

describe("workspace.save_as follows the capture-on-save policy (#152)", () => {
  it("records the new file when capture-on-save is ON", async () => {
    setCaptureOnSave(true);
    const stamped = "---\nvmark:\n  id: x\n---\nbody";
    kernelReceipt.mockReturnValue({
      object: "o",
      revision: "r",
      entry_id: "e",
      content_with_identity: stamped,
    });
    seedTab("t1", null, "body");

    await handleWorkspaceSaveAs("req-1", { filePath: "/ws/story/new.md" });

    expect(lastRespond().success).toBe(true);
    await vi.waitFor(() => expect(captureCalls()).toHaveLength(1));
    expect(captureCalls()[0]).toMatchObject({
      workspaceRoot: "/ws",
      policy: "adopt",
      request: {
        path: "story/new.md",
        content: "body",
        confidence: "inferred",
        intent: { summary: "workspace.save_as" },
      },
    });
    // The kernel's identity rewrite is announced to the watcher.
    await vi.waitFor(() =>
      expect(registerPendingSaveMock).toHaveBeenCalledWith("/ws/story/new.md", stamped)
    );
  });

  it("with capture-on-save OFF and no ledger, the write is left alone", async () => {
    setCaptureOnSave(false);
    kernelReceipt.mockReturnValue(null); // the kernel declines: no ledger to follow
    seedTab("t2", null, "draft");

    await handleWorkspaceSaveAs("req-2", { filePath: "/ws/draft.md" });

    expect(lastRespond().success).toBe(true);
    await vi.waitFor(() => expect(captureCalls()).toHaveLength(1));
    expect(captureCalls()[0].policy).toBe("tracked-only");
    // Exactly the save itself hit the disk, and no identity rewrite was announced.
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith("/ws/draft.md", "draft");
    expect(registerPendingSaveMock).toHaveBeenCalledTimes(1);
    expect(registerPendingSaveMock).toHaveBeenCalledWith("/ws/draft.md", "draft");
  });

  it("a failed capture never fails the save", async () => {
    invokeMock.mockRejectedValueOnce(new Error("kernel down"));
    seedTab("t3", null, "x");

    await handleWorkspaceSaveAs("req-3", { filePath: "/ws/x.md" });

    expect(lastRespond().success).toBe(true);
  });

  it("does not capture when the disk write fails", async () => {
    writeMock.mockRejectedValueOnce(new Error("EACCES"));
    seedTab("t4", null, "x");

    await handleWorkspaceSaveAs("req-4", { filePath: "/ws/y.md" });

    expect(lastRespond().success).toBe(false);
    expect(captureCalls()).toHaveLength(0);
  });

  it("does not capture when the path guard refuses", async () => {
    checkBridgePathMock.mockResolvedValueOnce({ allowed: false, reason: "outside roots" });
    seedTab("t5", null, "x");

    await handleWorkspaceSaveAs("req-5", { filePath: "/elsewhere/z.md" });

    expect(lastRespond().success).toBe(false);
    expect(writeMock).not.toHaveBeenCalled();
    expect(captureCalls()).toHaveLength(0);
  });
});
