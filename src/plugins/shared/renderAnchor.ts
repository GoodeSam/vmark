/**
 * Purpose: keep what the reader sees still when deferred renders change the
 * height of blocks ABOVE the visible part of the scroller, on engines that do
 * not do this themselves.
 *
 * CSS scroll anchoring (`overflow-anchor: auto`) holds the view in Chromium,
 * Firefox and Safari 27+. WKWebView before macOS 27 and WebKitGTK have none,
 * so a formula rendered above the viewport — which happens whenever the
 * reader scrolls UP through content not rendered yet, e.g. after an outline
 * jump — pushed the visible text down by whatever height it gained.
 *
 * Key decisions:
 *   - Measure, before a frame's renders, the height of each queued block that
 *     lies ENTIRELY above the scroller's visible top; after them, scroll by
 *     what those blocks gained or lost. Changes inside or below the visible
 *     box are the reader's to see, as with native anchoring.
 *   - Two layouts per frame, one of them clean: the forced one after the
 *     renders is the layout the next frame would have run anyway.
 *   - Only where the engine does not anchor: CSS.supports says it can and the
 *     scroller's computed `overflow-anchor` is not `none` means the engine
 *     already holds the view, and correcting too would move it twice.
 *   - At most MEASURE_LIMIT queued items per frame: a fling can queue
 *     thousands, and no frame budget runs that many.
 *
 * Known limitations:
 *   - A block that straddles the visible top is not corrected when it changes
 *     above the edge.
 *   - Renders that finish asynchronously — the first ones of a session, while
 *     KaTeX's chunk loads — land outside the frame and are not corrected.
 *
 * @coordinates-with plugins/shared/nearViewport.ts — measures before and corrects after each frame's renders
 * @module plugins/shared/renderAnchor
 */

/** Queued items looked at per frame. */
const MEASURE_LIMIT = 256;

/** A queued render: the scroller it is deferred against and its top-level block. */
export interface AnchorItem {
  readonly root: Element;
  readonly block: Element | null;
}

/** Per scroller, the blocks found entirely above its visible top, with their heights. */
export type AboveViewport = Map<Element, Map<Element, number>>;

/** Whether the engine keeps `root`'s visible content still by itself. */
function anchorsNatively(root: Element): boolean {
  const engineAnchors = typeof CSS !== "undefined" && typeof CSS?.supports === "function" && CSS.supports("overflow-anchor", "auto");
  return engineAnchors && getComputedStyle(root).overflowAnchor !== "none";
}

/** Heights of the blocks among `items` that lie entirely above their scroller's visible top. */
export function measureAboveViewport(items: Iterable<AnchorItem>, limit = MEASURE_LIMIT): AboveViewport {
  const measured: AboveViewport = new Map();
  const edges = new Map<Element, number | null>(); // null: the engine anchors this root
  let seen = 0;
  for (const { root, block } of items) {
    if (seen++ >= limit) break;
    if (!block) continue;
    let edge = edges.get(root);
    if (edge === undefined) {
      edge = anchorsNatively(root) ? null : root.getBoundingClientRect().top;
      edges.set(root, edge);
    }
    if (edge === null || measured.get(root)?.has(block)) continue;
    const rect = block.getBoundingClientRect();
    if (rect.bottom > edge) continue; // reaches into the visible box
    let blocks = measured.get(root);
    if (!blocks) {
      blocks = new Map();
      measured.set(root, blocks);
    }
    blocks.set(block, rect.height);
  }
  return measured;
}

/** Scroll each scroller by what its measured blocks gained, so its visible content stays put. */
export function holdViewStill(measured: AboveViewport): void {
  for (const [root, blocks] of measured) {
    let gained = 0;
    for (const [block, height] of blocks) {
      if (block.isConnected) gained += block.getBoundingClientRect().height - height;
    }
    if (gained !== 0) root.scrollTop += gained;
  }
}
