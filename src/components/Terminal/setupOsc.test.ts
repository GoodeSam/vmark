// @vitest-environment node
// WI-2.1 — OSC 7 cwd parsing + handler registration
// WI-3.2 — OSC 133 command-boundary tracking
import { describe, it, expect, vi } from "vitest";
import { queryObjects } from "node:v8";
import { parseOsc7Cwd, setupOsc7, setupOsc133, scrollToAdjacentCommand } from "./setupOsc";
import type { CommandMark } from "./setupOsc";
import type { IMarker } from "@xterm/xterm";
import { createRealTerminal, writeParsed } from "./realXterm.testUtils";

/**
 * CPU milliseconds `work` costs on this thread's own clock
 * (`process.threadCpuUsage`, Node ≥ 22.19; the process clock before that).
 * No garbage collection first: a forced full collection bills its sweeping to
 * the samples that follow — under load it raised Node 22's median small and
 * large samples from 1.52 and 7.52 ms to 2.62 and 11.93 ms, lowering the
 * exponent by adding cost rather than measuring the bookkeeping better. Kept
 * minimal on purpose — the shared `cpuMs` in src/test/cpuClock.ts replaces it
 * once that module is on main.
 */
function cpuMs(work: () => void): number {
  const clock = process.threadCpuUsage?.bind(process) ?? (() => process.cpuUsage());
  const start = clock();
  work();
  const end = clock();
  return (end.user - start.user + end.system - start.system) / 1000;
}

/**
 * Growth exponent of `costAt` (CPU ms at size n) between `small` and `large`:
 * 1 is linear, 2 quadratic. An exponent, never a duration — the method of
 * htmlScaling.test.ts: contention and instrumentation move durations, they
 * cannot turn cost ∝ n into cost ∝ n². Minimum of interleaved runs after a
 * warm-up; the small sample is floored at 1 ms against timer resolution.
 */
function growthExponent(costAt: (n: number) => number, small: number, large: number) {
  costAt(small); // warm-up: JIT
  let bestSmall = Number.POSITIVE_INFINITY;
  let bestLarge = Number.POSITIVE_INFINITY;
  // Five interleaved rounds, minimum kept — htmlScaling.test.ts's `measure`.
  for (let round = 0; round < 5; round += 1) {
    bestSmall = Math.min(bestSmall, costAt(small));
    bestLarge = Math.min(bestLarge, costAt(large));
    bestSmall = Math.min(bestSmall, costAt(small));
  }
  const exponent = Math.log(bestLarge / Math.max(bestSmall, 1)) / Math.log(large / small);
  return { exponent, small: bestSmall, large: bestLarge };
}

/**
 * A full garbage collection WITHOUT `--expose-gc`, whose runtime toggle races
 * between vitest's worker threads: `v8.queryObjects` collects before it counts
 * (it exists for memory-leak regression tests). Prints one ExperimentalWarning
 * per worker thread that calls it.
 */
class GcProbe {}
function collectGarbage(): void {
  queryObjects(GcProbe, { format: "count" });
}

describe("parseOsc7Cwd", () => {
  it("extracts the path from a file:// URL with a host", () => {
    expect(parseOsc7Cwd("file://my-mac.local/Users/joker/project")).toBe(
      "/Users/joker/project",
    );
  });

  it("handles an empty host (file:///path)", () => {
    expect(parseOsc7Cwd("file:///Users/joker")).toBe("/Users/joker");
  });

  it("percent-decodes spaces and unicode", () => {
    expect(parseOsc7Cwd("file://h/Users/joker/My%20Docs/%E4%B8%AD")).toBe(
      "/Users/joker/My Docs/中",
    );
  });

  it("decodes the URL-syntactic chars the emitter now encodes (#, ?, %)", () => {
    // vmark.zsh percent-encodes #/?/% so new URL() doesn't truncate at the
    // fragment/query — the parser must round-trip them (Codex audit).
    expect(parseOsc7Cwd("file://h/tmp/a%23b%3Fc%25d")).toBe("/tmp/a#b?c%d");
  });

  it("returns null for non-file payloads", () => {
    expect(parseOsc7Cwd("https://example.com")).toBeNull();
    expect(parseOsc7Cwd("/just/a/path")).toBeNull();
    expect(parseOsc7Cwd("")).toBeNull();
  });

  it("treats a shell at filesystem root (file://host/) as /", () => {
    expect(parseOsc7Cwd("file://my-mac.local/")).toBe("/");
  });
});

describe("setupOsc7", () => {
  function makeTerm() {
    let handler: ((data: string) => boolean) | null = null;
    const term = {
      parser: {
        registerOscHandler: vi.fn((id: number, h: (d: string) => boolean) => {
          if (id === 7) handler = h;
          return { dispose: vi.fn() };
        }),
      },
    } as unknown as import("@xterm/xterm").Terminal;
    return { term, fire: (d: string) => handler?.(d) };
  }

  it("starts with null cwd and updates it on a valid OSC 7", () => {
    const { term, fire } = makeTerm();
    const osc = setupOsc7(term);
    expect(osc.getCwd()).toBeNull();

    const handled = fire("file://h/Users/joker/work");
    expect(handled).toBe(true);
    expect(osc.getCwd()).toBe("/Users/joker/work");
  });

  it("ignores a malformed payload, keeping the previous cwd", () => {
    const { term, fire } = makeTerm();
    const osc = setupOsc7(term);
    fire("file://h/Users/joker");
    fire("garbage");
    expect(osc.getCwd()).toBe("/Users/joker");
  });

  it("registers the handler for OSC id 7", () => {
    const { term } = makeTerm();
    setupOsc7(term);
    expect(term.parser.registerOscHandler).toHaveBeenCalledWith(7, expect.any(Function));
  });
});

describe("setupOsc133", () => {
  function makeTerm() {
    let handler: ((data: string) => boolean) | null = null;
    let nextLine = 0;
    const disposers: Array<() => void> = [];
    const term = {
      parser: {
        registerOscHandler: vi.fn((id: number, h: (d: string) => boolean) => {
          if (id === 133) handler = h;
          return { dispose: vi.fn() };
        }),
        registerEscHandler: vi.fn(() => ({ dispose: vi.fn() })),
      },
      registerMarker: vi.fn(() => {
        const line = nextLine++;
        return {
          line,
          onDispose: (cb: () => void) => disposers.push(cb),
          dispose: vi.fn(),
        };
      }),
      registerDecoration: vi.fn(() => ({ onRender: vi.fn(), dispose: vi.fn() })),
    } as unknown as import("@xterm/xterm").Terminal;
    return { term, fire: (d: string) => handler?.(d), disposers };
  }

  it("opens a command on A and records exit code on D", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    fire("A"); // prompt 1
    fire("C"); // command 1 starts
    expect(h.getCommands()).toHaveLength(1);
    expect(h.getCommands()[0].exitCode).toBeUndefined();

    fire("D;0"); // command 1 done (success)
    fire("A");   // prompt 2
    expect(h.getCommands()).toHaveLength(2);
    expect(h.getCommands()[0].exitCode).toBe(0);
  });

  it("captures a non-zero exit code", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    fire("A");
    fire("C");
    fire("D;1");
    expect(h.getCommands()[0].exitCode).toBe(1);
  });

  it("ignores a D with no preceding command (first precmd)", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    fire("D;0"); // no command open yet
    expect(h.getCommands()).toHaveLength(0);
  });

  it("each command marker sits on its own line", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    fire("A");
    fire("D;0");
    fire("A");
    const cmds = h.getCommands();
    expect(cmds[0].marker.line).toBe(0);
    expect(cmds[1].marker.line).toBe(1);
  });

  it("removes a command when its marker is disposed (scrolled out)", () => {
    const { term, fire, disposers } = makeTerm();
    const h = setupOsc133(term);
    fire("A");
    fire("A");
    expect(h.getCommands()).toHaveLength(2);
    disposers[0](); // first command's line scrolls out of scrollback
    expect(h.getCommands()).toHaveLength(1);
    expect(h.getCommands()[0].marker.line).toBe(1);
  });

  it("tracks command-running state across C and D (audit-fix)", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    expect(h.isRunning()).toBe(false);
    fire("A"); // prompt — idle
    expect(h.isRunning()).toBe(false);
    fire("C"); // command starts — busy
    expect(h.isRunning()).toBe(true);
    fire("D;0"); // command done — idle
    expect(h.isRunning()).toBe(false);
  });

  it("fires the idle callback when a running command finishes (D)", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    const onIdle = vi.fn();
    h.setOnIdle(onIdle);

    fire("A"); // prompt — idle, no running command yet
    expect(onIdle).not.toHaveBeenCalled();
    fire("C"); // command starts — busy
    expect(onIdle).not.toHaveBeenCalled();
    fire("D;0"); // command done — idle transition fires the callback
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("does not fire the idle callback on an idle-to-idle prompt (A with no running command)", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    const onIdle = vi.fn();
    h.setOnIdle(onIdle);

    fire("A");
    fire("A");
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("clears the idle callback when set to null", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    const onIdle = vi.fn();
    h.setOnIdle(onIdle);
    h.setOnIdle(null);

    fire("C");
    fire("D;0");
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("creates an exit-status decoration on D (WI-3.4)", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    fire("A");
    fire("C");
    fire("D;1");
    expect(term.registerDecoration).toHaveBeenCalledTimes(1);
    expect(h.getCommands()[0].decoration).toBeDefined();
  });

  // --- WI-4.6 coverage backfill: out-of-order / malformed OSC 133 ---

  it("ignores a 133;D arriving before any 133;A without crashing", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    // D before any prompt opened — `current` is null, must be a safe no-op.
    expect(() => fire("D;0")).not.toThrow();
    expect(h.getCommands()).toHaveLength(0);
    expect(h.isRunning()).toBe(false);
    expect(term.registerDecoration).not.toHaveBeenCalled();
  });

  it("a repeat 133;D does not overwrite a finished command's exit code or redecorate", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    fire("A");
    fire("C");
    fire("D;0"); // first done — exit 0, decorates once
    expect(term.registerDecoration).toHaveBeenCalledTimes(1);
    expect(h.getCommands()[0].exitCode).toBe(0);
    // A stray repeat D with a DIFFERENT code must be ignored: the command is
    // already closed, and its exit code is immutable until the next prompt (A).
    expect(() => fire("D;1")).not.toThrow();
    expect(h.getCommands()[0].exitCode).toBe(0); // NOT overwritten to 1
    expect(term.registerDecoration).toHaveBeenCalledTimes(1);
    expect(h.getCommands()).toHaveLength(1);
    expect(h.isRunning()).toBe(false);
  });

  it("rejects a non-numeric exit code (133;D;abc), leaving exitCode undefined", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    fire("A");
    fire("C");
    // `abc` parses to NaN and must NOT be stored as the exit code.
    expect(() => fire("D;abc")).not.toThrow();
    expect(h.getCommands()[0].exitCode).toBeUndefined();
    expect(Number.isNaN(h.getCommands()[0].exitCode as number)).toBe(false);
    // No code → no decoration created.
    expect(term.registerDecoration).not.toHaveBeenCalled();
    expect(h.isRunning()).toBe(false);
  });

  it("handles 133;C without a prior 133;A — marks running, no command", () => {
    const { term, fire } = makeTerm();
    const h = setupOsc133(term);
    // C before any prompt — sets running but opens no command mark.
    expect(() => fire("C")).not.toThrow();
    expect(h.isRunning()).toBe(true);
    expect(h.getCommands()).toHaveLength(0);
    expect(term.registerMarker).not.toHaveBeenCalled();
  });
});

// #1471 — a session restart resets the terminal with RIS (ESC c), and so does
// `reset`/`tput reset` typed in the shell. RIS rebuilds xterm's buffers but
// does NOT dispose their markers, so a mark kept its old line number and
// pointed into text that no longer exists: prompt navigation jumped to the
// wrong row and "Copy Command Output" copied the wrong lines. Real xterm here —
// the question is what xterm does with a marker, which a mock can't answer.
describe("setupOsc133 — full reset (RIS) invalidates command marks", () => {
  const PROMPT = "\x1b]133;A\x07";
  const RUNNING = "\x1b]133;C\x07";
  const DONE_OK = "\x1b]133;D;0\x07";

  it("drops every mark when RIS wipes the buffer they point into", async () => {
    const term = createRealTerminal();
    const osc = setupOsc133(term);
    await writeParsed(term, `${PROMPT}$ ls\r\nout\r\n${DONE_OK}${PROMPT}$ codex\r\n${RUNNING}`);
    expect(osc.getCommands()).toHaveLength(2);

    await writeParsed(term, "\x1bc");

    expect(osc.getCommands()).toEqual([]);
  });

  it("does not swallow the reset itself", async () => {
    const term = createRealTerminal();
    setupOsc133(term);
    await writeParsed(term, "\x1b[?1003h\x1b[?2004h\x1bc");

    expect(term.modes.mouseTrackingMode).toBe("none");
    expect(term.modes.bracketedPasteMode).toBe(false);
  });

  it("tracks the next shell's prompts after the reset", async () => {
    const term = createRealTerminal();
    const osc = setupOsc133(term);
    await writeParsed(term, `${PROMPT}$ codex\r\n${RUNNING}\x1bc${PROMPT}$ `);

    expect(osc.getCommands()).toHaveLength(1);
    expect(osc.getCommands()[0].marker.line).toBe(0);
  });

  it("drops its marks on RIS without disposing them one by one — a program's reset must not freeze the UI", async () => {
    // Against REAL xterm markers: disposing them one by one splices xterm's
    // own marker array each time — 1.6 s at 20k marks, quadratic in a count
    // any program can inflate by printing OSC 133;A. The marks are dropped
    // instead (the buffer they belong to is discarded by the reset). Asserted
    // directly rather than timed: the dropped path is too cheap to time
    // reliably, and the property IS "no per-mark dispose".
    const term = createRealTerminal();
    const markers: IMarker[] = [];
    const registerMarker = term.registerMarker.bind(term);
    term.registerMarker = (offset?: number) => {
      const marker = registerMarker(offset);
      if (marker) markers.push(marker);
      return marker;
    };
    const osc = setupOsc133(term);
    await writeParsed(term, PROMPT.repeat(5_000));

    await writeParsed(term, "\x1bc");

    expect(osc.getCommands()).toHaveLength(0);
    expect(markers).toHaveLength(5_000);
    expect(markers.filter((marker) => marker.isDisposed)).toHaveLength(0);
    term.dispose();
  });

  it("a bulk disposal of marks (clear, a restart) costs linear time in OUR bookkeeping", () => {
    // Filtering the mark list once per disposed marker made our share of a
    // bulk disposal quadratic. Isolated from xterm on purpose: xterm's own
    // clear() is itself superlinear in its marker count (measured 7→84→309 ms
    // for 5k/20k/40k plain markers in 6.0.0). Only a user action runs it
    // (Cmd+K, a restart — main's restart ran it too), though output decides
    // how many markers it meets; that part is upstream's to fix.
    const growth = growthExponent((count) => {
      const disposers: Array<() => void> = [];
      let osc: ((data: string) => boolean) | undefined;
      const term = {
        parser: {
          registerOscHandler: (_id: number, handler: (data: string) => boolean) => (osc = handler),
          registerEscHandler: () => ({ dispose: () => {} }),
        },
        registerMarker: () => ({ line: 0, onDispose: (cb: () => void) => disposers.push(cb) }),
      } as unknown as import("@xterm/xterm").Terminal;
      const handle = setupOsc133(term);
      for (let i = 0; i < count; i += 1) osc?.("A");
      return cpuMs(() => {
        for (const fire of disposers) fire(); // what clearAllMarkers does
        expect(handle.getCommands()).toHaveLength(0);
      });
    }, 20_000, 80_000); // big enough that the small sample is well above timer resolution
    // 1.75, not the 1.35 htmlScaling uses: this path is linear but a V8 hash
    // table's shrink-on-delete and memory effects bend it. On this thread
    // clock, at load ~40 on Node 24 and 22: this file in full, 180 readings,
    // max 1.41; the measurement alone, 1,000 readings, max 1.68. Quadratic is
    // 2; the per-dispose filter it replaced measured 2.18–2.22.
    expect(growth.exponent, `20k marks ${growth.small.toFixed(1)}ms, 80k ${growth.large.toFixed(1)}ms`).toBeLessThan(1.75);
  });

  it("lets go of a scrolled-out mark as its marker dies, even if nobody reads the list", async () => {
    // A program can print prompts forever; marks whose line left the
    // scrollback must not accumulate until the next getCommands(). Observed
    // through the garbage collector — reading the list would compact it —
    // each marker tracked by a WeakRef, so no other test's objects count.
    const term = createRealTerminal({ rows: 5, scrollback: 10 });
    const markers: Array<WeakRef<object>> = [];
    const registerMarker = term.registerMarker.bind(term);
    term.registerMarker = (offset?: number) => {
      const marker = registerMarker(offset);
      if (marker) markers.push(new WeakRef(marker));
      return marker;
    };
    setupOsc133(term);
    await writeParsed(term, `${PROMPT}$ \r\n`.repeat(200));
    await new Promise((resolve) => setTimeout(resolve, 0)); // WeakRefs clear only after the job

    collectGarbage();

    const alive = markers
      .slice(0, 150)
      .map((ref) => ref.deref() as { isDisposed?: boolean } | undefined)
      .filter((marker) => marker !== undefined);
    // Every survivor died first — so onDispose ran and the mark left our list
    // — and there are only a handful: xterm/V8 keep a few disposed markers
    // alive on their own (up to 4, the same ones run after run). Keeping
    // scrolled-out marks ourselves kept all 150.
    expect(alive.every((marker) => marker.isDisposed === true)).toBe(true);
    expect(alive.length).toBeLessThan(8);
    term.dispose();
  });

  it("leaves a command that was running busy until the next prompt, so deferred idle work still flushes", async () => {
    // Deliberate: RIS does not end the command. After a restart the new
    // shell's first prompt is the idle signal that flushes a workspace `cd`
    // deferred while the old command ran; clearing `running` on RIS would
    // swallow that flush.
    const term = createRealTerminal();
    const osc = setupOsc133(term);
    const onIdle = vi.fn();
    osc.setOnIdle(onIdle);
    await writeParsed(term, `${PROMPT}$ codex\r\n${RUNNING}\x1bc`);
    expect(osc.isRunning()).toBe(true);

    await writeParsed(term, PROMPT);

    expect(onIdle).toHaveBeenCalledOnce();
    expect(osc.isRunning()).toBe(false);
  });
});

describe("scrollToAdjacentCommand (WI-3.3)", () => {
  function makeTerm(viewportY: number) {
    return {
      buffer: { active: { viewportY } },
      scrollToLine: vi.fn(),
    } as unknown as import("@xterm/xterm").Terminal;
  }
  function cmds(...lines: number[]): CommandMark[] {
    return lines.map((line) => ({ marker: { line } as unknown as CommandMark["marker"] }));
  }

  it("jumps to the nearest prompt above the viewport for 'prev'", () => {
    const term = makeTerm(50);
    scrollToAdjacentCommand(term, cmds(10, 30, 70), "prev");
    expect(term.scrollToLine).toHaveBeenCalledWith(30);
  });

  it("jumps to the nearest prompt below the viewport for 'next'", () => {
    const term = makeTerm(50);
    scrollToAdjacentCommand(term, cmds(10, 30, 70), "next");
    expect(term.scrollToLine).toHaveBeenCalledWith(70);
  });

  it("is a no-op when there are no commands", () => {
    const term = makeTerm(50);
    scrollToAdjacentCommand(term, [], "prev");
    expect(term.scrollToLine).not.toHaveBeenCalled();
  });

  it("ignores disposed markers (line -1)", () => {
    const term = makeTerm(50);
    scrollToAdjacentCommand(term, cmds(-1, 30), "prev");
    expect(term.scrollToLine).toHaveBeenCalledWith(30);
  });
});
