/**
 * Purpose: find the element that actually scrolls a WYSIWYG editor, for
 * observers that need to see content before it reaches the screen.
 *
 * Key decisions:
 *   - `.editor-content` marks an interactive, scrolling editor. Outside one
 *     (the off-screen export surface) there is no root, and callers render
 *     eagerly.
 *   - Inside it, the NEAREST scrolling ancestor wins: the split view's preview
 *     pane scrolls on its own, and an IntersectionObserver rooted above the
 *     real scroller sees everything below the pane's edge as clipped.
 *   - Cached per editor DOM, and looked up again if the editor has moved out of
 *     the cached root.
 *
 * @coordinates-with plugins/shared/nearViewport.ts — observes against this root
 * @module plugins/shared/editorScrollRoot
 */

const scrollRoots = new WeakMap<Element, Element>();

/**
 * The element that scrolls the editor whose DOM is `editorDom`: its nearest
 * vertically scrolling ancestor inside `.editor-content`, else
 * `.editor-content` itself. Null outside `.editor-content` — a surface no
 * reader scrolls, such as the off-screen export surface. Cached per editor.
 */
export function editorScrollRoot(editorDom: Element | null | undefined): Element | null {
  if (!editorDom) return null;
  const cached = scrollRoots.get(editorDom);
  if (cached?.contains(editorDom)) return cached;
  const boundary = editorDom.closest(".editor-content");
  if (!boundary) return null;
  let root = boundary;
  for (let el = editorDom.parentElement; el && el !== boundary; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") {
      root = el;
      break;
    }
  }
  scrollRoots.set(editorDom, root);
  return root;
}
