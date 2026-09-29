// @vitest-environment node
/**
 * The CPU clock the growth-exponent tests measure with (see `cpuClock.ts`):
 * which clock is chosen and how it is read, checked against fakes; checked for
 * real, that a sibling thread's CPU stays off the thread clock and that
 * sub-millisecond work is resolved on this OS. `measureGrowth` has its own file.
 */
import { describe, it, expect } from "vitest";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { CPU_CLOCK, cpuMs, growthExponent, selectCpuClock, type CpuClock, type CpuClockKind } from "./cpuClock";

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

  // Not on Windows: libuv reports thread times there in whole milliseconds
  // (through SYSTEMTIME), so short work legitimately reads 0 — see the header.
  it.skipIf(process.platform === "win32")(
    "resolves sub-millisecond work on this OS — a precise clock never reads it as zero",
    () => {
      // Tens of microseconds each: a microsecond clock always sees them, while
      // Linux's unprimed thread clock read 240 of 300 samples of ~0.2 ms as 0.
      const readings = Array.from({ length: 50 }, () => cpuMs(() => spin(20_000)));
      expect(readings.filter((ms) => ms === 0)).toEqual([]);
    },
  );

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

describe("growthExponent", () => {
  const growth = (smallMs: number, largeMs: number) => ({
    smallMs,
    largeMs,
    repeats: { small: 1, large: 1 },
    clock: "thread" as const,
  });

  it("is 1 for linear cost and 2 for quadratic", () => {
    expect(growthExponent(growth(2, 8), 1_000, 4_000)).toBeCloseTo(1, 10);
    expect(growthExponent(growth(2, 32), 1_000, 4_000)).toBeCloseTo(2, 10);
  });

  it("takes a sub-millisecond run cost as it is — calibrated samples are long enough to trust it", () => {
    expect(growthExponent(growth(0.25, 1), 1_000, 4_000)).toBeCloseTo(1, 10);
  });

  it.each([[0, 4], [-1, 4], [1, 0], [Number.NaN, 4]])("refuses costs %s → %s ms", (smallMs, largeMs) => {
    expect(() => growthExponent(growth(smallMs, largeMs), 1_000, 4_000)).toThrow(RangeError);
  });

  it.each([[1_000, 1_000], [4_000, 1_000], [0, 1_000], [-1, 1_000]])("refuses sizes %s → %s", (smallSize, largeSize) => {
    expect(() => growthExponent(growth(1, 4), smallSize, largeSize)).toThrow(RangeError);
  });
});
