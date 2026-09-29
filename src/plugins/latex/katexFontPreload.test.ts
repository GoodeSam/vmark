import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  preloadKatexFonts,
  scheduleKatexFontPreload,
  resetKatexFontPreloadForTest,
} from "./katexFontPreload";

interface FakeFace {
  family: string;
  status: FontFaceLoadStatus;
  load: ReturnType<typeof vi.fn>;
}

function face(family: string, status: FontFaceLoadStatus = "unloaded"): FakeFace {
  return { family, status, load: vi.fn(() => Promise.resolve()) };
}

function installFonts(faces: FakeFace[]): void {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { forEach: (cb: (f: FakeFace) => void) => faces.forEach(cb) },
  });
}

beforeEach(() => resetKatexFontPreloadForTest());

afterEach(() => {
  Reflect.deleteProperty(document, "fonts");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("preloadKatexFonts", () => {
  it("loads every unloaded KaTeX face, quoted or not, and nothing else", () => {
    const main = face("KaTeX_Main");
    const quoted = face('"KaTeX_AMS"');
    const other = face("Inter");
    installFonts([main, quoted, other]);

    preloadKatexFonts();

    expect(main.load).toHaveBeenCalledTimes(1);
    expect(quoted.load).toHaveBeenCalledTimes(1);
    expect(other.load).not.toHaveBeenCalled();
  });

  it("skips faces that are already loading or loaded", () => {
    const loading = face("KaTeX_Size1", "loading");
    const loaded = face("KaTeX_Size2", "loaded");
    installFonts([loading, loaded]);

    preloadKatexFonts();

    expect(loading.load).not.toHaveBeenCalled();
    expect(loaded.load).not.toHaveBeenCalled();
  });

  it("does the work once per window", () => {
    const main = face("KaTeX_Main");
    installFonts([main]);
    preloadKatexFonts();
    main.status = "unloaded";
    preloadKatexFonts();
    expect(main.load).toHaveBeenCalledTimes(1);
  });

  it("retries later when no KaTeX face is declared yet", () => {
    installFonts([face("Inter")]);
    preloadKatexFonts();

    const main = face("KaTeX_Main");
    installFonts([main]);
    preloadKatexFonts();
    expect(main.load).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed load", async () => {
    const broken = face("KaTeX_Fraktur");
    broken.load.mockReturnValue(Promise.reject(new Error("offline")));
    installFonts([broken]);
    expect(() => preloadKatexFonts()).not.toThrow();
    await Promise.resolve();
  });

  it("is a no-op without the Font Loading API", () => {
    expect(() => preloadKatexFonts()).not.toThrow();
  });
});

describe("scheduleKatexFontPreload", () => {
  it("waits for an idle callback when the engine has one", () => {
    const main = face("KaTeX_Main");
    installFonts([main]);
    const idle: Array<() => void> = [];
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => idle.push(cb));

    scheduleKatexFontPreload();
    expect(main.load).not.toHaveBeenCalled();
    idle.forEach((cb) => cb());
    expect(main.load).toHaveBeenCalledTimes(1);
  });

  it("falls back to a timeout without requestIdleCallback (WebKit)", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const main = face("KaTeX_Main");
    installFonts([main]);

    scheduleKatexFontPreload();
    expect(main.load).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(main.load).toHaveBeenCalledTimes(1);
  });

  it("schedules nothing once the fonts were requested", () => {
    installFonts([face("KaTeX_Main")]);
    preloadKatexFonts();
    const ric = vi.fn();
    vi.stubGlobal("requestIdleCallback", ric);
    scheduleKatexFontPreload();
    expect(ric).not.toHaveBeenCalled();
  });
});
