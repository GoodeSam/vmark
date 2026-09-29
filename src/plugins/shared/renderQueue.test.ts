import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRenderQueue, distanceToVisible, FRAME_LIMIT, type QueuedRender } from "./renderQueue";
import { installFakeAnimationFrames, type FakeAnimationFrames } from "@/test/fakeAnimationFrames";

interface Item extends QueuedRender {
  name: string;
}

let frames: FakeAnimationFrames;

beforeEach(() => {
  frames = installFakeAnimationFrames();
  vi.stubGlobal("CSS", { supports: () => true }); // native anchoring: no view-holding here
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function scroller(scrollTop = 0): HTMLElement {
  const root = document.createElement("div");
  Object.defineProperty(root, "scrollTop", { configurable: true, value: scrollTop, writable: true });
  root.getBoundingClientRect = () => new DOMRect(0, 0, 800, 900);
  return root;
}

function item(root: Element, name: string, distance: number, measuredAt = 0, top = distance): Item {
  const block = document.createElement("p");
  block.getBoundingClientRect = () => new DOMRect(0, top, 800, 20);
  return { root, block, name, distance, measuredAt };
}

describe("distanceToVisible", () => {
  const visible = new DOMRect(0, 100, 800, 500); // 100..600
  it.each([
    ["above", new DOMRect(0, 0, 800, 40), 60],
    ["touching the top", new DOMRect(0, 60, 800, 40), 0],
    ["inside", new DOMRect(0, 300, 800, 40), 0],
    ["straddling the bottom", new DOMRect(0, 580, 800, 40), 0],
    ["below", new DOMRect(0, 700, 800, 40), 100],
  ])("%s", (_label, rect, expected) => {
    expect(distanceToVisible(rect, visible)).toBe(expected);
  });
});

describe("createRenderQueue", () => {
  it("runs nearest first, keeping insertion order among equals, on the next frame", () => {
    const root = scroller();
    const ran: string[] = [];
    const queue = createRenderQueue<Item>({ run: (i) => ran.push(i.name), expire: vi.fn(), marginPx: 2000, budgetMs: 6 });

    queue.add([item(root, "far", 800), item(root, "near-a", 0), item(root, "near-b", 0)]);
    expect(ran).toEqual([]);
    frames.runFrame();

    expect(ran).toEqual(["near-a", "near-b", "far"]);
    expect(frames.pending()).toBe(0);
  });

  it("runs at least one item a frame however slow, and no more than the budget allows", () => {
    const root = scroller();
    const ran: string[] = [];
    const queue = createRenderQueue<Item>({
      run: (i) => {
        ran.push(i.name);
        frames.advance(4);
      },
      expire: vi.fn(),
      marginPx: 2000,
      budgetMs: 6,
    });

    queue.add([item(root, "a", 0), item(root, "b", 0), item(root, "c", 0)]);
    frames.runFrame();
    expect(ran).toEqual(["a", "b"]); // 4 ms, then 8 ms: past the 6 ms budget
    frames.runFrame();
    expect(ran).toEqual(["a", "b", "c"]);
  });

  it(`runs at most ${FRAME_LIMIT} items in one frame even when they cost nothing`, () => {
    const root = scroller();
    let ran = 0;
    const queue = createRenderQueue<Item>({ run: () => void (ran += 1), expire: vi.fn(), marginPx: 2000, budgetMs: 6 });

    queue.add(Array.from({ length: FRAME_LIMIT + 10 }, (_, i) => item(root, `i${i}`, 0)));
    frames.runFrame();
    expect(ran).toBe(FRAME_LIMIT);
    frames.runFrame();
    expect(ran).toBe(FRAME_LIMIT + 10);
  });

  it("takes and drains a batch far larger than a call's argument limit", () => {
    // One paragraph of `$a$ ` repeated is one block, and every formula in it
    // comes due in one batch; spreading that into push() threw a RangeError
    // (JavaScriptCore caps a call near 65,536 arguments) and lost them all.
    const root = scroller();
    let ran = 0;
    const queue = createRenderQueue<Item>({ run: () => void (ran += 1), expire: vi.fn(), marginPx: 2000, budgetMs: 6 });
    const block = document.createElement("p");
    block.getBoundingClientRect = () => new DOMRect(0, 0, 800, 20);
    const batch = Array.from({ length: 150_000 }, (_, i) => ({ root, block, name: `f${i}`, distance: 0, measuredAt: 0 }));

    expect(() => queue.add(batch)).not.toThrow();
    while (frames.pending() > 0) frames.runFrame();

    expect(ran).toBe(150_000);
  });

  it("drops a removed item, and reports whether it was queued", () => {
    const root = scroller();
    const ran: string[] = [];
    const queue = createRenderQueue<Item>({ run: (i) => ran.push(i.name), expire: vi.fn(), marginPx: 2000, budgetMs: 6 });
    const gone = item(root, "gone", 0);

    queue.add([gone, item(root, "kept", 0)]);
    expect(queue.remove(gone)).toBe(true);
    expect(queue.remove(gone)).toBe(false);
    frames.runFrame();

    expect(ran).toEqual(["kept"]);
  });

  it("forgets everything on clear, including the scheduled frame", () => {
    const root = scroller();
    const run = vi.fn();
    const queue = createRenderQueue<Item>({ run, expire: vi.fn(), marginPx: 2000, budgetMs: 6 });

    queue.add([item(root, "a", 0)]);
    queue.clear();
    frames.runFrame();
    queue.add([item(root, "b", 0)]);
    frames.runFrame();

    expect(run.mock.calls.map(([i]) => (i as Item).name)).toEqual(["b"]);
  });

  it("re-measures items whose scroller moved, and expires the ones now past the margin", () => {
    const root = scroller(0);
    const ran: string[] = [];
    const expired: string[] = [];
    const queue = createRenderQueue<Item>({
      run: (i) => ran.push(i.name),
      expire: (i) => expired.push(i.name),
      marginPx: 2000,
      budgetMs: 6,
    });
    // Measured at scrollTop 0; the reader has since moved, and the blocks with them.
    const leftBehind = item(root, "left-behind", 0, 0, -5000);
    const nowVisible = item(root, "now-visible", 900, 0, 200);

    queue.add([leftBehind, nowVisible]);
    root.scrollTop = 5000;
    frames.runFrame();

    expect(expired).toEqual(["left-behind"]);
    expect(ran).toEqual(["now-visible"]);
    expect(nowVisible.distance).toBe(0);
    expect(nowVisible.measuredAt).toBe(5000);
  });

  it("leaves items alone while their scroller has not moved", () => {
    const root = scroller(300);
    const expire = vi.fn();
    const queue = createRenderQueue<Item>({ run: vi.fn(), expire, marginPx: 2000, budgetMs: 6 });

    queue.add([item(root, "stale-looking", 1500, 300, -9000)]); // rect disagrees, scroll did not move
    frames.runFrame();

    expect(expire).not.toHaveBeenCalled();
  });
});
