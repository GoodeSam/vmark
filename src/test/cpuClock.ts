/**
 * Purpose: time work on the CPU clock of the thread that runs it, for tests
 *   that assert a GROWTH EXPONENT — how cost grows from a small input to a
 *   large one — rather than a duration.
 *
 * A duration measures the machine; an exponent survives contention and
 * coverage instrumentation, because neither can turn cost ∝ n into cost ∝ n².
 * That holds only while each sample bills the work being measured, and bills
 * it precisely. Three things see to it.
 *
 * **The thread's own clock** (`process.threadCpuUsage`, Node ≥ 22.19), not the
 * process's. `process.cpuUsage()` bills every thread in the process — V8's
 * parallel scavenge helpers, its concurrent marking and sweeping threads, its
 * compiler threads, any worker — and a large sample runs long enough to collect
 * more of that than a small one. Replaying the whole `htmlScaling` file under
 * coverage (1,120 readings a clock, three load levels, Node 22 and 24), the
 * process clock read the comments case — the one that failed a `check:all` —
 * at 1.42 against the 1.35 bound, with 8 readings at 1.25 or more; the thread
 * clock's worst was 1.27, with 1. With one busy thread beside the test, the
 * process clock put 67 of 300 readings over the bound, the thread clock none.
 * Where the runtime has no thread clock this falls back to the process clock,
 * and the result says which one measured.
 *
 * **Brought up to date before every read.** On Linux the thread clock is
 * `getrusage(RUSAGE_THREAD)`. Under the usual tick-based accounting it reports
 * the runtime the scheduler last accounted — up to a tick (1–10 ms) stale — while
 * `getrusage(RUSAGE_SELF)`, behind `process.cpuUsage()`, first folds the running
 * thread's pending time in (with nohz_full virtual-time accounting both are
 * already current). So each read calls `process.cpuUsage()` first. Unprimed,
 * Node 22.23.2 on a tick-accounted Linux 6.8 read 240 of 300 samples of 0.2 ms
 * work as 0, and 1 ms of work anywhere from 0 to 0.98 ms (median 0.44); primed,
 * it agreed with the process clock to a few microseconds. Unprimed, a CI run
 * failed `numeric references` at 1.39 from 1.0 → 6.8 ms samples. Windows is
 * coarser still — libuv reports thread times there in whole milliseconds, and
 * nothing here makes them finer — and no CI job runs these tests on it.
 *
 * **Samples long enough to trust, equally many, in random order.** After an
 * untimed warm-up, `measureGrowth` doubles each input's runs per sample until
 * one sample of it costs at least `minSampleMs` (20 ms): no reading is then
 * short enough for clock resolution, a stray scavenge or an interrupt to move
 * it much — the practice of Benchmark.js and tinybench. Each sample then costs
 * between the floor and twice it, or a single run where one run already costs
 * more. So the two sides' samples are within two to one of each other while
 * both inputs' runs cost less than the floor, differ by their run-cost ratio
 * once both cost more, and fall anywhere between when only one does. Each
 * round takes one sample of each input in random order, so both sides get as
 * many chances at a clean sample and no periodic cost stays lined up with one
 * side; what lands on samples in proportion to their length (a collection
 * every so many allocations, a sibling thread, a preempted VM) is evened out
 * only as far as their lengths are. One repeat count for both made the large
 * sample four to eight times longer even for sub-millisecond runs; two small
 * samples a round gave the small side twice the chances; a fixed order let a
 * periodic cost line up with one side every time.
 * Not every time is not never: a periodic cost can still land on one side by
 * chance, one pause per sample, moving the exponent by up to
 * log(1 + pause / sample) / log(size ratio) — which is why samples are long.
 * (GC pauses took 0–6% of the CPU of these suites' measurements; that is an
 * observation about them, not a bound on any one pause.) The minimum of each
 * side, divided by its runs, is the cost of one run; a side whose cheapest
 * sample still fell short is re-measured with more runs. `growthExponent`
 * turns the two costs into an exponent: 1 is linear, 2 quadratic.
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
  /** Minimum CPU milliseconds of one run of the small input. */
  readonly smallMs: number;
  /** Minimum CPU milliseconds of one run of the large input. */
  readonly largeMs: number;
  /** Runs per timed sample of each input, calibrated so a sample costs `minSampleMs`. */
  readonly repeats: { readonly small: number; readonly large: number };
  /** Which clock measured — `process` means the fallback, which bills other threads. */
  readonly clock: CpuClockKind;
}

/** The CPU cost a timed sample must reach, by repeating its run. */
const MIN_SAMPLE_MS = 20;
/** Beyond this many runs per sample the input costs nothing measurable. */
const MAX_REPEATS = 2 ** 20;

function repeat<T>(run: (input: T) => void, input: T, times: number): void {
  for (let i = 0; i < times; i += 1) run(input);
}

function tooFew(times: number, minSampleMs: number): never {
  throw new RangeError(`${times} runs of an input cost under ${minSampleMs} ms of CPU: nothing to measure`);
}

/** The fewest doublings of runs per sample for one sample of `input` to cost `minSampleMs`. */
function calibrate<T>(run: (input: T) => void, input: T, clock: CpuClock, minSampleMs: number): number {
  for (let repeats = 1; repeats <= MAX_REPEATS; repeats *= 2) {
    if (cpuMs(() => repeat(run, input, repeats), clock) >= minSampleMs) return repeats;
  }
  return tooFew(MAX_REPEATS, minSampleMs);
}

/** Twice the runs per sample, for a side whose cheapest sample fell short. */
function moreRepeats(repeats: number, minSampleMs: number): number {
  return repeats * 2 <= MAX_REPEATS ? repeats * 2 : tooFew(repeats, minSampleMs);
}

/**
 * Minimum CPU cost of one run of `run` on each input: an untimed warm-up on
 * `small` (JIT, caches); a calibration of each input's runs per sample (see
 * the header); then `rounds` rounds of one sample of each, in an order drawn
 * from `random`. A burst of contention inflates one sample, not the answer.
 * If either side's cheapest sample still fell short of `minSampleMs` — a
 * calibration sample inflated by a collection or an interrupt picks too few
 * runs — that side's runs grow and every round is measured again.
 */
export function measureGrowth<T>(
  run: (input: T) => void,
  small: T,
  large: T,
  {
    rounds = 5,
    clock = CPU_CLOCK,
    minSampleMs = MIN_SAMPLE_MS,
    random = Math.random,
  }: { rounds?: number; clock?: CpuClock; minSampleMs?: number; random?: () => number } = {},
): Growth {
  if (!Number.isInteger(rounds) || rounds < 1) throw new RangeError(`rounds must be a positive integer, got ${rounds}`);
  if (!(Number.isFinite(minSampleMs) && minSampleMs >= 0)) {
    throw new RangeError(`minSampleMs must be a finite, non-negative number, got ${minSampleMs}`);
  }
  run(small);
  let smallRepeats = calibrate(run, small, clock, minSampleMs);
  let largeRepeats = calibrate(run, large, clock, minSampleMs);
  for (;;) {
    const sample = (input: T, times: number) => cpuMs(() => repeat(run, input, times), clock);
    let smallSample = Number.POSITIVE_INFINITY;
    let largeSample = Number.POSITIVE_INFINITY;
    for (let round = 0; round < rounds; round += 1) {
      const smallFirst = random() < 0.5;
      if (smallFirst) smallSample = Math.min(smallSample, sample(small, smallRepeats));
      largeSample = Math.min(largeSample, sample(large, largeRepeats));
      if (!smallFirst) smallSample = Math.min(smallSample, sample(small, smallRepeats));
    }
    const smallShort = smallSample < minSampleMs;
    const largeShort = largeSample < minSampleMs;
    if (!smallShort && !largeShort) {
      return {
        smallMs: smallSample / smallRepeats,
        largeMs: largeSample / largeRepeats,
        repeats: { small: smallRepeats, large: largeRepeats },
        clock: clock.kind,
      };
    }
    if (smallShort) smallRepeats = moreRepeats(smallRepeats, minSampleMs);
    if (largeShort) largeRepeats = moreRepeats(largeRepeats, minSampleMs);
  }
}

/**
 * The exponent k in cost ∝ size^k between the two inputs: 1 is linear, 2 is
 * quadratic. Costs are taken as measured — `measureGrowth` has already made
 * every sample long enough to trust — and must be positive.
 */
export function growthExponent(growth: Growth, smallSize: number, largeSize: number): number {
  if (!(smallSize > 0 && largeSize > smallSize)) {
    throw new RangeError(`sizes must satisfy 0 < small < large, got ${smallSize} → ${largeSize}`);
  }
  if (!(growth.smallMs > 0 && growth.largeMs > 0)) {
    throw new RangeError(`costs must be positive, got ${growth.smallMs} → ${growth.largeMs} ms`);
  }
  return Math.log(growth.largeMs / growth.smallMs) / Math.log(largeSize / smallSize);
}
