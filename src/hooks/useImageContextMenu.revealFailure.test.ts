// WI-RA20.3 — a failed "reveal image" names the platform's file manager; it
// said "Failed to reveal image in Finder." on every platform. Tauri is the
// mocked boundary; the image-menu store and path resolution run real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { message } from "@tauri-apps/plugin-dialog";

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(() => Promise.reject(new Error("no such file"))),
}));

vi.mock("@tauri-apps/api/path", () => ({
  dirname: vi.fn((p: string) => Promise.resolve(p.split("/").slice(0, -1).join("/") || "/")),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));

vi.mock("@/hooks/useDocumentState", () => ({
  useDocumentFilePath: vi.fn(() => "/docs/test.md"),
}));

import { useImageContextMenu } from "./useImageContextMenu";
import { useImageContextMenuStore } from "@/stores/imageContextMenuStore";

// The app tier defaults to macOS (src/test/platformDefault.ts); override per case.
function onPlatform(platform: string) {
  Object.defineProperty(navigator, "platform", { value: platform, configurable: true, writable: true });
}

const view = { state: { doc: { nodeAt: () => null } }, dispatch: () => undefined };

beforeEach(() => {
  vi.mocked(message).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  useImageContextMenuStore.setState({
    isOpen: true,
    position: { x: 100, y: 100 },
    imageSrc: "assets/photo.png",
    imageNodePos: 5,
  });
});

afterEach(() => {
  onPlatform("MacIntel");
  vi.restoreAllMocks();
});

describe("image context menu reveal failure", () => {
  it.each([
    ["MacIntel", "Finder"],
    ["Win32", "Explorer"],
    ["Linux x86_64", "file manager"],
  ])("on %s names %s", async (platform, manager) => {
    onPlatform(platform);
    const { result } = renderHook(() => useImageContextMenu(() => view as never));
    await act(async () => {
      await result.current("revealInFinder");
    });

    const errorCall = vi.mocked(message).mock.calls.find(([, options]) =>
      typeof options === "object" && options !== null && "kind" in options && options.kind === "error");
    expect(errorCall).toBeDefined();
    expect(String(errorCall?.[0])).toContain(manager);
    if (manager !== "Finder") expect(String(errorCall?.[0])).not.toContain("Finder");
  });
});
