// WI-TP3.3: one owner for following + open state, shared by the tab-bar toggle and the region.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRenderedTranscript } from "./useRenderedTranscript";
import type { TranscriptMessage } from "@/utils/terminalTranscript";
const mocks = vi.hoisted(() => ({ follow: vi.fn(), view: { messages: [] as TranscriptMessage[], failed: false, loaded: true } }));
vi.mock("./useTerminalTranscript", () => ({ useTerminalTranscript: mocks.follow }));
beforeEach(() => {
  mocks.view = { messages: [], failed: false, loaded: true };
  mocks.follow.mockReset();
  mocks.follow.mockImplementation(() => mocks.view);
});
describe("useRenderedTranscript", () => {
  it("follows only while enabled, visible and configured — collapsed included", () => {
    const { rerender } = renderHook((p: { enabled: boolean; visible: boolean; ready: boolean }) => useRenderedTranscript("s", p.enabled, p.visible, p.ready ? "ready" : "pending"), { initialProps: { enabled: true, visible: true, ready: true } });
    expect(mocks.follow).toHaveBeenLastCalledWith("s", true);
    rerender({ enabled: false, visible: true, ready: true });
    expect(mocks.follow).toHaveBeenLastCalledWith("s", false);
    rerender({ enabled: true, visible: false, ready: true });
    expect(mocks.follow).toHaveBeenLastCalledWith("s", false);
    rerender({ enabled: true, visible: true, ready: false });
    expect(mocks.follow).toHaveBeenLastCalledWith("s", false);
  });
  it("starts collapsed, opens for a new rich reply, and toggles", () => {
    const { result, rerender } = renderHook(() => useRenderedTranscript("s", true, true, "ready"));
    expect(result.current.expanded).toBe(false);
    mocks.view = { messages: [{ id: "1", text: "| A |\n| - |\n| 1 |" }], failed: false, loaded: true };
    rerender();
    expect(result.current.expanded).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
  });
  it("is never expanded while rendering is disabled", () => {
    const { result } = renderHook(() => useRenderedTranscript("s", false, true, "ready"));
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
  });
});
