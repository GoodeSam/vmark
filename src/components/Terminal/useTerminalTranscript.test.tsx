// WI-TP1.2: polling is disabled when hidden; late reads cannot cross sessions.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalTranscript } from "./useTerminalTranscript";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), log: vi.fn() }));
vi.mock("@/utils/debug", () => ({ terminalLog: mocks.log }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/terminal/transcriptBinding", () => ({ transcriptToken: (id: string) => id }));
beforeEach(() => { vi.useFakeTimers(); mocks.invoke.mockReset(); mocks.log.mockClear(); });
afterEach(() => vi.useRealTimers());
describe("useTerminalTranscript", () => {
  it("does no IO when disabled", () => {
    mocks.invoke.mockClear();
    renderHook(() => useTerminalTranscript("a", false));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("drops late responses when the session changes", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    mocks.invoke.mockImplementation((command: string, args?: { token?: string }) => {
      if (command === "terminal_transcript_configure") return Promise.resolve();
      if (args?.token === "a") return new Promise(resolve => { resolveFirst = resolve; });
      return Promise.resolve({ revision: "b", data: JSON.stringify({ type: "assistant", uuid: "b", message: { role: "assistant", content: [{ type: "text", text: "second" }] } }) + "\n" });
    });
    const { result, rerender, unmount } = renderHook(({ id }) => useTerminalTranscript(id, true), { initialProps: { id: "a" } });
    expect(mocks.invoke).toHaveBeenCalledWith("terminal_transcript_read", expect.objectContaining({ token: "a" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    rerender({ id: "b" });
    await act(async () => {});
    expect(result.current.messages[0]?.text).toBe("second");
    await act(async () => { resolveFirst({ revision: "a", data: "stale\n" }); });
    expect(result.current.messages[0]?.text).toBe("second");
    unmount();
  });
  it("logs a persistent read failure once, not on every poll", async () => {
    mocks.invoke.mockRejectedValue(new Error("denied"));
    const { result, unmount } = renderHook(() => useTerminalTranscript("a", true));
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(mocks.invoke.mock.calls.length).toBeGreaterThan(2);
    expect(result.current.failed).toBe(true);
    expect(mocks.log).toHaveBeenCalledTimes(1);
    unmount();
  });
  it("reports loaded only once a snapshot for the current binding has arrived", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.invoke.mockImplementation(() => new Promise(r => { resolve = r; }));
    const { result, unmount } = renderHook(() => useTerminalTranscript("a", true));
    expect(result.current.loaded).toBe(false);
    await act(async () => { resolve(null); });
    expect(result.current.loaded).toBe(true);
    expect(result.current.messages).toEqual([]);
    unmount();
  });
});
