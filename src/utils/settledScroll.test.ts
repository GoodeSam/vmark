/**
 * Settled scroll (#1458): a navigation target lands where it was asked to be
 * even while the content around it changes height (content-visibility).
 *
 * jsdom has no layout, so the scroller is a fake whose target position the
 * test moves between frames — the thing content-visibility does for real.
 * The real-engine proof is settledScroll.webkit.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { contentMayResizeInFlight, scrollToSettled } from "./settledScroll";
import { scrollBehavior } from "./motion";

/** A scroller of `maxScroll` px whose scrollTop clamps like a real one. */
function fakeScroller(maxScroll = 100_000) {
  let top = 0;
  const scrollTo = vi.fn();
  const el = {
    ownerDocument: document,
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.max(0, Math.min(maxScroll, value));
    },
    scrollTo,
  };
  return { el: el as unknown as HTMLElement, scrollTo };
}

/** A content root whose first block reports `contentVisibility`. */
function contentRoot(contentVisibility: string): Element {
  const root = document.createElement("div");
  const block = document.createElement("p");
  block.style.setProperty("content-visibility", contentVisibility);
  root.appendChild(block);
  return root;
}

function stubComputedContentVisibility(value: string | undefined) {
  vi.spyOn(window, "getComputedStyle").mockReturnValue({ contentVisibility: value } as CSSStyleDeclaration);
}

describe("contentMayResizeInFlight", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is true when the content's blocks use content-visibility: auto", () => {
    stubComputedContentVisibility("auto");
    expect(contentMayResizeInFlight(contentRoot("auto"))).toBe(true);
  });

  it.each([["visible"], [undefined]])("is false for content-visibility %s (or an engine without it)", (value) => {
    stubComputedContentVisibility(value);
    expect(contentMayResizeInFlight(contentRoot("visible"))).toBe(false);
  });

  it("is false for a missing or empty content root", () => {
    expect(contentMayResizeInFlight(null)).toBe(false);
    expect(contentMayResizeInFlight(document.createElement("div"))).toBe(false);
  });
});

describe("scrollToSettled", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "setTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the caller's smooth scroll when nothing can resize in flight", () => {
    stubComputedContentVisibility("visible");
    const { el, scrollTo } = fakeScroller();
    el.scrollTop = 200;

    scrollToSettled(el, () => 300, contentRoot("visible"));

    expect(scrollTo).toHaveBeenCalledWith({ top: 500, behavior: scrollBehavior() });
    expect(el.scrollTop).toBe(200);
  });

  it("follows a target that moves as blocks render, until it holds still", () => {
    stubComputedContentVisibility("auto");
    const { el, scrollTo } = fakeScroller();
    // The target starts at 3000 (estimated heights) and moves as each jump
    // renders real heights above it: 3000 → 4200 → 4500, then stable.
    const positions = [3000, 4200, 4500];
    let frame = 0;
    const targetTop = () => positions[Math.min(frame, positions.length - 1)];

    scrollToSettled(el, () => targetTop() - el.scrollTop, contentRoot("auto"));
    expect(el.scrollTop).toBe(3000);
    expect(scrollTo).not.toHaveBeenCalled();

    for (let i = 0; i < 10; i += 1) {
      frame += 1;
      vi.advanceTimersToNextFrame();
    }
    expect(el.scrollTop).toBe(4500);
  });

  it("stops correcting once the reader scrolls, clicks or types", () => {
    stubComputedContentVisibility("auto");
    const { el } = fakeScroller();
    let targetTop = 3000;

    scrollToSettled(el, () => targetTop - el.scrollTop, contentRoot("auto"));
    document.dispatchEvent(new Event("wheel"));
    targetTop = 9000;
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();

    expect(el.scrollTop).toBe(3000);
  });

  it("gives up after a bounded number of frames on a target that never settles", () => {
    stubComputedContentVisibility("auto");
    const { el } = fakeScroller();
    const distance = vi.fn(() => 50);

    scrollToSettled(el, distance, contentRoot("auto"));
    for (let i = 0; i < 500; i += 1) vi.advanceTimersToNextFrame();

    expect(distance.mock.calls.length).toBeLessThanOrEqual(61);
  });

  it("stops at a scroll boundary, where the target cannot get any closer", () => {
    stubComputedContentVisibility("auto");
    const { el } = fakeScroller(1000);
    const distance = vi.fn(() => 5000 - el.scrollTop);

    scrollToSettled(el, distance, contentRoot("auto"));
    for (let i = 0; i < 20; i += 1) vi.advanceTimersToNextFrame();

    expect(el.scrollTop).toBe(1000);
    expect(distance.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("does nothing when the target is gone", () => {
    stubComputedContentVisibility("auto");
    const { el, scrollTo } = fakeScroller();
    el.scrollTop = 40;

    scrollToSettled(el, () => null, contentRoot("auto"));
    vi.advanceTimersToNextFrame();

    expect(el.scrollTop).toBe(40);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
