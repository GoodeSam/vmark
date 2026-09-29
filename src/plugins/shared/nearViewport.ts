/**
 * Purpose: run a node view's expensive first render only once its DOM nears
 * the visible part of the editor's scroll container — a few at a time,
 * nearest first. Rendering all 11,150 inline formulas of a 420K-char textbook
 * at open froze the main thread for 2.1 s and built 422K DOM elements.
 *
 * Key decisions:
 *   - OBSERVE the target's top-level block (child of `.ProseMirror`), not the
 *     target: under `content-visibility: auto` (large docs, not on macOS —
 *     see usesContentVisibility) nothing inside a skipped block reports until
 *     it is practically on screen. The block always has a box.
 *   - ONE IntersectionObserver per scroll root. The root is the element that
 *     actually scrolls (`editorScrollRoot.ts`): `rootMargin` only widens the
 *     root's box, and a scrolling ancestor clips everything below it.
 *   - Due renders are QUEUED (`renderQueue.ts`) and drained under a
 *     per-frame budget, nearest first: the few hundred an open brings into
 *     range was a 400 ms frame. One the reader has scrolled far from goes
 *     back to waiting for the viewport.
 *   - A node view registers before ProseMirror inserts its DOM, so the block
 *     is looked up a microtask later; a MutationObserver re-homes jobs when
 *     ProseMirror MOVES a live node view into a new block (`recreateWrapper`).
 *   - No root, or no IntersectionObserver (jsdom): run now. The off-screen
 *     export surface has no scroll container and must render everything.
 *   - Cancel (from `destroy()`) works at every stage. `flushNearViewport`
 *     runs everything outstanding and waits for every render in flight —
 *     print reads the live DOM as a finished document.
 *   - Jobs are counted onto the root (`renderMarks.ts`) for navigation scrolls.
 *
 * @coordinates-with plugins/latex/scheduleInlineMathRender.ts — the first caller
 * @coordinates-with export/useExportOperations.ts — flushes before printing the live editor
 * @coordinates-with plugins/shared/editorScrollRoot.ts — picks the root to observe against
 * @coordinates-with plugins/shared/renderMarks.ts — the root's pending/busy marks
 * @coordinates-with plugins/shared/renderQueue.ts — the order and pace of due renders
 * @coordinates-with components/Editor/editor.css — the content-visibility that hides a block's insides
 * @module plugins/shared/nearViewport
 */

import { markRoot, resetRenderMarksForTest } from "./renderMarks";
import { createRenderQueue, distanceToVisible } from "./renderQueue";

/** A deferred render: synchronous when it can be (the frame budget only sees
 *  synchronous time), a promise when it must wait (a lazily loaded renderer). */
export type DeferredRender = () => void | Promise<void>;

/** How far outside the scroller's visible box a block counts as "near":
 *  about two screens, so a formula renders well before a scroll reaches it. */
const NEAR_VIEWPORT_MARGIN_PX = 2000;
export const NEAR_VIEWPORT_MARGIN = `${NEAR_VIEWPORT_MARGIN_PX}px 0px`;

/** Synchronous render time allowed per animation frame. */
const RENDER_BUDGET_MS = 6;

type Stage = "attaching" | "observed" | "queued";

interface Job {
  target: Element;
  root: Element;
  render: DeferredRender;
  stage: Stage;
  block: Element | null; // what is observed: the target's top-level block
  distance: number; // px between the block and the visible box; 0 when visible
  measuredAt: number; // root.scrollTop when `distance` was measured
}

const observers = new WeakMap<Element, IntersectionObserver>();
/** Every outstanding job, whatever its stage. */
const jobs = new Map<Element, Job>();
/** Observed blocks and the jobs waiting on each. */
const byBlock = new Map<Element, Set<Job>>();
/** Renders that returned a promise not yet settled — several per target is possible. */
const inflight = new Set<{ target: Element; promise: Promise<void> }>();
/** One watcher per block parent (the `.ProseMirror` element). */
const parentWatchers = new WeakMap<Element, MutationObserver>();
/** Surface a render's error without stalling the queue or the flush. */
const report = (error: unknown) => queueMicrotask(() => { throw error; });

/** Keep an async render findable by flush until it settles, then run `done`. */
function follow(target: Element, result: Promise<void>, done: () => void): Promise<void> {
  const entry = { target, promise: Promise.resolve() };
  entry.promise = result.then(undefined, report).then(() => {
    done();
    inflight.delete(entry);
  });
  inflight.add(entry);
  return entry.promise;
}

/** The child of `.ProseMirror` that contains `target`, or `target` itself. */
function blockOf(target: Element): Element {
  let el = target;
  while (el.parentElement) {
    if (el.parentElement.classList.contains("ProseMirror")) return el;
    el = el.parentElement;
  }
  return target;
}

/** Run a job; its marks come off when the render has FINISHED, async included. */
function run(job: Job): void | Promise<void> {
  const { target, root } = job;
  if (jobs.get(target) === job) jobs.delete(target); // never a replacement's entry
  if (job.stage !== "queued") markRoot(root, "busy", 1); // flushed straight from waiting
  const done = () => {
    markRoot(root, "busy", -1);
    markRoot(root, "pending", -1);
  };
  let result: void | Promise<void>;
  try {
    result = job.render();
  } catch (error) {
    done();
    return report(error);
  }
  return result instanceof Promise ? follow(target, result, done) : done();
}

/** A due job the reader scrolled far from: back to waiting for the viewport. */
function returnToWaiting(job: Job): void {
  markRoot(job.root, "busy", -1);
  job.stage = "attaching";
  attach(job);
}

const queue = createRenderQueue<Job>({
  run: (job) => void run(job),
  expire: returnToWaiting,
  marginPx: NEAR_VIEWPORT_MARGIN_PX,
  budgetMs: RENDER_BUDGET_MS,
});

function handleEntries(entries: IntersectionObserverEntry[], observer: IntersectionObserver): void {
  const root = observer.root;
  let visible: DOMRectReadOnly | null = null;
  const due: Job[] = [];
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    const waiting = byBlock.get(entry.target);
    byBlock.delete(entry.target);
    if (!waiting) continue;
    if (!visible && root instanceof Element) visible = root.getBoundingClientRect();
    const distance = visible ? distanceToVisible(entry.boundingClientRect, visible) : 0;
    for (const job of waiting) {
      markRoot(job.root, "busy", 1);
      job.stage = "queued";
      job.distance = distance;
      job.measuredAt = job.root.scrollTop;
      due.push(job);
    }
  }
  queue.add(due);
}

function observerFor(root: Element): IntersectionObserver {
  let observer = observers.get(root);
  if (!observer) {
    observer = new IntersectionObserver(handleEntries, { root, rootMargin: NEAR_VIEWPORT_MARGIN });
    observers.set(root, observer);
  }
  return observer;
}

/** Re-home the waiting jobs of observed blocks that left the document tree. */
function handleBlockRemovals(records: MutationRecord[]): void {
  for (const record of records) {
    for (const removed of record.removedNodes) {
      const waiting = byBlock.get(removed as Element);
      if (!waiting) continue;
      byBlock.delete(removed as Element);
      // Once, before re-attaching: a merely MOVED block is re-observed below.
      const [first] = waiting;
      if (first) observers.get(first.root)?.unobserve(removed as Element);
      for (const job of waiting) {
        job.stage = "attaching";
        attach(job);
      }
    }
  }
}

function watchBlockParent(block: Element): void {
  const parent = block.parentElement;
  if (!parent || parentWatchers.has(parent) || typeof MutationObserver === "undefined") return;
  const watcher = new MutationObserver(handleBlockRemovals);
  watcher.observe(parent, { childList: true });
  parentWatchers.set(parent, watcher);
}

function attach(job: Job): void {
  if (jobs.get(job.target) !== job) return; // cancelled or flushed meanwhile
  const block = blockOf(job.target);
  job.block = block;
  job.stage = "observed";
  let waiting = byBlock.get(block);
  if (!waiting) {
    waiting = new Set();
    byBlock.set(block, waiting);
    observerFor(job.root).observe(block);
    watchBlockParent(block);
  }
  waiting.add(job);
}

/** Take a job that will not run out of every structure and count. */
function release(job: Job): void {
  detach(job);
  if (job.stage === "queued") markRoot(job.root, "busy", -1);
  markRoot(job.root, "pending", -1);
}

function detach(job: Job): void {
  if (job.stage === "observed" && job.block) {
    const waiting = byBlock.get(job.block);
    waiting?.delete(job);
    if (waiting && waiting.size === 0) {
      byBlock.delete(job.block);
      observers.get(job.root)?.unobserve(job.block);
    }
  } else if (job.stage === "queued") {
    queue.remove(job);
  }
}

/**
 * Run `render` once `target`'s block is near the visible part of `root`, or
 * right away when there is no `root` or no IntersectionObserver.
 *
 * Returns a cancel function. Calling it after the render ran is a no-op.
 */
export function whenNearViewport(target: Element, root: Element | null, render: DeferredRender): () => void {
  if (!root || typeof IntersectionObserver === "undefined") {
    const result = render();
    if (result instanceof Promise) void follow(target, result, () => undefined);
    return () => {};
  }
  const previous = jobs.get(target);
  if (previous) release(previous);
  const job: Job = { target, root, render, stage: "attaching", block: null, distance: 0, measuredAt: 0 };
  jobs.set(target, job);
  markRoot(root, "pending", 1);
  if (target.isConnected) attach(job);
  else queueMicrotask(() => attach(job));
  return () => {
    if (jobs.get(target) !== job) return;
    jobs.delete(target);
    release(job);
  };
}

const FLUSH_ROUNDS = 5; // bound, for renders that keep registering renders

/**
 * Run every outstanding render under `container` now and resolve once they —
 * and any already running — finish; repeats for renders registered meanwhile
 * (an edit while KaTeX loads), so the caller reads a fully rendered DOM.
 */
export async function flushNearViewport(container: Element): Promise<void> {
  for (let round = 0; round < FLUSH_ROUNDS; round += 1) {
    const due: Promise<void>[] = [];
    for (const running of inflight) {
      if (container.contains(running.target)) due.push(running.promise);
    }
    const runNow = [...jobs.values()].filter((job) => container.contains(job.target));
    for (const job of runNow) {
      if (jobs.get(job.target) !== job) continue; // replaced or cancelled by an earlier render
      detach(job);
      due.push(Promise.resolve(run(job)));
    }
    if (due.length === 0) return;
    await Promise.all(due);
  }
}

/** Test seam: forget every outstanding render and any scheduled frame. */
export function resetNearViewportForTest(): void {
  jobs.clear();
  byBlock.clear();
  inflight.clear();
  resetRenderMarksForTest();
  queue.clear();
}
