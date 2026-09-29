/**
 * Settled scroll
 *
 * Purpose: scroll a navigation target (a heading, a search match, a footnote)
 * to where it was asked to be — even while the content around it is still
 * changing height.
 *
 * Large documents lay their blocks out with `content-visibility: auto`
 * (`.cv-idle`, editor.css): an off-screen block has an ESTIMATED height until
 * it nears the viewport, then its real one. A smooth scroll computes its
 * destination once and renders every block it passes on the way, so the
 * target moves under it. Measured in real Chromium and WebKit, an outline
 * jump to a far heading ended 3,700–6,800px short, and each further click got
 * a little closer as more blocks had been rendered (#1458).
 *
 * Key decisions:
 *   - While content-visibility is active: jump instantly, then re-measure on
 *     each frame and correct until the target has held still for
 *     SETTLE_FRAMES frames, bounded by MAX_FRAMES.
 *   - Otherwise: the smooth scroll (`scrollBehavior()`), which is exact when
 *     nothing resizes in flight — small documents keep their animation.
 *   - Detection reads the engine's computed style, not a class name, so it is
 *     also right on an engine without content-visibility.
 *   - Renders deferred until they near the viewport (inline math,
 *     plugins/shared/nearViewport.ts) resize blocks mid-scroll the same way,
 *     and macOS runs large documents without content-visibility — so a
 *     scroller marked with PENDING_RENDER_ATTR also settles, and a frame
 *     while it is marked RENDER_BUSY_ATTR (a render queued or running, e.g.
 *     waiting for KaTeX to load) never counts as still, nor toward
 *     MAX_FRAMES: a busy stretch can outlast 60 frames, and stopping inside
 *     it left the target wherever the late render pushed it. MAX_BUSY_FRAMES
 *     still bounds a scroller that never stops being busy.
 *   - The reader wins: a wheel, touch, key or pointer press stops correcting.
 *
 * @coordinates-with utils/motion.ts — scrollBehavior for the smooth path
 * @coordinates-with components/Editor/editor.css — where content-visibility is applied
 * @module utils/settledScroll
 */
import { scrollBehavior } from "./motion";

/** Consecutive frames the target must hold still before correction stops. */
const SETTLE_FRAMES = 3;
/** Upper bound on correction frames (~1s), for a target that never settles. */
const MAX_FRAMES = 60;
/** Absolute bound (~10s) when renders keep the scroller busy throughout. */
const MAX_BUSY_FRAMES = 600;
const USER_GESTURES = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Present on a scroll container while node views inside it still have a render
 * waiting for the viewport (set by plugins/shared/nearViewport.ts).
 */
export const PENDING_RENDER_ATTR = "data-pending-render";

/**
 * Present on a scroll container while one of those renders is queued or
 * running — geometry near the viewport is about to change.
 */
export const RENDER_BUSY_ATTR = "data-render-busy";

/**
 * Whether blocks under `contentRoot` can change height while a scroll is in
 * flight — true when they use `content-visibility: auto`, or when `scroller`
 * still has renders waiting for the viewport.
 */
export function contentMayResizeInFlight(
  contentRoot: Element | null,
  scroller?: Element | null,
): boolean {
  if (scroller?.hasAttribute(PENDING_RENDER_ATTR)) return true;
  const block = contentRoot?.firstElementChild;
  if (!block) return false;
  return getComputedStyle(block).contentVisibility === "auto";
}

/**
 * Scroll `scroller` by `distance()` — how far it must still move for the
 * target to be in place (positive is down), or null when the target is gone.
 * `contentRoot` is the element whose children are the document's blocks.
 */
export function scrollToSettled(
  scroller: HTMLElement,
  distance: () => number | null,
  contentRoot: Element | null,
): void {
  const initial = distance();
  if (initial === null) return;

  if (!contentMayResizeInFlight(contentRoot, scroller)) {
    scroller.scrollTo({ top: scroller.scrollTop + initial, behavior: scrollBehavior() });
    return;
  }

  scroller.scrollTop += initial;

  const doc = scroller.ownerDocument;
  let frames = 0; // frames spent while no render was busy
  let total = 0;
  let still = 0;
  let stopped = false;

  const stop = () => {
    stopped = true;
    for (const type of USER_GESTURES) doc.removeEventListener(type, stop, true);
  };
  for (const type of USER_GESTURES) doc.addEventListener(type, stop, true);

  const step = () => {
    if (stopped) return;
    const remaining = distance();
    if (remaining === null) return stop();
    const before = scroller.scrollTop;
    if (Math.abs(remaining) >= 1) scroller.scrollTop = before + remaining;
    // Unmoved counts as still: either the target is in place, or the scroller
    // is at a boundary and the target cannot get any closer — unless a render
    // is still due, which can move the target after it looked settled.
    const busy = scroller.hasAttribute(RENDER_BUSY_ATTR);
    still = scroller.scrollTop === before && !busy ? still + 1 : 0;
    if (!busy) frames += 1;
    total += 1;
    if (still >= SETTLE_FRAMES || frames >= MAX_FRAMES || total >= MAX_BUSY_FRAMES) return stop();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
