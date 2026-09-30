/**
 * Footnote DOM Utilities
 *
 * Purpose: DOM traversal and scrolling helpers for finding footnote elements
 * (references and definitions) in the rendered editor and navigating between them.
 *
 * @coordinates-with tiptap.ts — uses these for hover detection and click navigation
 * @coordinates-with FootnotePopupView.ts — uses scrollToPosition for "go to definition" action
 * @coordinates-with utils/settledScroll.ts — lands the target despite content-visibility
 * @module plugins/footnotePopup/tiptapDomUtils
 */

import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { scrollToSettled } from "@/utils/settledScroll";

const SCROLL_OFFSET_PX = 100;

/**
 * Scroll `view`'s own scroll container so `pos` sits SCROLL_OFFSET_PX below
 * its top — settled, because content-visibility moves a far target while a
 * smooth scroll is in flight (#1458).
 */
export function scrollToPosition(view: EditorView, pos: number) {
  const editorContent = view.dom.closest<HTMLElement>(".editor-content");
  if (!editorContent) return;

  const distance = () => {
    if (pos > view.state.doc.content.size) return null;
    const coords = view.coordsAtPos(pos);
    if (!coords) return null;
    return coords.top - editorContent.getBoundingClientRect().top - SCROLL_OFFSET_PX;
  };
  scrollToSettled(editorContent, distance, view.dom);
}

export function findFootnoteDefinition(view: EditorView, label: string): { content: string; pos: number } | null {
  const { doc } = view.state;
  let result: { content: string; pos: number } | null = null;

  doc.descendants((node: PMNode, pos: number) => {
    if (result) return false;
    /* v8 ignore start -- @preserve label ?? "" null branch: attrs.label is always a string in valid footnote nodes */
    if (node.type.name === "footnote_definition" && String(node.attrs.label ?? "") === label) {
    /* v8 ignore stop */
      /* v8 ignore start -- @preserve short-circuit: textContent is always non-empty in tests */
      result = { content: node.textContent.trim() || "Empty footnote", pos };
      /* v8 ignore stop */
      return false;
    }
    return true;
  });

  return result;
}

export function findFootnoteReference(view: EditorView, label: string): number | null {
  const { doc } = view.state;
  let result: number | null = null;

  doc.descendants((node: PMNode, pos: number) => {
    if (result !== null) return false;
    /* v8 ignore next -- @preserve null-coalesce: footnote_reference label is always set in tests */
    if (node.type.name === "footnote_reference" && String(node.attrs.label ?? "") === label) {
      result = pos;
      return false;
    }
    return true;
  });

  return result;
}

const FOOTNOTE_REF_SELECTOR = 'sup[data-type="footnote_reference"]';
const FOOTNOTE_DEF_SELECTOR = 'dl[data-type="footnote_definition"]';

function getClosestElement(target: EventTarget | null, selector: string): HTMLElement | null {
  if (!target) return null;

  let el: Element | null = null;
  if (target instanceof Element) {
    el = target;
  } else if (target instanceof Node && target.parentElement) {
    el = target.parentElement;
  }
  if (!el) return null;

  return el.closest<HTMLElement>(selector);
}

export function getFootnoteRefFromTarget(target: EventTarget | null): HTMLElement | null {
  return getClosestElement(target, FOOTNOTE_REF_SELECTOR);
}

export function getFootnoteDefFromTarget(target: EventTarget | null): HTMLElement | null {
  return getClosestElement(target, FOOTNOTE_DEF_SELECTOR);
}

