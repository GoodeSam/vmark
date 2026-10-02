// @vitest-environment node
// WI-RA1B.1 — Save All and Quit saves OPEN TABS, never bare documents: a
// document with no live tab is not written. Driven over the real composition
// (real stores, real save pipeline) with `@tauri-apps/*` behind the stateful fs
// fake, so every claim is about bytes on disk and whether the app quit.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.fsModule();
});
vi.mock("@tauri-apps/api/core", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.coreModule();
});
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  open: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  confirm: vi.fn(),
}));
// sonner is the external boundary; the IME-safe wrapper runs real.
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { handleSaveAllQuit } from "@/services/files/fileSave";
import { statefulFs } from "@/test/statefulFsFake";
import {
  WINDOW,
  ROOT,
  resetTier0,
  openDocInTab,
  newUntitledTab,
  editDoc,
  doc,
} from "@/test/tier0/harness";

const DOC = `${ROOT}/笔记.md`;
const OTHER = `${ROOT}/other.md`;
const ORIGINAL = "# 标题\n\n磁盘上的内容。\n";
const EDITED = "# 标题\n\n改过的内容。\n";

let quits = 0;

beforeEach(() => {
  resetTier0();
  quits = 0;
  statefulFs.stubCommand("force_quit", () => {
    quits += 1;
  });
  vi.mocked(saveDialog).mockReset();
  vi.mocked(openDialog).mockReset();
  vi.mocked(toast.error).mockClear();
});

describe("Save All and Quit — what gets saved", () => {
  it("does not write a document that has no tab", async () => {
    statefulFs.seed(DOC, ORIGINAL);
    // A document left behind by a removal that forgot it: dirty, pathed, tabless.
    useDocumentStore.getState().initDocument("ghost", ORIGINAL, DOC);
    useDocumentStore.getState().setEditorContent("ghost", "discarded, must never reach disk\n");

    await handleSaveAllQuit(WINDOW);

    expect(statefulFs.read(DOC)).toBe(ORIGINAL);
    expect(statefulFs.writesTo(DOC)).toEqual([]);
    expect(quits).toBe(1);
  });

  it("writes every dirty tab's bytes, leaves clean tabs alone, then quits", async () => {
    const dirty = await openDocInTab(DOC, ORIGINAL);
    await openDocInTab(OTHER, "untouched\n");
    editDoc(dirty, EDITED);

    await handleSaveAllQuit(WINDOW);

    expect(statefulFs.read(DOC)).toBe(EDITED);
    expect(statefulFs.writesTo(OTHER)).toEqual([]);
    expect(doc(dirty).isDirty).toBe(false);
    expect(quits).toBe(1);
  });

  it("saves dirty tabs of every window held in the tab store", async () => {
    const here = await openDocInTab(DOC, ORIGINAL);
    editDoc(here, EDITED);
    statefulFs.seed(OTHER, "old\n");
    const there = useTabStore.getState().createTab("doc-1", OTHER);
    useDocumentStore.getState().initDocument(there, "old\n", OTHER);
    useDocumentStore.getState().setEditorContent(there, "new\n");

    await handleSaveAllQuit(WINDOW);

    expect(statefulFs.read(DOC)).toBe(EDITED);
    expect(statefulFs.read(OTHER)).toBe("new\n");
    expect(quits).toBe(1);
  });

  it("quits at once when no open tab needs saving", async () => {
    await openDocInTab(DOC, ORIGINAL);

    await handleSaveAllQuit(WINDOW);

    expect(statefulFs.writesTo(DOC)).toEqual([]);
    expect(quits).toBe(1);
  });

  it("quits at once with no tabs at all", async () => {
    await handleSaveAllQuit(WINDOW);

    expect(statefulFs.writes).toEqual([]);
    expect(quits).toBe(1);
  });

  it("saves a divergent document the user chose to keep, instead of quitting over it", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    // An external writer changed the file; the user kept the local buffer.
    statefulFs.externalWrite(DOC, "# 外部修改\n");
    useDocumentStore.getState().markDivergent(tabId);
    expect(doc(tabId).isDirty).toBe(false);

    await handleSaveAllQuit(WINDOW);

    expect(statefulFs.read(DOC)).toBe(ORIGINAL);
    expect(doc(tabId).isDivergent).toBe(false);
    expect(quits).toBe(1);
  });
});

describe("Save All and Quit — untitled tabs and refusals", () => {
  it("an untitled dirty tab lands at the path the dialog returned, then the app quits", async () => {
    const tabId = newUntitledTab();
    editDoc(tabId, "初稿\n");
    const target = `${ROOT}/初稿.md`;
    vi.mocked(saveDialog).mockResolvedValue(target);

    await handleSaveAllQuit(WINDOW);

    expect(statefulFs.read(target)).toBe("初稿\n");
    expect(doc(tabId).filePath).toBe(target);
    expect(quits).toBe(1);
  });

  it("cancelling the Save As dialog keeps the app open and the draft dirty", async () => {
    const tabId = newUntitledTab();
    editDoc(tabId, "初稿\n");
    vi.mocked(saveDialog).mockResolvedValue(null);

    await handleSaveAllQuit(WINDOW);

    expect(quits).toBe(0);
    expect(statefulFs.writes).toEqual([]);
    expect(doc(tabId).isDirty).toBe(true);
  });

  it("a failed write keeps the app open", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    editDoc(tabId, EDITED);
    statefulFs.failWrites(new Error("disk full"));

    await handleSaveAllQuit(WINDOW);

    expect(quits).toBe(0);
    expect(statefulFs.read(DOC)).toBe(ORIGINAL);
    expect(doc(tabId).isDirty).toBe(true);
  });

  it("a failure while reserving batch destinations is reported and keeps the app open", async () => {
    editDoc(newUntitledTab(), "一\n");
    editDoc(newUntitledTab(), "二\n");
    vi.mocked(openDialog).mockResolvedValue(ROOT);
    statefulFs.stubCommand("create_file_exclusive", () => {
      throw new Error("permission denied");
    });

    await handleSaveAllQuit(WINDOW);

    expect(quits).toBe(0);
    expect(toast.error).toHaveBeenCalledWith("Failed to save documents");
  });

  it("a second invocation while the first is saving does not save or quit twice", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    editDoc(tabId, EDITED);

    await Promise.all([handleSaveAllQuit(WINDOW), handleSaveAllQuit(WINDOW)]);

    expect(statefulFs.writesTo(DOC)).toHaveLength(1);
    expect(quits).toBe(1);
  });
});
