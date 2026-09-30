/**
 * cv-idle viewport lock
 *
 * Purpose: toggle the `.cv-idle` class (the content-visibility optimization
 * for large WYSIWYG documents, #823) without moving what the reader sees
 * (#1340). Flipping the class swaps `contain-intrinsic-size` estimates for
 * real block heights (and back); when the blocks ABOVE the viewport change
 * height, the content under an unchanged scrollTop shifts — on a 60K+ char
 * document, applying Bold from the toolbar threw the selection out of view.
 *
 * Key decisions:
 *   - Anchor-based compensation: measure the first block intersecting the
 *     viewport before the class flip, re-measure after, and add the delta to
 *     the scroll container's scrollTop. In the measured toggles (Chromium and
 *     WebKit) native scroll anchoring had not corrected the anchor by the
 *     re-measure, so this write is the correction on both engines, and
 *     landing the anchor first leaves the engine nothing to redo.
 *   - The write is only as good as the layout it is measured in, and a
 *     scrollTop that layout cannot hold is clamped. The re-add measures a
 *     layout in which every block the engine has not yet found relevant is
 *     skipped at its `contain-intrinsic-size`, until the engine's next
 *     rendering update. At bare 2.5em estimates that layout was far too short
 *     near the document's end, the write clamped, and the view moved by
 *     hundreds of pixels (#1472). editor.css keeps the sizing rule on outside
 *     `.cv-idle` for as long as `.cv-enabled` marks the editor, so a block
 *     skipped again comes back at the size it last rendered at and the re-add
 *     measures only what changed since.
 *   - The anchor search early-exits at the first block whose bottom clears
 *     the scroller's top edge — O(blocks above the viewport), so a full walk
 *     happens only with the reader at the document's very end. Each visited
 *     rect read is a cache hit once the first read has forced layout.
 *   - No scroller or no anchor (empty doc, everything above the viewport,
 *     detached or display:none container): just flip the class. A zero delta
 *     writes nothing.
 *   - The pre-toggle rect read happens while `.cv-idle` is still applied and
 *     the DOM is dirty from the edit, forcing one content-visibility layout
 *     pass. Deliberate: it runs only on the FIRST edit after an idle window
 *     (the per-keystroke hot path never gets here — see
 *     suppressCvIdleDuringEdit), typing transactions already force that same
 *     layout before onUpdate fires (ProseMirror's scrollToSelection reads
 *     caret coords during updateState), and the alternative — caching anchor
 *     geometry at idle time — mis-compensates any edit that changes heights
 *     above the viewport (find-and-replace, MCP document edits), trading
 *     correctness for a once-per-burst saving.
 *
 * @coordinates-with tiptapEditorHelpers.ts — suppressCvIdleDuringEdit wraps
 *   both of its class toggles (the edit-time strip and the idle re-add) here
 * @coordinates-with editor.css — the content-visibility and sizing rules
 * @module components/Editor/cvIdleViewportLock
 */
import { findScrollContainer } from "@/services/editor/scrollPosition";

/**
 * Set the presence of `.cv-idle` on `container`, compensating the scroll
 * container so the block at the top of the viewport stays put.
 */
export function setCvIdlePreservingViewport(container: HTMLElement, enabled: boolean): void {
  const scroller = findScrollContainer(container);
  const anchor = scroller ? findViewportAnchor(container, scroller) : null;
  const beforeTop = anchor ? anchor.getBoundingClientRect().top : 0;

  container.classList.toggle("cv-idle", enabled);

  if (!scroller || !anchor) return;
  // Reading the rect here forces the layout the class flip invalidated; on
  // the re-add that is the pre-relevance layout the header describes.
  const delta = anchor.getBoundingClientRect().top - beforeTop;
  if (delta !== 0) scroller.scrollTop += delta;
}

/**
 * The first `.ProseMirror > *` block, in document order, whose bottom edge
 * clears the scroller's top edge — i.e. the first block the reader can see.
 * Blocks fully above the viewport are skipped; blocks below it are never
 * measured.
 */
function findViewportAnchor(container: HTMLElement, scroller: HTMLElement): Element | null {
  const blocks = container.querySelector(".ProseMirror")?.children;
  if (!blocks || blocks.length === 0) return null;
  const viewportTop = scroller.getBoundingClientRect().top;
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i].getBoundingClientRect().bottom > viewportTop) return blocks[i];
  }
  return null;
}
