/**
 * Hand-driven animation frames for jsdom tests of frame-budgeted code.
 *
 * Frame callbacks queue until the test calls `runFrame()`, and
 * `performance.now()` is pinned, so a per-frame time budget never runs out on
 * its own. Without the pin, a test asserting that several cheap renders share
 * one frame passes when run alone and fails in a loaded parallel run: the wall
 * clock crosses the budget between two renders, and the second waits a frame.
 * A test about the budget itself moves the clock with `advance()`.
 *
 * Restore with `vi.unstubAllGlobals()` and `vi.restoreAllMocks()`.
 *
 * @coordinates-with plugins/shared/nearViewport.ts — the frame-budgeted queue these tests drive
 * @module test/fakeAnimationFrames
 */
import { vi } from "vitest";

export interface FakeAnimationFrames {
  /** Run every callback queued so far; callbacks they queue wait for the next call. */
  runFrame(): void;
  /** Callbacks queued for the next frame. */
  pending(): number;
  /** Move the pinned clock forward. */
  advance(ms: number): void;
}

export function installFakeAnimationFrames(): FakeAnimationFrames {
  let now = 0;
  let queued: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queued.push(callback);
    return queued.length;
  });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  return {
    runFrame() {
      const due = queued;
      queued = [];
      for (const callback of due) callback(now);
    },
    pending: () => queued.length,
    advance(ms: number) {
      now += ms;
    },
  };
}
