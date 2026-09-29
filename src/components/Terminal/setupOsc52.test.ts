// WI-3.5 — OSC 52 clipboard, WRITE-ONLY (T13 / D5).
//
// The security assertion comes first on purpose: OSC 52 *read* is a clipboard
// exfiltration channel available to anything that can print bytes to the
// terminal — including `cat`-ing a hostile file over ssh. iTerm2 and VS Code
// both deny it by default; so does VMark, and that denial is a tested
// behavior rather than a comment.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockWriteText, mockReadText, mockLog } = vi.hoisted(() => ({
  mockWriteText: vi.fn(() => Promise.resolve()),
  mockReadText: vi.fn(() => Promise.resolve("secret-from-host-clipboard")),
  mockLog: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: mockWriteText,
  readText: mockReadText,
}));

vi.mock("@/utils/debug", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  terminalLog: mockLog,
  clipboardWarn: mockLog,
}));

import { createVMarkClipboardProvider, setupOsc52, OSC52_WRITE_TIMEOUT_MS } from "./setupOsc52";
import { createRealTerminal, bufferText } from "./realXterm.testUtils";
import type { Terminal } from "@xterm/xterm";

/** Minimal Terminal double that records loaded addons. */
function makeTerm() {
  const loaded: unknown[] = [];
  const term = {
    loadAddon: vi.fn((a: unknown) => loaded.push(a)),
  } as unknown as Terminal;
  return { term, loaded };
}

describe("createVMarkClipboardProvider — read is denied (D5)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("read is denied: resolves to the empty string", async () => {
    const provider = createVMarkClipboardProvider();
    await expect(provider.readText("c" as never)).resolves.toBe("");
  });

  it("read is denied: never touches the host clipboard plugin", async () => {
    const provider = createVMarkClipboardProvider();
    await provider.readText("c" as never);
    await provider.readText("p" as never);
    expect(mockReadText).not.toHaveBeenCalled();
  });

  it("logs the denied read so an exfiltration attempt is visible", async () => {
    const provider = createVMarkClipboardProvider();
    await provider.readText("c" as never);
    expect(mockLog).toHaveBeenCalled();
    const logged = mockLog.mock.calls.flat().join(" ");
    expect(logged.toLowerCase()).toContain("osc 52");
  });

  it("denies the PRIMARY selection too, not just SYSTEM", async () => {
    const provider = createVMarkClipboardProvider();
    await expect(provider.readText("p" as never)).resolves.toBe("");
  });
});

describe("createVMarkClipboardProvider — write", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes a write through the Tauri clipboard plugin", async () => {
    const provider = createVMarkClipboardProvider();
    await provider.writeText("c" as never, "hi from ssh");
    expect(mockWriteText).toHaveBeenCalledWith("hi from ssh");
  });

  it("swallows a plugin rejection instead of throwing into the data path", async () => {
    mockWriteText.mockRejectedValueOnce(new Error("clipboard busy"));
    const provider = createVMarkClipboardProvider();
    // The addon calls this from inside the terminal parser; a rejection here
    // would surface as an unhandled rejection on every OSC 52 sequence.
    await expect(provider.writeText("c" as never, "x")).resolves.toBeUndefined();
    expect(mockLog).toHaveBeenCalled();
  });

  it("writes an empty payload without special-casing (OSC 52 clear)", async () => {
    const provider = createVMarkClipboardProvider();
    await provider.writeText("c" as never, "");
    expect(mockWriteText).toHaveBeenCalledWith("");
  });

  it("passes multi-line and CJK payloads through unchanged", async () => {
    const provider = createVMarkClipboardProvider();
    await provider.writeText("c" as never, "行1\n行2\t末");
    expect(mockWriteText).toHaveBeenCalledWith("行1\n行2\t末");
  });
});

// The addon hands xterm the write's promise, and xterm parses NOTHING more —
// shell output, a session reset — until it settles. A clipboard IPC that never
// answered froze the terminal for good, and made a restart wait forever (#1471).
describe("setupOsc52 — a clipboard write cannot stall the terminal", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it("the parser moves on once the write's time is up, and the stall is logged", async () => {
    vi.useFakeTimers();
    mockWriteText.mockReturnValueOnce(new Promise<void>(() => {})); // never settles
    const term = createRealTerminal();
    setupOsc52(term, true);
    let parsed = false;
    term.write("\x1b]52;c;aGk=\x07after the clipboard", () => {
      parsed = true;
    });

    await vi.advanceTimersByTimeAsync(OSC52_WRITE_TIMEOUT_MS + 100);

    expect(mockWriteText).toHaveBeenCalledWith("hi");
    expect(parsed).toBe(true);
    expect(bufferText(term)).toContain("after the clipboard");
    expect(mockLog.mock.calls.flat().join(" ")).toMatch(/timed out/i);
    term.dispose();
  });

  it("a write that settles in time holds the parser only that long", async () => {
    vi.useFakeTimers();
    const term = createRealTerminal();
    setupOsc52(term, true);
    let parsed = false;
    term.write("\x1b]52;c;aGk=\x07after", () => {
      parsed = true;
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(parsed).toBe(true);
    expect(mockLog).not.toHaveBeenCalled();
    term.dispose();
  });
});

describe("setupOsc52", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the addon when the setting is on", () => {
    const { term, loaded } = makeTerm();
    const cleanup = setupOsc52(term, true);
    expect(loaded).toHaveLength(1);
    expect(typeof cleanup).toBe("function");
  });

  it("loads nothing when the setting is off", () => {
    const { term, loaded } = makeTerm();
    const cleanup = setupOsc52(term, false);
    expect(term.loadAddon).not.toHaveBeenCalled();
    expect(loaded).toHaveLength(0);
    // Cleanup must still be callable so the caller needs no branch.
    expect(() => cleanup()).not.toThrow();
  });

  it("disposes the addon on cleanup", () => {
    const { term, loaded } = makeTerm();
    const cleanup = setupOsc52(term, true);
    const addon = loaded[0] as { dispose: () => void };
    const spy = vi.spyOn(addon, "dispose");
    cleanup();
    expect(spy).toHaveBeenCalled();
  });

  it("cleanup is idempotent", () => {
    const { term } = makeTerm();
    const cleanup = setupOsc52(term, true);
    cleanup();
    expect(() => cleanup()).not.toThrow();
  });

  it("survives a throwing loadAddon rather than failing terminal creation", () => {
    const term = {
      loadAddon: vi.fn(() => {
        throw new Error("addon incompatible");
      }),
    } as unknown as Terminal;
    expect(() => setupOsc52(term, true)).not.toThrow();
  });
});
