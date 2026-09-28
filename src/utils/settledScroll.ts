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
const USER_GESTURES = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Whether blocks under `contentRoot` can change height while a scroll is in
 * flight — true when they use `content-visibility: auto`.
 */
export function contentMayResizeInFlight(contentRoot: Element | null): boolean {
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

  if (!contentMayResizeInFlight(contentRoot)) {
    scroller.scrollTo({ top: scroller.scrollTop + initial, behavior: scrollBehavior() });
    return;
  }

  scroller.scrollTop += initial;

  const doc = scroller.ownerDocument;
  let frames = 0;
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
    // is at a boundary and the target cannot get any closer.
    still = scroller.scrollTop === before ? still + 1 : 0;
    frames += 1;
    if (still >= SETTLE_FRAMES || frames >= MAX_FRAMES) return stop();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
