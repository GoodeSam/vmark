// WI-TP1.1: opaque identities separate sessions and reset on shell restart.
import { beforeEach, describe, it, expect, vi } from "vitest";
import { prepareTranscriptBinding, transcriptToken, forgetTranscriptBinding } from "./transcriptBinding";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), tokens: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
const forgotten = () => mocks.invoke.mock.calls.filter(([command]) => command === "terminal_transcript_forget").map(([, args]) => (args as { token: string }).token);
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) => Promise.resolve(command === "terminal_transcript_prepare" ? mocks.tokens.shift() : undefined));
});
describe("transcriptBinding", () => {
  it("keeps shells isolated and drops closed bindings on disk too", async () => {
    mocks.tokens = ["first", "second", "restart"];
    await prepareTranscriptBinding("a"); await prepareTranscriptBinding("b");
    expect(transcriptToken("a")).toBe("first");
    expect(transcriptToken("b")).toBe("second");
    await prepareTranscriptBinding("a");
    expect(transcriptToken("a")).toBe("restart");
    expect(forgotten()).toEqual(["first"]);
    forgetTranscriptBinding("a"); forgetTranscriptBinding("b");
    expect(transcriptToken("a")).toBeUndefined();
    expect(forgotten()).toEqual(["first", "restart", "second"]);
  });
  it("does not register a shell that was closed during preparation", async () => {
    let resolve: (value: string) => void = () => {};
    mocks.invoke.mockImplementationOnce(() => new Promise<string>(r => { resolve = r; }));
    const preparing = prepareTranscriptBinding("closed");
    forgetTranscriptBinding("closed");
    resolve("late-token");
    // The stale shell must not receive a token whose binding was just released.
    await expect(preparing).rejects.toThrow("superseded");
    expect(transcriptToken("closed")).toBeUndefined();
    expect(forgotten()).toEqual(["late-token"]);
  });
  it("logs rather than throws when cleanup fails", async () => {
    mocks.tokens = ["gone"];
    await prepareTranscriptBinding("x");
    mocks.invoke.mockRejectedValueOnce(new Error("io"));
    expect(() => forgetTranscriptBinding("x")).not.toThrow();
    await Promise.resolve();
  });
});
