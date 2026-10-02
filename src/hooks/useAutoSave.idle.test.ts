// WI-RA10B.7 — an idle auto-save tick does not serialize the WYSIWYG document;
// a tick after an edit does, and dirty documents are saved either way.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: vi.fn(() => "main") }));
vi.mock("@/stores/documentStore", () => ({ useDocumentStore: { getState: vi.fn() } }));
vi.mock("@/stores/tabStore", () => ({ useTabStore: { getState: vi.fn() } }));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ general: { autoSaveEnabled: true, autoSaveInterval: 1 } }),
}));
vi.mock("@/services/persistence/saveToPath", () => ({ saveToPath: vi.fn() }));
vi.mock("@/utils/reentryGuard", () => ({ isOperationInProgress: vi.fn(() => false) }));
vi.mock("@/utils/debug", () => ({ autoSaveLog: vi.fn(), saveError: vi.fn() }));

import { useAutoSave } from "./useAutoSave";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { saveToPath } from "@/services/persistence/saveToPath";
// The real registries: the flusher below stands in for the editor's serialize.
import { registerActiveWysiwygFlusher } from "@/utils/wysiwygFlush";
import { setWysiwygEditPending } from "@/utils/wysiwygEditPending";

const editor = {};
const document = { isDirty: false, filePath: "/tmp/doc.md", content: "Hello", isMissing: false };
/** The editor's flush: serializes, writes the edit to the store, clears its flag. */
const serialize = vi.fn(() => {
  document.isDirty = true;
  document.content = "Hello, edited";
  setWysiwygEditPending(editor, false);
});

const tick = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.assign(document, { isDirty: false, content: "Hello" });
  setWysiwygEditPending(editor, false);
  registerActiveWysiwygFlusher(serialize);
  vi.mocked(useTabStore.getState).mockReturnValue({
    tabs: { main: [{ id: "tab-1" }] },
  } as unknown as ReturnType<typeof useTabStore.getState>);
  vi.mocked(useDocumentStore.getState).mockReturnValue({
    getDocument: () => document,
  } as unknown as ReturnType<typeof useDocumentStore.getState>);
  vi.mocked(saveToPath).mockResolvedValue(true);
});

afterEach(() => {
  registerActiveWysiwygFlusher(null);
  vi.useRealTimers();
});

describe("useAutoSave — idle ticks", () => {
  it("does not serialize the document while nothing has been typed", async () => {
    renderHook(() => useAutoSave());
    for (let i = 0; i < 5; i += 1) await tick();

    expect(serialize).not.toHaveBeenCalled();
    expect(saveToPath).not.toHaveBeenCalled();
  });

  it("serializes and saves on the tick after an edit, then goes idle again", async () => {
    renderHook(() => useAutoSave());
    await tick();
    expect(serialize).not.toHaveBeenCalled();

    setWysiwygEditPending(editor, true);
    await tick();
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(saveToPath).toHaveBeenCalledWith("tab-1", "/tmp/doc.md", "Hello, edited", "auto");

    document.isDirty = false;
    for (let i = 0; i < 8; i += 1) await tick();
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(saveToPath).toHaveBeenCalledTimes(1);
  });

  it("still saves a document that is already dirty when no edit is pending", async () => {
    // Dirt that reached the store by another route: Source mode, or an edit the
    // editor's own debounce already flushed.
    document.isDirty = true;
    renderHook(() => useAutoSave());
    await tick();

    expect(serialize).not.toHaveBeenCalled();
    expect(saveToPath).toHaveBeenCalledWith("tab-1", "/tmp/doc.md", "Hello", "auto");
  });
});
