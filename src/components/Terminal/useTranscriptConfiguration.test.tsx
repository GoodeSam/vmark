// WI-TP1.2: persisted toggle configures hooks; late configuration cannot resurrect state.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTranscriptConfiguration } from "./useTranscriptConfiguration";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
describe("useTranscriptConfiguration", () => {
  it("is pending until configuration succeeds, then ready", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTranscriptConfiguration(true));
    expect(result.current).toBe("pending");
    await act(async () => {});
    expect(result.current).toBe("ready");
    expect(mocks.invoke).toHaveBeenCalledWith("terminal_transcript_configure", { enabled: true });
  });
  it("ignores late configuration after disabling and exposes failure", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.invoke.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValueOnce(undefined);
    const { result, rerender } = renderHook(({ enabled }) => useTranscriptConfiguration(enabled), { initialProps: { enabled: true } });
    rerender({ enabled: false });
    await act(async () => { resolve(undefined); });
    mocks.invoke.mockRejectedValueOnce(new Error("permissions"));
    rerender({ enabled: true });
    expect(result.current).toBe("pending");
    await act(async () => {});
    expect(result.current).toBe("failed");
  });
});
