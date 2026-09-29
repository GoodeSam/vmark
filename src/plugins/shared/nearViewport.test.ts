import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  whenNearViewport,
  flushNearViewport,
  resetNearViewportForTest,
  NEAR_VIEWPORT_MARGIN,
} from "./nearViewport";
import { PENDING_RENDER_ATTR, RENDER_BUSY_ATTR } from "@/utils/settledScroll";
import {
  installFakeIntersectionObserver,
  onlyObserver,
  FakeIntersectionObserver,
} from "@/test/fakeIntersectionObserver";
import { installFakeAnimationFrames, type FakeAnimationFrames } from "@/test/fakeAnimationFrames";

let frames: FakeAnimationFrames;
const runFrame = () => frames.runFrame();

/** `.editor-content > .ProseMirror > blocks`, the shape the editor renders. */
function mountEditor() {
  const root = document.createElement("div");
  root.className = "editor-content";
  const pm = document.createElement("div");
  pm.className = "ProseMirror";
  root.appendChild(pm);
  document.body.appendChild(root);
  const addBlock = () => {
    const p = document.createElement("p");
    pm.appendChild(p);
    return p;
  };
  const addTarget = (block: HTMLElement) => {
    const span = document.createElement("span");
    block.appendChild(span);
    return span;
  };
  return { root, pm, addBlock, addTarget };
}

beforeEach(() => {
  resetNearViewportForTest();
  document.body.innerHTML = "";
  frames = installFakeAnimationFrames();
  installFakeIntersectionObserver();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("whenNearViewport — no deferral possible", () => {
  it("runs at once when there is no scroll root", () => {
    const render = vi.fn();
    whenNearViewport(document.createElement("span"), null, render);
    expect(render).toHaveBeenCalledTimes(1);
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it("runs at once when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { root, addBlock, addTarget } = mountEditor();
    const render = vi.fn();
    whenNearViewport(addTarget(addBlock()), root, render);
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe("whenNearViewport — deferral", () => {
  it("observes the target's top-level block with the scroll root and margin", () => {
    const { root, addBlock, addTarget } = mountEditor();
    const block = addBlock();
    const nested = document.createElement("strong");
    block.appendChild(nested);
    const target = addTarget(nested);
    const render = vi.fn();

    whenNearViewport(target, root, render);

    const observer = onlyObserver();
    expect(observer.root).toBe(root);
    expect(observer.rootMargin).toBe(NEAR_VIEWPORT_MARGIN);
    expect([...observer.observed]).toEqual([block]);
    expect(render).not.toHaveBeenCalled();
  });

  it("renders on the next frame after the block comes near", () => {
    const { root, addBlock, addTarget } = mountEditor();
    const render = vi.fn();
    whenNearViewport(addTarget(addBlock()), root, render);

    onlyObserver().trigger();
    expect(render).not.toHaveBeenCalled();
    runFrame();
    expect(render).toHaveBeenCalledTimes(1);
    expect(onlyObserver().observed.size).toBe(0);
  });

  it("waits for a target that is not in the document yet, then observes its block", async () => {
    const { root, addBlock } = mountEditor();
    const target = document.createElement("span");
    whenNearViewport(target, root, vi.fn());
    expect(FakeIntersectionObserver.instances.every((o) => o.observed.size === 0)).toBe(true);

    const block = addBlock();
    block.appendChild(target);
    await Promise.resolve();
    expect([...onlyObserver().observed]).toEqual([block]);
  });

  it("shares one observer per root and one observation per block", () => {
    const { root, addBlock, addTarget } = mountEditor();
    const block = addBlock();
    const first = vi.fn();
    const second = vi.fn();
    whenNearViewport(addTarget(block), root, first);
    whenNearViewport(addTarget(block), root, second);

    expect(onlyObserver().observed.size).toBe(1);
    onlyObserver().trigger();
    runFrame();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("renders the nearest block first, and keeps document order within a block", () => {
    const { root, addBlock, addTarget } = mountEditor();
    const far = addBlock();
    const near = addBlock();
    const order: string[] = [];
    whenNearViewport(addTarget(far), root, () => void order.push("far"));
    whenNearViewport(addTarget(near), root, () => void order.push("near-1"));
    whenNearViewport(addTarget(near), root, () => void order.push("near-2"));

    onlyObserver().trigger(undefined, (el) => (el === far ? 1500 : 100));
    runFrame();
    expect(order).toEqual(["near-1", "near-2", "far"]);
  });

  it("spreads due renders over frames under the time budget, at least one per frame", () => {
    const { root, addBlock, addTarget } = mountEditor();
    const slow = () => frames.advance(10); // each render blows the whole budget
    const renders = [vi.fn(slow), vi.fn(slow), vi.fn(slow)];
    const block = addBlock();
    for (const render of renders) whenNearViewport(addTarget(block), root, render);

    onlyObserver().trigger();
    runFrame();
    expect(renders.map((r) => r.mock.calls.length)).toEqual([1, 0, 0]);
    runFrame();
    expect(renders.map((r) => r.mock.calls.length)).toEqual([1, 1, 0]);
    runFrame();
    expect(renders.map((r) => r.mock.calls.length)).toEqual([1, 1, 1]);
    expect(frames.pending()).toBe(0);
  });
});

describe("whenNearViewport — a block moved in the DOM", () => {
  it("keeps observing a block with several waiting targets after it is removed and re-inserted", async () => {
    const { root, pm, addBlock, addTarget } = mountEditor();
    const block = addBlock();
    const first = vi.fn();
    const second = vi.fn();
    whenNearViewport(addTarget(block), root, first);
    whenNearViewport(addTarget(block), root, second);
    await Promise.resolve();

    // Moved: removed and re-inserted before the MutationObserver delivers.
    pm.removeChild(block);
    pm.appendChild(block);
    await new Promise((r) => setTimeout(r, 0));

    expect([...onlyObserver().observed]).toEqual([block]);
    onlyObserver().trigger();
    runFrame();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("whenNearViewport — cancel", () => {
  it("never renders a cancelled target, and stops observing an emptied block", () => {
    const { root, addBlock, addTarget } = mountEditor();
    const render = vi.fn();
    const cancel = whenNearViewport(addTarget(addBlock()), root, render);

    cancel();
    expect(onlyObserver().observed.size).toBe(0);
    runFrame();
    expect(render).not.toHaveBeenCalled();
  });

  it("keeps observing a block while another target in it still waits", () => {
    const { root, addBlock, addTarget } = mountEditor();
    const block = addBlock();
    const cancel = whenNearViewport(addTarget(block), root, vi.fn());
    const kept = vi.fn();
    whenNearViewport(addTarget(block), root, kept);

    cancel();
    expect([...onlyObserver().observed]).toEqual([block]);
    onlyObserver().trigger();
    runFrame();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it("pulls a render that is already queued", () => {
    const { root, addBlock, addTarget } = mountEditor();
    const render = vi.fn();
    const cancel = whenNearViewport(addTarget(addBlock()), root, render);
    onlyObserver().trigger();

    cancel();
    runFrame();
    expect(render).not.toHaveBeenCalled();
  });

  it("drops a registration cancelled before its target was attached", async () => {
    const { root, addBlock } = mountEditor();
    const target = document.createElement("span");
    const cancel = whenNearViewport(target, root, vi.fn());
    cancel();
    addBlock().appendChild(target);
    await Promise.resolve();
    expect(FakeIntersectionObserver.instances.every((o) => o.observed.size === 0)).toBe(true);
  });

  it("is a no-op after the render ran", () => {
    const { root, addBlock, addTarget } = mountEditor();
    const render = vi.fn();
    const cancel = whenNearViewport(addTarget(addBlock()), root, render);
    onlyObserver().trigger();
    runFrame();
    expect(() => cancel()).not.toThrow();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("replaces an earlier registration for the same target", () => {
    const { root, addBlock, addTarget } = mountEditor();
    const target = addTarget(addBlock());
    const stale = vi.fn();
    const fresh = vi.fn();
    whenNearViewport(target, root, stale);
    whenNearViewport(target, root, fresh);

    onlyObserver().trigger();
    runFrame();
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });
});

describe("whenNearViewport — after the reader scrolled", () => {
  it("re-ranks due renders by where their blocks are now, and sends far ones back to wait", () => {
    const { root, addBlock, addTarget } = mountEditor();
    let scrollTop = 0;
    Object.defineProperty(root, "scrollTop", { configurable: true, get: () => scrollTop });
    root.getBoundingClientRect = () => new DOMRect(0, 0, 800, 900);
    const passed = addBlock();
    const reached = addBlock();
    let passedTop = 100;
    let reachedTop = 1500;
    passed.getBoundingClientRect = () => new DOMRect(0, passedTop, 800, 40);
    reached.getBoundingClientRect = () => new DOMRect(0, reachedTop, 800, 40);
    const order: string[] = [];
    whenNearViewport(addTarget(passed), root, () => {
      order.push("passed");
      frames.advance(10); // one render per frame
    });
    whenNearViewport(addTarget(reached), root, () => {
      order.push("reached");
      frames.advance(10);
    });

    onlyObserver().trigger([passed], () => passedTop); // on screen, due
    scrollTop = 8000; // a fling, before any frame drained
    onlyObserver().trigger([reached], () => reachedTop);
    scrollTop = 9500;
    passedTop = -9400;
    reachedTop = 0;
    runFrame();

    expect(order).toEqual(["reached"]);
    expect(onlyObserver().observed.has(passed)).toBe(true);
    runFrame();
    expect(order).toEqual(["reached"]);
  });
});

describe("flushNearViewport", () => {
  it("runs waiting and queued renders inside the container and awaits async ones", async () => {
    const { root, addBlock, addTarget } = mountEditor();
    const waiting = vi.fn();
    const queued = vi.fn();
    let asyncDone = false;
    const asyncRender = vi.fn(async () => {
      await Promise.resolve();
      asyncDone = true;
    });
    whenNearViewport(addTarget(addBlock()), root, waiting);
    whenNearViewport(addTarget(addBlock()), root, asyncRender);
    const queuedTarget = addTarget(addBlock());
    whenNearViewport(queuedTarget, root, queued);
    onlyObserver().trigger([queuedTarget.parentElement!]);

    await flushNearViewport(root);

    expect(waiting).toHaveBeenCalledTimes(1);
    expect(queued).toHaveBeenCalledTimes(1);
    expect(asyncDone).toBe(true);
    expect(onlyObserver().observed.size).toBe(0);
    runFrame();
    expect(queued).toHaveBeenCalledTimes(1);
  });

  it("leaves renders outside the container alone", async () => {
    const one = mountEditor();
    const two = mountEditor();
    const inside = vi.fn();
    const outside = vi.fn();
    whenNearViewport(one.addTarget(one.addBlock()), one.root, inside);
    whenNearViewport(two.addTarget(two.addBlock()), two.root, outside);

    await flushNearViewport(one.pm);

    expect(inside).toHaveBeenCalledTimes(1);
    expect(outside).not.toHaveBeenCalled();
  });

  it("also runs renders registered while it was waiting", async () => {
    // Print awaits the flush, then reads the live DOM: a formula added while
    // KaTeX was still loading must not be serialized as source text.
    const { root, addBlock, addTarget } = mountEditor();
    let release!: () => void;
    whenNearViewport(addTarget(addBlock()), root, () => new Promise<void>((r) => { release = r; }));
    const late = vi.fn();

    const flushing = flushNearViewport(root);
    whenNearViewport(addTarget(addBlock()), root, late);
    release();
    await flushing;

    expect(late).toHaveBeenCalledTimes(1);
  });

  it("waits for every render still in flight for a target, not only the newest", async () => {
    const { root, addBlock, addTarget } = mountEditor();
    const target = addTarget(addBlock());
    let finishOld!: () => void;
    let oldDone = false;
    whenNearViewport(target, root, () => new Promise<void>((r) => { finishOld = () => { oldDone = true; r(); }; }));
    onlyObserver().trigger();
    runFrame(); // old render running (e.g. KaTeX loading)
    let finishNew!: () => void;
    whenNearViewport(target, root, () => new Promise<void>((r) => { finishNew = r; })); // source changed
    await Promise.resolve();
    onlyObserver().trigger();
    runFrame(); // new render running too
    finishNew(); // …and it finishes first
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    let flushed = false;
    const flushing = flushNearViewport(root).then(() => { flushed = true; });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(flushed).toBe(false);
    finishOld();
    await flushing;
    expect(oldDone).toBe(true);
  });

  it("waits for an async render that ran at once (no scroll root)", async () => {
    const host = document.createElement("div");
    const target = document.createElement("span");
    host.appendChild(target);
    let finish!: () => void;
    whenNearViewport(target, null, () => new Promise<void>((r) => { finish = r; }));

    let flushed = false;
    const flushing = flushNearViewport(host).then(() => { flushed = true; });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(flushed).toBe(false);
    finish();
    await flushing;
  });

  it("skips a job an earlier render replaced during the flush, and runs its replacement", async () => {
    const { root, addBlock, addTarget } = mountEditor();
    const a = addTarget(addBlock());
    const b = addTarget(addBlock());
    const staleB = vi.fn();
    const freshB = vi.fn();
    whenNearViewport(a, root, () => void whenNearViewport(b, root, freshB));
    whenNearViewport(b, root, staleB);

    await flushNearViewport(root);

    expect(staleB).not.toHaveBeenCalled();
    expect(freshB).toHaveBeenCalledTimes(1);
  });

  it("resolves at once when nothing is outstanding", async () => {
    const { root } = mountEditor();
    await expect(flushNearViewport(root)).resolves.toBeUndefined();
  });
});

describe("pending-render marker on the scroll root", () => {
  // settledScroll reads it: renders still to come change heights mid-scroll.
  it("is set while any render waits or is queued, and cleared once all ran", async () => {
    const { root, addBlock, addTarget } = mountEditor();
    const block = addBlock();
    whenNearViewport(addTarget(block), root, vi.fn());
    whenNearViewport(addTarget(block), root, vi.fn());
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(true);

    onlyObserver().trigger();
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(true); // queued, not run
    runFrame();
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(false);
  });

  it("is cleared when the last waiting render is cancelled or flushed", async () => {
    const { root, addBlock, addTarget } = mountEditor();
    const cancel = whenNearViewport(addTarget(addBlock()), root, vi.fn());
    cancel();
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(false);

    whenNearViewport(addTarget(addBlock()), root, vi.fn());
    await flushNearViewport(root);
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(false);
  });

  it("marks the root busy while a render is queued or running, and pending until it finished", async () => {
    const { root, addBlock, addTarget } = mountEditor();
    let finish!: () => void;
    whenNearViewport(addTarget(addBlock()), root, () => new Promise<void>((r) => { finish = r; }));
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(false); // waiting, not due

    onlyObserver().trigger();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(true); // queued
    runFrame();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(true); // running (e.g. KaTeX loading)
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(true);

    finish();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(root.hasAttribute(RENDER_BUSY_ATTR)).toBe(false);
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(false);
  });

  it("is never set when the render runs at once", () => {
    const root = document.createElement("div");
    vi.stubGlobal("IntersectionObserver", undefined);
    whenNearViewport(document.createElement("span"), root, vi.fn());
    expect(root.hasAttribute(PENDING_RENDER_ATTR)).toBe(false);
  });
});
