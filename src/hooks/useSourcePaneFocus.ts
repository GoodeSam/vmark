/**
 * useSourcePaneFocus — focused-pane gating for the Source editors (#1081).
 *
 * Returns a ref the creation effect reads to decide whether to register itself
 * as the active source view, and runs a reactive effect that re-registers when
 * split focus moves to this pane (the creation effect fires only once). No-op
 * in single-pane (always focused). Extracted from SourceEditor to keep it lean.
 *
 * Two editors use it (WI-LX2.4). The markdown `SourceEditor` registers with
 * the window's active tab and publishes the markdown cursor context. The
 * split-pane `SourcePane` (yaml, json, toml, …) used to register NOTHING, so
 * every reader of `editorStore.active.activeSourceView` — the workflow
 * diagnostics banner's line jump, `JobNode`'s Escape, undo in source mode, the
 * IME guard — found no view, or a stale one from another document. It now
 * registers under its OWN tab (`options.tabId`) and skips the cursor context,
 * which is markdown-only (`options.cursorContext: false`).
 *
 * @coordinates-with stores/editorStore.ts — active source view + context
 * @coordinates-with hooks/useIsFocusedPane.ts — focus resolution
 * @coordinates-with components/Editor/SplitPaneEditor/SourcePane.tsx — `bindSplitSourceView`
 * @module hooks/useSourcePaneFocus
 */
import { useEffect, useRef, type MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { useIsFocusedPane } from "@/hooks/useIsFocusedPane";
import { useEditorStore } from "@/stores/editorStore";
import { useTabStore } from "@/stores/tabStore";
import { computeSourceCursorContext } from "@/plugins/sourceContextDetection/cursorContext";

export interface SourcePaneFocusOptions {
  /** Register under this tab rather than the window's active tab. */
  tabId?: string;
  /** Publish the markdown cursor context (default true — markdown only). */
  cursorContext?: boolean;
}

export function useSourcePaneFocus(
  viewRef: MutableRefObject<EditorView | null>,
  windowLabel: string,
  hidden: boolean,
  options: SourcePaneFocusOptions = {},
): MutableRefObject<boolean> {
  const isFocusedPane = useIsFocusedPane(windowLabel);
  const ref = useRef(true);
  /* eslint-disable-next-line react-hooks/refs */
  ref.current = isFocusedPane;
  const { tabId: ownTabId, cursorContext = true } = options;

  useEffect(() => {
    if (hidden || !isFocusedPane) return;
    const view = viewRef.current;
    if (!view) return;
    const tabId = ownTabId ?? useTabStore.getState().activeTabId[windowLabel] ?? undefined;
    useEditorStore.getState().setActiveSourceView(view, tabId);
    if (cursorContext) {
      useEditorStore.getState().setSourceContext(computeSourceCursorContext(view), view);
    }
  }, [isFocusedPane, hidden, windowLabel, viewRef, ownTabId, cursorContext]);

  return ref;
}

/**
 * The creation-time half for a split-pane source view: register `view` now if
 * its pane is focused, and return the release its teardown must call. The
 * release forgets `view` only if it is still the registered one — another
 * pane may have taken over meanwhile.
 */
export function bindSplitSourceView(view: EditorView, tabId: string, focused: boolean): () => void {
  if (focused) useEditorStore.getState().setActiveSourceView(view, tabId);
  return () => useEditorStore.getState().clearSourceViewIfMatch(view);
}
