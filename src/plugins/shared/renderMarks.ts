/**
 * Purpose: tell navigation scrolls, through two attributes on the scroll
 * root, that deferred renders under it can still move content.
 *
 * Key decisions:
 *   - PENDING (`PENDING_RENDER_ATTR`): a render is still to come — waiting for
 *     the viewport, queued, or running. A scroll across this content cannot
 *     trust a one-shot smooth scroll, so it jumps and settles.
 *   - BUSY (`RENDER_BUSY_ATTR`): a render is queued or running right now, so
 *     geometry near the viewport is about to change and settling must not
 *     stop yet. A math document keeps formulas pending forever (nobody
 *     scrolls to all of them); busy is the part that ends.
 *   - Counted per root, and the attribute is written only on the 0 ↔ 1
 *     transitions, so the per-render cost is a Map update.
 *
 * @coordinates-with plugins/shared/nearViewport.ts — does the counting
 * @coordinates-with utils/settledScroll.ts — reads both attributes
 * @module plugins/shared/renderMarks
 */

import { PENDING_RENDER_ATTR, RENDER_BUSY_ATTR } from "@/utils/settledScroll";

export type RenderMark = "pending" | "busy";

const ATTRS: Record<RenderMark, string> = {
  pending: PENDING_RENDER_ATTR,
  busy: RENDER_BUSY_ATTR,
};

const counts: Record<RenderMark, Map<Element, number>> = {
  pending: new Map(),
  busy: new Map(),
};

/** Count one render into (+1) or out of (-1) `mark` on `root`. */
export function markRoot(root: Element, mark: RenderMark, delta: 1 | -1): void {
  const byRoot = counts[mark];
  const next = (byRoot.get(root) ?? 0) + delta;
  if (next > 0) {
    if (!byRoot.has(root)) root.setAttribute(ATTRS[mark], "");
    byRoot.set(root, next);
  } else {
    byRoot.delete(root);
    root.removeAttribute(ATTRS[mark]);
  }
}

/** Test seam: forget every count. */
export function resetRenderMarksForTest(): void {
  counts.pending.clear();
  counts.busy.clear();
}
