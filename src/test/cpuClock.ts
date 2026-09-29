/**
 * Purpose: time work on the CPU clock of the thread that runs it, for tests
 *   that assert a GROWTH EXPONENT — how cost grows from a small input to a
 *   large one — rather than a duration.
 *
 * A duration measures the machine; an exponent survives contention and
 * coverage instrumentation, because neither can turn cost ∝ n into cost ∝ n².
 * That holds only while each sample bills the work being measured and nothing
 * else, so the clock is **the thread's own** (`process.threadCpuUsage`, Node ≥
 * 22.19), not the process's. `process.cpuUsage()` bills every thread in the
 * process — V8's parallel scavenge helpers, its concurrent marking and
 * sweeping threads, its compiler threads, any worker — and a large sample runs
 * long enough to collect more of that than a small one. Replaying the whole
 * `htmlScaling` file under coverage (1,120 readings a clock, three load
 * levels, Node 22 and 24), the process clock read the comments case — the one
 * that failed a `check:all` — at 1.42 against the 1.35 bound, with 8 readings
 * at 1.25 or more; the thread clock's worst was 1.27, with 1. With one busy
 * thread beside the test, the process clock put 67 of 300 readings over the
 * bound, the thread clock none. Where the runtime has no thread clock this
 * falls back to the process clock, and the result says which one measured.
 *
 * **Brought up to date before every read.** On Linux the thread clock is
 * `getrusage(RUSAGE_THREAD)`, which reports the runtime the scheduler last
 * accounted — up to a tick (1–4 ms) stale; `getrusage(RUSAGE_SELF)`, behind
 * `process.cpuUsage()`, first folds the running thread's pending time in. So
 * each read calls `process.cpuUsage()` first. Unprimed, Node 22.23.2 on Linux
 * read 240 of 300 samples of 0.2 ms work as 0, and 1 ms of work anywhere from
 * 0 to 0.98 ms (median 0.44); primed, it agreed with the process clock to a few
 * microseconds. Unprimed, a CI run failed `numeric references` at 1.39 from
 * 1.0 → 6.8 ms samples.
 *
 * No garbage collection before a sample, deliberately. On the thread clock a
 * young-generation collection first took those `htmlScaling` readings at 1.25
 * or more from 1 to 6, all on a loaded machine; a full one hands milliseconds
 * of sweeping to background threads that the process clock then bills (116
 * of 300 comments readings over the bound under load). On the process-clock
 * fallback a young collection helped some suites and not `htmlScaling` on
 * Node 22's V8, and reaching `gc` at all means toggling a process-wide V8 flag,
 * which races between worker threads.
 *
 * `measureGrowth` takes the minimum of interleaved samples (small, large,
 * small per round, after an untimed warm-up), and `growthExponent` turns it
 * into an exponent: 1 is linear, 2 quadratic.
 *
 * @coordinates-with src/lib/formats/adapters/htmlScaling.test.ts
 * @coordinates-with src/utils/markdownPipeline/__tests__/pathological/pathologicalScaling.test.ts
 * @coordinates-with scripts/check-ui-consistency.test.mjs — the C12 scaling case
 * @module test/cpuClock
 */

export type CpuClockKind = "thread" | "process";

export interface CpuClock {
  readonly kind: CpuClockKind;
  /** User plus system CPU microseconds this clock has counted so far. */
  readonly readUs: () => number;
}

/** The slice of `process` a clock is read from; a parameter so the fallback is testable. */
export interface CpuUsageSource {
  cpuUsage(): NodeJS.CpuUsage;
  threadCpuUsage?(): NodeJS.CpuUsage;
}

const totalUs = (usage: NodeJS.CpuUsage): number => usage.user + usage.system;

/** The calling thread's CPU clock where `source` has one, else the whole process's. */
export function selectCpuClock(source: CpuUsageSource): CpuClock {
  const threadCpuUsage = source.threadCpuUsage;
  if (typeof threadCpuUsage === "function") {
    const readUs = () => {
      source.cpuUsage(); // Linux: account this thread's pending runtime (see header)
      return totalUs(threadCpuUsage.call(source));
    };
    return { kind: "thread", readUs };
  }
  return { kind: "process", readUs: () => totalUs(source.cpuUsage()) };
}

/** The clock samples are taken on unless a test passes its own. */
export const CPU_CLOCK: CpuClock = selectCpuClock(process);

/** CPU milliseconds `work` costs on `clock`. */
export function cpuMs(work: () => void, clock: CpuClock = CPU_CLOCK): number {
  const start = clock.readUs();
  work();
  return (clock.readUs() - start) / 1000;
}

export interface Growth {
  /** Minimum CPU milliseconds of the small input. */
  readonly smallMs: number;
  /** Minimum CPU milliseconds of the large input. */
  readonly largeMs: number;
  /** Which clock measured — `process` means the fallback, which bills other threads. */
  readonly clock: CpuClockKind;
}

/**
 * Minimum CPU cost of `run` on each input: one untimed warm-up on `small` (JIT,
 * caches), then `rounds` rounds of small, large, small. A burst of contention
 * inflates one sample, not the answer.
 */
export function measureGrowth<T>(
  run: (input: T) => void,
  small: T,
  large: T,
  { rounds = 5, clock = CPU_CLOCK }: { rounds?: number; clock?: CpuClock } = {},
): Growth {
  if (!Number.isInteger(rounds) || rounds < 1) throw new RangeError(`rounds must be a positive integer, got ${rounds}`);
  run(small);
  let smallMs = Number.POSITIVE_INFINITY;
  let largeMs = Number.POSITIVE_INFINITY;
  for (let round = 0; round < rounds; round += 1) {
    smallMs = Math.min(smallMs, cpuMs(() => run(small), clock));
    largeMs = Math.min(largeMs, cpuMs(() => run(large), clock));
    smallMs = Math.min(smallMs, cpuMs(() => run(small), clock));
  }
  return { smallMs, largeMs, clock: clock.kind };
}

/** Below this the small sample is timer resolution, not cost. */
const SMALL_FLOOR_MS = 1;

/**
 * The exponent k in cost ∝ size^k between the two inputs: 1 is linear, 2 is
 * quadratic. The small sample is floored at 1 ms, so a sub-millisecond reading
 * cannot manufacture a huge ratio; the floor can only pull k down.
 */
export function growthExponent(growth: Growth, smallSize: number, largeSize: number): number {
  if (!(smallSize > 0 && largeSize > smallSize)) {
    throw new RangeError(`sizes must satisfy 0 < small < large, got ${smallSize} → ${largeSize}`);
  }
  return Math.log(growth.largeMs / Math.max(growth.smallMs, SMALL_FLOOR_MS)) / Math.log(largeSize / smallSize);
}
