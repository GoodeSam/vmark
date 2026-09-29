// @vitest-environment node
/**
 * `measureGrowth` and its calibration (see `cpuClock.ts`), against fake clocks
 * so every case is deterministic: exact ones, one as coarse as Linux's unprimed
 * thread clock, and one that charges a collection every few hundred allocations.
 */
import { describe, it, expect } from "vitest";
import { cpuMs, growthExponent, measureGrowth, type CpuClock, type CpuClockKind } from "./cpuClock";

/** A clock that only moves when the test says so; `readAs` can coarsen what it reports. */
function manualClock(kind: CpuClockKind, readAs: (us: number) => number = (us) => us) {
  let us = 0;
  const clock: CpuClock = { kind, readUs: () => readAs(us) };
  return { clock, spend: (ms: number) => void (us += ms * 1000) };
}

/** A run costing a fixed number of milliseconds per input, recording the order of calls. */
function fixedCostRun(spend: (ms: number) => void, costs: Record<string, number>) {
  const calls: string[] = [];
  const run = (input: string) => {
    calls.push(input);
    spend(costs[input]);
  };
  return { run, calls };
}

/** mulberry32: a seeded, exactly reproducible stand-in for Math.random. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/**
 * Linear work — 0.25 ms and 1 unit of allocation a small run, four times that
 * a large one — plus a collection costing `pauseMs` every `period` units,
 * starting `offset` units into the first period.
 */
function collectingRun(spend: (ms: number) => void, period: number, pauseMs: number, offset = 0) {
  let allocated = offset;
  return (input: string) => {
    const units = input === "l" ? 4 : 1;
    spend(units * 0.25);
    allocated += units;
    if (allocated >= period) {
      allocated -= period;
      spend(pauseMs);
    }
  };
}

describe("measureGrowth — calibration", () => {
  // 3 ms: 3, 6, 12 fall short, 8 runs cost 24; 12 ms: 2 runs. 5 ms: 4 runs reach 20 exactly.
  it.each([
    [3, 12, { small: 8, large: 2 }],
    [5, 20, { small: 4, large: 1 }],
    [25, 100, { small: 1, large: 1 }],
  ])("doubles each input's runs per sample until a sample costs 20 ms: %s and %s ms a run", (s, l, repeats) => {
    const { clock, spend } = manualClock("thread");
    const { run } = fixedCostRun(spend, { s, l });

    expect(measureGrowth(run, "s", "l", { rounds: 1, clock, minSampleMs: 20 }).repeats).toEqual(repeats);
  });

  it("reports the cost of one run of each input", () => {
    const { clock, spend } = manualClock("process");
    const { run } = fixedCostRun(spend, { s: 1, l: 4 });

    const growth = measureGrowth(run, "s", "l", { rounds: 2, clock, minSampleMs: 3 });

    expect(growth).toEqual({ smallMs: 1, largeMs: 4, repeats: { small: 4, large: 1 }, clock: "process" });
  });

  it("warms up once untimed, calibrates each input, then samples each once a round in random order", () => {
    const { clock, spend } = manualClock("thread");
    const { run, calls } = fixedCostRun(spend, { s: 1, l: 4 });
    const draws = [0.2, 0.7]; // below one half: small first

    measureGrowth(run, "s", "l", { rounds: 2, clock, minSampleMs: 1.5, random: () => draws.shift() ?? 0 });

    const warmUp = ["s"];
    const calibration = ["s", "s", "s", "l"]; // small: 1 run (1 ms), 2 runs (2 ms); large: 1 run (4 ms)
    const rounds = ["s", "s", "l", "l", "s", "s"];
    expect(calls).toEqual([...warmUp, ...calibration, ...rounds]);
  });

  it("defaults to five rounds of samples costing at least 20 ms, as many of each input", () => {
    const { clock, spend } = manualClock("thread");
    const { run, calls } = fixedCostRun(spend, { s: 1, l: 4 });

    expect(measureGrowth(run, "s", "l", { clock }).repeats).toEqual({ small: 32, large: 8 });
    const count = (input: string) => calls.filter((c) => c === input).length;
    expect(count("s")).toBe(1 + (1 + 2 + 4 + 8 + 16 + 32) + 5 * 32);
    expect(count("l")).toBe(1 + 2 + 4 + 8 + 5 * 8);
  });

  // Codex's check, for either side: whole-millisecond readings, and the first
  // calibration sample of that input costs 21 ms, which alone settles on one run.
  it.each(["s", "l"])("re-measures with more runs when a calibration outlier picked too few (%s)", (fooled) => {
    const { clock, spend } = manualClock("thread", (us) => Math.floor(us / 1000) * 1000);
    const seen: Record<string, number> = { s: 0, l: 0 };
    const normal: Record<string, number> = { s: 0.25, l: 1 };
    const firstCalibration = fooled === "s" ? 2 : 1; // the small input's first run is the warm-up
    const run = (input: string) => spend(input === fooled && ++seen[input] === firstCalibration ? 21 : normal[input]);

    const growth = measureGrowth(run, "s", "l", { clock });

    expect(growth.repeats).toEqual({ small: 128, large: 32 });
    expect(growthExponent(growth, 1, 4)).toBeGreaterThan(0.95);
    expect(growthExponent(growth, 1, 4)).toBeLessThan(1.05);
  });

  it("gives up loudly when even a million runs of the small input cost nothing measurable", () => {
    const { clock } = manualClock("thread");
    expect(() => measureGrowth(() => {}, "s", "l", { clock })).toThrow(RangeError);
  });

  it("gives up loudly when re-measuring can never reach the floor", () => {
    // The small input's calibration is fooled once; every later small run costs nothing.
    const { clock, spend } = manualClock("thread");
    let smallCalls = 0;
    const run = (input: string) => spend(input === "l" ? 1 : ++smallCalls === 2 ? 21 : 0);
    expect(() => measureGrowth(run, "s", "l", { clock })).toThrow(/nothing to measure/);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("refuses a minSampleMs of %s", (minSampleMs) => {
    const { clock, spend } = manualClock("thread");
    const { run } = fixedCostRun(spend, { s: 25, l: 100 });
    expect(() => measureGrowth(run, "s", "l", { clock, minSampleMs })).toThrow(/minSampleMs/);
  });
});

describe("measureGrowth — sampling", () => {
  it("keeps the minimum of each side; the warm-up and calibration never count", () => {
    const { clock, spend } = manualClock("thread");
    // Per call, in order. The warm-up and calibration readings are the cheapest
    // of all, and neither side's minimum is its last reading.
    const costs: Record<string, number[]> = { s: [0.5, 1, 3, 2, 4, 5], l: [1, 7, 9] };
    const run = (input: string) => spend(costs[input].shift() ?? Number.NaN);

    const growth = measureGrowth(run, "s", "l", { rounds: 2, clock, minSampleMs: 0.001 });

    expect(growth).toEqual({ smallMs: 2, largeMs: 7, repeats: { small: 1, large: 1 }, clock: "thread" });
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses %s rounds", (rounds) => {
    const { clock, spend } = manualClock("thread");
    const { run } = fixedCostRun(spend, { s: 25, l: 100 });
    expect(() => measureGrowth(run, "s", "l", { rounds, clock })).toThrow(/rounds/);
  });

  /** Exponents over 200 seeded sampling orders of `collectingRun(period, pauseMs, offset)`. */
  function exponentsOverOrders(period: number, pauseMs: number, offset: number): number[] {
    return Array.from({ length: 200 }, (_, i) => {
      const { clock, spend } = manualClock("thread");
      const run = collectingRun(spend, period, pauseMs, offset);
      return growthExponent(measureGrowth(run, "s", "l", { clock, random: seeded(i + 1) }), 1, 4);
    });
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

  it("reads linear work within one pause of linear when a collection costs 5% of the work", () => {
    // About the aggregate GC share these suites showed (0–6%). A 2.5 ms pause
    // per 50 ms of work lands whole on a ~32 ms sample, so it can move one side
    // by at most log(1 + 2.5 / 32) / log 4 ≈ 0.054.
    const exponents = exponentsOverOrders(200, 2.5, 32);
    const bound = Math.log(1 + 2.5 / 32) / Math.log(4);
    expect(Math.min(...exponents)).toBeGreaterThanOrEqual(1 - bound - 1e-9);
    expect(Math.max(...exponents)).toBeLessThanOrEqual(1 + bound + 1e-9);
    expect(median(exponents)).toBeCloseTo(1, 10);
  });

  it("does not let even a collection costing half the work settle on one side", () => {
    // Codex's adversary: a 25 ms pause per 50 ms of work, phased so that one
    // fixed small-large-small order put it in every large sample and read 1.42
    // every time. In random order it still can by chance — no finite sample
    // survives a periodic cost this large — but in a minority of orders, and
    // the typical reading is exactly linear.
    const exponents = exponentsOverOrders(200, 25, 32);
    expect(median(exponents)).toBeCloseTo(1, 10);
    expect(exponents.filter((e) => e >= 1.35).length).toBeLessThan(50);
  });

  /** Whole milliseconds, read at a random point in the tick: Linux's unprimed thread clock in miniature. */
  function coarseClock(seed: number) {
    let trueUs = 0;
    let reads = 0;
    const random = seeded(seed);
    const clock: CpuClock = {
      kind: "thread",
      readUs: () => {
        // Untimed harness work lands before each sample's first read.
        if (reads++ % 2 === 0) trueUs += random() * 1_000;
        return Math.floor(trueUs / 1_000) * 1_000;
      },
    };
    return { clock, spend: (ms: number) => void (trueUs += ms * 1_000) };
  }

  /** main's measurement before calibration: one run per sample, small floored at 1 ms. */
  function uncalibratedExponent(clock: CpuClock, run: (input: string) => void): number {
    const time = (input: string) => cpuMs(() => run(input), clock);
    run("s");
    let small = Number.POSITIVE_INFINITY;
    let large = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 5; round += 1) {
      small = Math.min(small, time("s"));
      large = Math.min(large, time("l"));
      small = Math.min(small, time("s"));
    }
    return Math.log(large / Math.max(small, 1)) / Math.log(4);
  }

  it("reads true linear growth as linear on a coarse clock, where one run per sample reads it as over the bound", () => {
    // 1.8 → 7.2 ms is exactly linear (exponent 1); CI failed numeric references
    // at 1.0 → 6.8 ms on a clock like this one.
    const costs = { s: 1.8, l: 7.2 };
    const before: number[] = [];
    const after: number[] = [];
    for (let seed = 1; seed <= 200; seed += 1) {
      const old = coarseClock(seed);
      before.push(uncalibratedExponent(old.clock, fixedCostRun(old.spend, costs).run));
      const fresh = coarseClock(seed);
      after.push(growthExponent(measureGrowth(fixedCostRun(fresh.spend, costs).run, "s", "l", { clock: fresh.clock }), 1, 4));
    }

    expect(before.filter((e) => e >= 1.35).length).toBeGreaterThan(100);
    expect(Math.min(...after)).toBeGreaterThan(0.95);
    expect(Math.max(...after)).toBeLessThan(1.05);
  });
});
