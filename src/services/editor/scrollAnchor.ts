/**
 * Purpose: describe a reading position as CONTENT — a block and where it sat
 * against the scroller's visible top — for a remount whose layout will not
 * match the pixels of the one the reader left.
 *
 * Inline math renders only near the viewport (plugins/shared/nearViewport.ts),
 * so a remounted WYSIWYG editor shows the formulas above a remembered offset
 * as source text, at other heights than the reader left them: the same
 * scrollTop is another paragraph (#1473).
 *
 * Key decisions:
 *   - The anchor is the first top-level block whose box reaches below the
 *     visible top, found by binary search over the blocks' boxes (document
 *     order is vertical order). Any block near the top would do — what is
 *     restored is that block's offset, and everything between it and the
 *     visible top is within the render margin, so it settles to the height
 *     the reader saw.
 *   - Index among the content root's children, not a ProseMirror position:
 *     the scroll-memory layer holds no editor view, and a remount of the same
 *     document rebuilds the same blocks.
 *
 * @coordinates-with services/editor/scrollPosition.ts — records and restores it
 * @module services/editor/scrollAnchor
 */

/** A block, by index among the content root's children, and its top's offset from the visible top. */
export interface BlockAnchor {
  readonly index: number;
  readonly offset: number;
}

/** The anchor for where `container` is scrolled now, or null with no block reaching its visible top. */
export function captureBlockAnchor(container: Element, blocks: Element | null): BlockAnchor | null {
  if (!blocks) return null;
  const children = blocks.children;
  const edge = container.getBoundingClientRect().top;
  let lo = 0;
  let hi = children.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (children[mid].getBoundingClientRect().bottom > edge) hi = mid;
    else lo = mid + 1;
  }
  if (lo >= children.length) return null;
  return { index: lo, offset: children[lo].getBoundingClientRect().top - edge };
}

/** How far to scroll `container` for the anchored block to sit where it sat; null when it is gone. */
export function anchorDistance(container: Element, blocks: Element, anchor: BlockAnchor): number | null {
  const block = blocks.children[anchor.index];
  if (!block) return null;
  return block.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.offset;
}
