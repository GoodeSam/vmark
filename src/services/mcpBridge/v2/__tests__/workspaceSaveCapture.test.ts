// @vitest-environment node
// vmark.workspace.save → coherence capture seam (WI-1.6, WI-LX1.4). The
// capture itself is pinned in services/coherence; this file pins that the
// handler hands a SUCCESSFUL write to `captureMcpWrite` with the exact bytes
// written, and never hands it a write that was refused or failed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

const writeMock = vi.fn<(path: string, content: string) => Promise<void>>(async () => undefined);
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: (path: string, content: string) => writeMock(path, content),
}));

vi.mock("@/utils/pendingSaves", () => ({
  registerPendingSave: () => 1,
  clearPendingSave: () => undefined,
  clearPendingSaveAfterGrace: () => undefined,
}));

const checkBridgePathMock = vi.fn<(p: string) => Promise<{ allowed: boolean; reason?: string }>>(
  async () => ({ allowed: true })
);
vi.mock("@/services/mcpBridge/bridgePathGuard", () => ({
  checkBridgePath: (p: string) => checkBridgePathMock(p),
}));

const captureMcpWriteMock = vi.fn(async (_args: unknown) => null);
vi.mock("@/services/coherence/mcpCapture", () => ({
  captureMcpWrite: (args: unknown) => captureMcpWriteMock(args),
}));

import { respond } from "@/services/mcpBridge/utils";
import { handleWorkspaceSave } from "@/services/mcpBridge/v2/workspaceSave";

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

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentStore.setState({ documents: {} });
  checkBridgePathMock.mockResolvedValue({ allowed: true });
  writeMock.mockResolvedValue(undefined);
});

describe("workspace.save hands successful writes to coherence capture", () => {
  it("captures the exact content written, tagged with the tool name", async () => {
    seedTab("t1", "/ws/story/ch1.md", "saved");
    useDocumentStore.getState().setEditorContent("t1", "edited body");

    await handleWorkspaceSave("req-1", {});

    expect(lastRespond().success).toBe(true);
    expect(writeMock).toHaveBeenCalledWith("/ws/story/ch1.md", "edited body");
    expect(captureMcpWriteMock).toHaveBeenCalledTimes(1);
    expect(captureMcpWriteMock).toHaveBeenCalledWith({
      absolutePath: "/ws/story/ch1.md",
      content: "edited body",
      toolName: "workspace.save",
    });
  });

  it("a rejected capture never fails the save", async () => {
    seedTab("t2", "/ws/story/ch2.md", "x");
    captureMcpWriteMock.mockRejectedValueOnce(new Error("kernel down"));

    await handleWorkspaceSave("req-2", {});

    expect(lastRespond().success).toBe(true);
  });

  it("does not capture when the disk write fails", async () => {
    seedTab("t3", "/ws/story/ch3.md", "x");
    writeMock.mockRejectedValueOnce(new Error("EACCES"));

    await handleWorkspaceSave("req-3", {});

    expect(lastRespond().success).toBe(false);
    expect(captureMcpWriteMock).not.toHaveBeenCalled();
  });

  it("does not capture when the path guard refuses the write", async () => {
    seedTab("t4", "/ws/story/ch4.md", "x");
    checkBridgePathMock.mockResolvedValueOnce({ allowed: false, reason: "outside roots" });

    await handleWorkspaceSave("req-4", {});

    expect(lastRespond().success).toBe(false);
    expect(writeMock).not.toHaveBeenCalled();
    expect(captureMcpWriteMock).not.toHaveBeenCalled();
  });

  it("does not capture an untitled tab (nothing is written)", async () => {
    seedTab("t5", null, "draft");

    await handleWorkspaceSave("req-5", {});

    expect(lastRespond().success).toBe(false);
    expect(captureMcpWriteMock).not.toHaveBeenCalled();
  });
});
