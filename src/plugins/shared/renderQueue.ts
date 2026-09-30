/**
 * Purpose: the frame-budgeted queue behind nearViewport — which due render
 * runs next, and how many run in a frame. nearViewport decides WHEN a render
 * is due; this decides the order and the pace.
 *
 * Key decisions:
 *   - Nearest first, by the block's distance from the visible box. A distance
 *     is only as good as the scroll position it was measured at, so each frame
 *     re-measures the renders whose scroller has moved since. After a fling,
 *     the formulas now on screen otherwise waited behind the backlog the fling
 *     had queued on its way past.
 *   - A render whose block is now beyond the near margin is handed back
 *     (`expire`) to wait for the viewport again, rather than run where nobody
 *     is reading.
 *   - Synchronous time is budgeted per frame, with at least one render so the
 *     queue always moves.
 *
 * @coordinates-with plugins/shared/nearViewport.ts — the one user: feeds due renders in, takes expired ones back
 * @module plugins/shared/renderQueue
 */

/** A render waiting its turn. */
export interface QueuedRender {
  readonly root: Element;
  readonly block: Element | null;
  /** px between the block and the root's visible box when measured; 0 when visible. */
  distance: number;
  /** `root.scrollTop` when `distance` was measured. */
  measuredAt: number;
}

export interface RenderQueueOptions<T extends QueuedRender> {
  /** Start one render; only its synchronous part counts against the budget. */
  run(item: T): void;
  /** The item's block is beyond `marginPx` now: it is no longer queued. */
  expire(item: T): void;
  marginPx: number;
  budgetMs: number;
}

export interface RenderQueue<T extends QueuedRender> {
  add(items: readonly T[]): void;
  /** Take an item out; false if it was not queued. */
  remove(item: T): boolean;
  clear(): void;
}

/** px between `rect` and the `visible` box, vertically; 0 when they overlap. */
export function distanceToVisible(rect: DOMRectReadOnly, visible: DOMRectReadOnly): number {
  if (rect.bottom < visible.top) return visible.top - rect.bottom;
  if (rect.top > visible.bottom) return rect.top - visible.bottom;
  return 0;
}

const byDistance = (a: QueuedRender, b: QueuedRender) => a.distance - b.distance;

export function createRenderQueue<T extends QueuedRender>(options: RenderQueueOptions<T>): RenderQueue<T> {
  let queue: T[] = [];
  let scheduled = false;

  /** Re-measure what moved since it was measured; hand back what is far now. */
  function rerank(): void {
    const scrollTops = new Map<Element, number>();
    const boxes = new Map<Element, DOMRectReadOnly>();
    const box = (el: Element) => {
      let rect = boxes.get(el);
      if (!rect) boxes.set(el, (rect = el.getBoundingClientRect()));
      return rect;
    };
    let moved = false;
    const kept: T[] = [];
    for (const item of queue) {
      let scrollTop = scrollTops.get(item.root);
      if (scrollTop === undefined) scrollTops.set(item.root, (scrollTop = item.root.scrollTop));
      if (scrollTop === item.measuredAt || !item.block) {
        kept.push(item);
        continue;
      }
      moved = true;
      item.distance = distanceToVisible(box(item.block), box(item.root));
      item.measuredAt = scrollTop;
      if (item.distance > options.marginPx) options.expire(item);
      else kept.push(item);
    }
    if (!moved) return;
    queue = kept.sort(byDistance); // stable: a block's renders keep document order
  }

  function drain(): void {
    scheduled = false;
    rerank();
    const deadline = performance.now() + options.budgetMs;
    // By index, then one splice: shift() is a copy per item once a queue is
    // large. A render can only remove items not yet run, which lie after it.
    let ran = 0;
    do {
      const item = queue[ran];
      if (!item) break;
      options.run(item);
      ran += 1;
    } while (ran < queue.length && performance.now() < deadline);
    queue.splice(0, ran);
    if (queue.length > 0) schedule();
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(drain);
  }

  return {
    add(items) {
      if (items.length === 0) return;
      for (const item of items) queue.push(item); // a spread would exceed the argument limit
      queue.sort(byDistance);
      schedule();
    },
    remove(item) {
      const index = queue.indexOf(item);
      if (index === -1) return false;
      queue.splice(index, 1);
      return true;
    },
    clear() {
      queue = [];
      scheduled = false;
    },
  };
}
