// @vitest-environment node
/**
 * The CPU clock the growth-exponent tests measure with (see `cpuClock.ts`).
 *
 * The clock choice and the sampling order are checked against fakes, so they
 * are deterministic on any machine. Checked for real: a sibling thread's CPU
 * stays off the thread clock, and sub-millisecond work is resolved here.
 */
import { describe, it, expect } from "vitest";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import {
  CPU_CLOCK,
  cpuMs,
  growthExponent,
  measureGrowth,
  selectCpuClock,
  type CpuClock,
  type CpuClockKind,
} from "./cpuClock";

const hasThreadClock = typeof (process as { threadCpuUsage?: unknown }).threadCpuUsage === "function";

/** A clock that only moves when the test says so. */
function manualClock(kind: CpuClockKind) {
  let us = 0;
  const clock: CpuClock = { kind, readUs: () => us };
  return { clock, spend: (ms: number) => void (us += ms * 1000) };
}

let sink = 0;
/** Pure CPU work: about a microsecond per thousand iterations on a fast machine. */
function spin(iterations: number): void {
  let x = sink;
  for (let i = 0; i < iterations; i += 1) x = (x * 31 + i) | 0;
  sink = x;
}

describe("selectCpuClock", () => {
  it("uses the thread clock when the runtime has one", () => {
    const source = {
      cpuUsage: () => ({ user: 9_000, system: 1_000 }),
      threadCpuUsage: () => ({ user: 700, system: 300 }),
    };
    const clock = selectCpuClock(source);
    expect(clock.kind).toBe("thread");
    expect(clock.readUs()).toBe(1_000);
  });

  it("brings the thread clock up to date before reading it", () => {
    // Linux's model: RUSAGE_THREAD reports this thread's runtime as of the last
    // scheduler update, up to a tick stale; RUSAGE_SELF folds the pending
    // runtime in first.
    let accounted = 1_000;
    let pending = 400;
    const source = {
      cpuUsage() {
        accounted += pending;
        pending = 0;
        return { user: accounted, system: 0 };
      },
      threadCpuUsage: () => ({ user: accounted, system: 0 }),
    };
    expect(selectCpuClock(source).readUs()).toBe(1_400);
  });

  it("falls back to the process clock on a runtime without one (Node < 22.19)", () => {
    const clock = selectCpuClock({ cpuUsage: () => ({ user: 9_000, system: 1_000 }) });
    expect(clock.kind).toBe("process");
    expect(clock.readUs()).toBe(10_000);
  });

  it("reads the thread clock with its own receiver", () => {
    const source = { base: 5, cpuUsage: () => ({ user: 0, system: 0 }) };
    const withThread = Object.assign(source, {
      threadCpuUsage(this: typeof source) {
        return { user: this.base * 2, system: 1 };
      },
    });
    expect(selectCpuClock(withThread).readUs()).toBe(11);
  });

  it.runIf(hasThreadClock)("is the thread clock by default on this runtime", () => expect(CPU_CLOCK.kind).toBe("thread"));

  it("resolves sub-millisecond work on this OS — a precise clock never reads it as zero", () => {
    // Tens of microseconds each: a microsecond clock always sees them, while
    // Linux's unprimed thread clock read 240 of 300 samples of ~0.2 ms as 0.
    const readings = Array.from({ length: 50 }, () => cpuMs(() => spin(20_000)));
    expect(readings.filter((ms) => ms === 0)).toEqual([]);
  });

  it.runIf(hasThreadClock)(
    "keeps a sibling thread's CPU off the thread clock, while the process clock bills it",
    async () => {
      // [0] go, [1] done. The worker burns 30 ms of ITS OWN CPU, then signals.
      const flags = new Int32Array(new SharedArrayBuffer(8));
      const worker = new Worker(
        `const { workerData: flags } = require("node:worker_threads");
         Atomics.wait(flags, 0, 0);
         const start = process.threadCpuUsage();
         for (;;) {
           const used = process.threadCpuUsage(start);
           if (used.user + used.system >= 30_000) break;
         }
         Atomics.store(flags, 1, 1);
         Atomics.notify(flags, 1);`,
        { eval: true, workerData: flags },
      );
      try {
        await once(worker, "online");
        const thread = selectCpuClock(process);
        const proc = selectCpuClock({ cpuUsage: () => process.cpuUsage() });
        const thread0 = thread.readUs();
        const proc0 = proc.readUs();
        Atomics.store(flags, 0, 1);
        Atomics.notify(flags, 0);
        // This thread blocks — it spends no CPU — until the worker is done.
        const waited = Atomics.wait(flags, 1, 0, 60_000);
        const threadMs = (thread.readUs() - thread0) / 1000;
        const procMs = (proc.readUs() - proc0) / 1000;

        expect(waited).not.toBe("timed-out");
        expect(threadMs).toBeLessThan(5);
        expect(procMs).toBeGreaterThanOrEqual(25);
      } finally {
        await worker.terminate();
      }
    },
  );
});

describe("cpuMs", () => {
  it.each(["thread", "process"] as const)("returns the CPU milliseconds the work spent on the %s clock", (kind) => {
    const { clock, spend } = manualClock(kind);
    spend(7); // what ran before is not billed
    expect(cpuMs(() => spend(2.5), clock)).toBe(2.5);
  });
});

describe("measureGrowth", () => {
  /** A run whose i-th call on `input` costs `costs[input][i]` ms, recording the order. */
  function scriptedRun(clock: ReturnType<typeof manualClock>, costs: Record<string, number[]>) {
    const calls: string[] = [];
    const seen: Record<string, number> = {};
    const run = (input: string) => {
      calls.push(input);
      const i = seen[input] ?? 0;
      seen[input] = i + 1;
      clock.spend(costs[input][i]);
    };
    return { run, calls };
  }

  it("warms up once untimed, then interleaves small, large, small each round", () => {
    const clock = manualClock("thread");
    const { run, calls } = scriptedRun(clock, { s: [1, 1, 1, 1, 1], l: [4, 4] });

    measureGrowth(run, "s", "l", { rounds: 2, clock: clock.clock });

    expect(calls).toEqual(["s", "s", "l", "s", "s", "l", "s"]);
  });

  it("keeps the minimum of each side and ignores the warm-up", () => {
    const clock = manualClock("thread");
    // The warm-up (first "s") is the cheapest reading of all: it must not count.
    // Neither side's minimum is its last reading.
    const { run } = scriptedRun(clock, { s: [0.5, 3, 2, 4, 5], l: [7, 9] });

    const growth = measureGrowth(run, "s", "l", { rounds: 2, clock: clock.clock });

    expect(growth).toEqual({ smallMs: 2, largeMs: 7, clock: "thread" });
  });

  it("names the clock that measured", () => {
    const clock = manualClock("process");
    const { run } = scriptedRun(clock, { s: [1, 1, 1], l: [4] });
    expect(measureGrowth(run, "s", "l", { rounds: 1, clock: clock.clock }).clock).toBe("process");
  });

  it("defaults to five rounds on the default clock", () => {
    const calls: string[] = [];
    const growth = measureGrowth((input: string) => void calls.push(input), "s", "l");
    expect(calls).toHaveLength(1 + 5 * 3);
    expect(growth.clock).toBe(CPU_CLOCK.kind);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses %s rounds", (rounds) => {
    const clock = manualClock("thread");
    expect(() => measureGrowth(() => {}, "s", "l", { rounds, clock: clock.clock })).toThrow(RangeError);
  });
});

describe("growthExponent", () => {
  const growth = (smallMs: number, largeMs: number) => ({ smallMs, largeMs, clock: "thread" as const });

  it("is 1 for linear cost and 2 for quadratic", () => {
    expect(growthExponent(growth(2, 8), 1_000, 4_000)).toBeCloseTo(1, 10);
    expect(growthExponent(growth(2, 32), 1_000, 4_000)).toBeCloseTo(2, 10);
  });

  it("floors the small sample at 1 ms, so timer resolution cannot manufacture a ratio", () => {
    // 0.25 → 2 ms would read as exponent 1.5; floored, it is 0.5.
    expect(growthExponent(growth(0.25, 2), 1_000, 4_000)).toBeCloseTo(0.5, 10);
  });

  it.each([[1_000, 1_000], [4_000, 1_000], [0, 1_000], [-1, 1_000]])("refuses sizes %s → %s", (smallSize, largeSize) => {
    expect(() => growthExponent(growth(1, 4), smallSize, largeSize)).toThrow(RangeError);
  });
});
