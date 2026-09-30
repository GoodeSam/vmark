/**
 * useContentVisibilityMode
 *
 * Purpose: set the WYSIWYG container's content-visibility classes outside
 * edits — `.cv-enabled` (this editor uses content-visibility; editor.css
 * scopes the sizing rule to it) and `.cv-idle` (it applies right now). Edits
 * go through suppressCvIdleDuringEdit from onUpdate. This module covers the
 * rest: mount, the editor being hidden and shown (keepBothEditorsAlive), and
 * document loads that cross the size threshold (followContentReplacement,
 * wired to useEditor's onTransaction).
 *
 * Key decisions:
 *   - Mount decides from the markdown length (the document is parsed later)
 *     and sets both classes at once in a layout effect, before the first paint
 *     and the deferred parse — no block has a size to remember yet.
 *   - After mount, decisions read the editor's final ProseMirror document, as
 *     onUpdate does — not a load's root transaction, which plugins append to.
 *     Loads are the transactions marked preventUpdate — onCreate's parse, its
 *     drift re-sync, content syncs, reloads — the same convention
 *     plugins/blankLinesGuard relies on. Triggering on the transaction, not React
 *     state, catches a load however it was triggered, and a flush of the
 *     serialized markdown (whose length differs near the threshold) can never
 *     overrule an edit's decision. A crossing takes an edit's transition — on:
 *     the marker now, `.cv-idle` after the idle window, once every block's
 *     size is on record (#1472); off: both go, with the pending re-add.
 *   - A re-add comes a full idle window after the blocks last changed, while
 *     they are shown. A load restarts a pending window. Hiding cancels it — a
 *     hidden block is not rendered, so the window could not record its size —
 *     and so does a load while hidden (onCreate's parse can run then); showing
 *     starts a fresh window when the marker is on and `.cv-idle` is off. Hide
 *     and show run in a layout effect, in the commit that toggles display:none.
 *   - TiptapEditor's className never names these classes: a re-render that
 *     changed it would overwrite them.
 *
 * @coordinates-with tiptapEditorHelpers.ts — the classes and their transitions
 * @coordinates-with TiptapEditor.tsx — sole consumer; owns the refs, wires onTransaction
 * @coordinates-with editor.css — the rules the classes switch
 * @module components/Editor/useContentVisibilityMode
 */
import { useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { Transaction } from "@tiptap/pm/state";
import {
  applyContentVisibilityAtMount,
  CV_ENABLED_CLASS,
  followContentVisibility,
  usesContentVisibility,
} from "./tiptapEditorHelpers";

interface ContentVisibilityModeParams {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  /** The store's markdown at mount: the only decision made before the parse. */
  content: string;
  hidden: boolean;
  cvIdleTimeoutRef: MutableRefObject<number | null>;
}

/** Set the content-visibility classes at mount, and pause the idle re-add while hidden. */
export function useContentVisibilityMode({
  containerRef,
  content,
  hidden,
  cvIdleTimeoutRef,
}: ContentVisibilityModeParams): void {
  const enabledAtMount = useRef(usesContentVisibility(content.length));
  const wasHidden = useRef(hidden);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container) applyContentVisibilityAtMount(container, enabledAtMount.current);
  }, [containerRef]);

  useLayoutEffect(() => {
    if (hidden === wasHidden.current) return;
    wasHidden.current = hidden;
    if (hidden) {
      cancelReAdd(cvIdleTimeoutRef);
      return;
    }
    const marked = containerRef.current?.classList.contains(CV_ENABLED_CLASS) ?? false;
    followContentVisibility(containerRef, marked, cvIdleTimeoutRef);
  }, [containerRef, hidden, cvIdleTimeoutRef]);
}

/** An onTransaction event: the root transaction, and the editor holding the final document. */
interface TransactionEvent {
  editor: { state: { doc: { content: { size: number } } } };
  transaction: Transaction;
}

/**
 * Follow a document load across the threshold — any transaction marked
 * preventUpdate that changed the document (edits go through onUpdate). The
 * size is the editor's, not the root transaction's: plugins append changes
 * to a load (the footnote plugin deletes an orphaned definition). A load
 * restarts a pending idle window, so the re-add comes a full window after the
 * blocks it replaced; a hidden editor gets no re-add until it is shown.
 */
export function followContentReplacement(
  containerRef: MutableRefObject<HTMLDivElement | null>,
  { editor, transaction }: TransactionEvent,
  cvIdleTimeoutRef: MutableRefObject<number | null>,
  hidden = false,
): void {
  if (!transaction.docChanged || !transaction.getMeta("preventUpdate")) return;
  cancelReAdd(cvIdleTimeoutRef);
  followContentVisibility(containerRef, usesContentVisibility(editor.state.doc.content.size), cvIdleTimeoutRef);
  if (hidden) cancelReAdd(cvIdleTimeoutRef);
}

function cancelReAdd(cvIdleTimeoutRef: MutableRefObject<number | null>): void {
  if (cvIdleTimeoutRef.current !== null) window.clearTimeout(cvIdleTimeoutRef.current);
  cvIdleTimeoutRef.current = null;
}
