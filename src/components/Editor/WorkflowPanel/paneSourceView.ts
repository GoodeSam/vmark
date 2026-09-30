/**
 * The source view that belongs to a workflow workbench's own pane (WI-LX2.4).
 *
 * Purpose: the diagnostics banner jumps its source to a line, and `JobNode`'s
 * Escape returns focus to the source. Both read the window's active source
 * view, and under a document split that can be the OTHER pane's editor — a
 * click in one workflow then moved the caret in a different document. This
 * returns the active view only when it sits in the same `.split-pane-editor`
 * as the element asking; callers fall back (select the job) otherwise.
 *
 * @coordinates-with hooks/useSourcePaneFocus.ts — how a split-pane source registers
 * @coordinates-with components/Editor/WorkflowEditor/DiagnosticsBanner.tsx — line jump
 * @coordinates-with components/Editor/WorkflowPanel/JobNode.tsx — Escape
 * @module components/Editor/WorkflowPanel/paneSourceView
 */
import type { EditorView } from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";

const PANE = ".split-pane-editor";

export function paneSourceView(from: Element | null): EditorView | null {
  const view = useEditorStore.getState().active.activeSourceView;
  if (!view?.dom?.isConnected) return null;
  const pane = from?.closest(PANE) ?? null;
  // Not inside a split pane (no pane to disagree with): the active view is
  // the only candidate there is.
  if (pane === null) return view;
  return view.dom.closest(PANE) === pane ? view : null;
}
