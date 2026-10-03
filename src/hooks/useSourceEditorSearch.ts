/**
 * Source Editor Search Hook
 *
 * Purpose: Bridges the search store to CodeMirror's search extension —
 *   subscribes to search state changes and dispatches find/replace/count
 *   operations to the CodeMirror editor view.
 *
 * Key decisions:
 *   - After a Replace the counter follows the match CodeMirror selected: the
 *     first match at or after the end of the inserted text, wrapping to the
 *     first (the WYSIWYG rule). Keeping the old index pointed the counter at
 *     the inserted text whenever the replacement contained the query.
 *   - That counter move is not navigation: the subscriber ignores it, or it
 *     would run Next/Previous and pull the selection off the match.
 *
 * @coordinates-with stores/uiStore/searchSlice.ts — reads query, caseSensitive, regex flags
 * @coordinates-with sourceEditorSearch.ts — countMatches utility
 * @coordinates-with plugins/search/matchSelection.ts — the shared resume rule (indexAtOrAfter)
 * @module hooks/useSourceEditorSearch
 */
import { useEffect, type MutableRefObject } from "react";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  setSearchQuery,
  SearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from "@codemirror/search";
import { indexAtOrAfter } from "@/plugins/search/matchSelection";
import { useUIStore } from "@/stores/uiStore";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { countMatches } from "@/utils/sourceEditorSearch";

interface SearchState {
  query: string;
  replaceText: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  matchCount: number;
  currentIndex: number;
}

/**
 * Build a CodeMirror SearchQuery from store state.
 * Always includes replace text to avoid stale values during replace operations.
 */
function buildSearchQuery(state: SearchState): SearchQuery {
  return new SearchQuery({
    search: state.query,
    replace: state.replaceText,
    caseSensitive: state.caseSensitive,
    wholeWord: state.wholeWord,
    regexp: state.useRegex,
  });
}

/** How many matches the counter reports for `state` in the document. */
function countDocMatches(view: EditorView, state: SearchState): number {
  if (!state.query) return 0;
  return countMatches(
    view.state.doc.toString(),
    state.query,
    state.caseSensitive,
    state.wholeWord,
    state.useRegex
  );
}

/**
 * Recompute match count from document and update search store, keeping the
 * current index when it is still in range.
 */
function recomputeMatches(view: EditorView, state: SearchState): void {
  const matchCount = countDocMatches(view, state);
  let newIndex: number;
  if (matchCount === 0) {
    newIndex = -1;
  } else if (state.currentIndex < 0 || state.currentIndex >= matchCount) {
    newIndex = 0;
  } else {
    newIndex = state.currentIndex;
  }

  useUIStore.getState().searchSetMatches(matchCount, newIndex);
}

/**
 * Where the counter resumes after `replaceNext` turned `before` into `after`:
 * the END of the inserted text when a match was replaced, so a replacement
 * that contains the query is never the next match; the selection when
 * nothing was replaced (Replace only moved to the next match).
 */
function replaceResumeAnchor(before: EditorState, after: EditorState): number {
  if (after.doc === before.doc) return after.selection.main.from;
  return before.selection.main.to + (after.doc.length - before.doc.length);
}

/**
 * Recount after a Replace and point the counter at the first match starting
 * at or after `anchor`, wrapping to the first — the rule WYSIWYG search
 * applies (plugins/search/matchSelection.ts), and where CodeMirror's
 * `replaceNext` puts the selection. Positions come from CodeMirror's own
 * cursor, the engine that selected the match.
 */
function recomputeAfterReplace(view: EditorView, state: SearchState, anchor: number): void {
  const matchCount = countDocMatches(view, state);
  if (matchCount === 0) {
    useUIStore.getState().searchSetMatches(0, -1);
    return;
  }
  const matches: Array<{ from: number; to: number }> = [];
  const cursor = buildSearchQuery(state).getCursor(view.state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) matches.push(next.value);
  const index = indexAtOrAfter(matches, anchor);
  useUIStore.getState().searchSetMatches(matchCount, index >= 0 && index < matchCount ? index : 0);
}

/**
 * Subscribe to the uiStore search slice and manage CodeMirror search operations.
 */
export function useSourceEditorSearch(
  viewRef: MutableRefObject<EditorView | null>
): void {
  useEffect(() => {
    let isInitialized = false;
    // True while a Replace moves the counter to the match CodeMirror already
    // selected. The index change must not be read as Next/Previous, which
    // would move the selection away from that match.
    let syncingCounterToSelection = false;

    // Initialize search state when view becomes available
    const initSearchState = (): boolean => {
      const view = viewRef.current;
      if (!view) return false;

      const state = useUIStore.getState().search;
      if (state.isOpen && state.query) {
        recomputeMatches(view, state);
        const query = buildSearchQuery(state);
        runOrQueueCodeMirrorAction(view, () => {
          view.dispatch({ effects: setSearchQuery.of(query) });
        });
      }
      return true;
    };

    // Try immediate initialization, fall back to polling if view not ready.
    // Both timer IDs stored in an object so cleanup closures can always find them.
    const initTimers = {
      interval: null as ReturnType<typeof setInterval> | null,
      timeout: null as ReturnType<typeof setTimeout> | null,
    };

    if (!initSearchState()) {
      initTimers.interval = setInterval(() => {
        if (initSearchState()) {
          isInitialized = true;
          clearInterval(initTimers.interval!);
          initTimers.interval = null;
        }
      }, 50);

      // Safety: clear interval after max wait time
      initTimers.timeout = setTimeout(() => {
        initTimers.timeout = null;
        if (!isInitialized && initTimers.interval !== null) {
          clearInterval(initTimers.interval);
          initTimers.interval = null;
        }
      }, 500);
    } else {
      isInitialized = true;
    }

    const unsubscribe = useUIStore.subscribe((root, prevRoot) => {
      const view = viewRef.current;
      if (!view) return;
      const state = root.search;
      const prevState = prevRoot.search;

      // Update search query when search params change
      if (
        state.query !== prevState.query ||
        state.caseSensitive !== prevState.caseSensitive ||
        state.wholeWord !== prevState.wholeWord ||
        state.useRegex !== prevState.useRegex
      ) {
        if (state.query) {
          const query = buildSearchQuery(state);
          runOrQueueCodeMirrorAction(view, () => {
            view.dispatch({ effects: setSearchQuery.of(query) });
          });
          recomputeMatches(view, state);
        } else {
          // Clear search
          runOrQueueCodeMirrorAction(view, () => {
            view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
          });
          useUIStore.getState().searchSetMatches(0, -1);
        }
      }

      // Handle find next/previous. The store WRAPS on navigation (last → 0 on
      // next, 0 → last on previous), so a raw index comparison inverts at
      // every wrap: forward iff the new index is the successor of the old one
      // modulo matchCount. At matchCount 2 successor and predecessor coincide,
      // so either user action resolves to findNext — which lands on the same
      // (only other) match findPrevious would.
      if (
        !syncingCounterToSelection &&
        state.currentIndex !== prevState.currentIndex &&
        state.currentIndex >= 0
      ) {
        const forward =
          state.matchCount > 0 &&
          state.currentIndex === (prevState.currentIndex + 1) % state.matchCount;
        if (forward) {
          runOrQueueCodeMirrorAction(view, () => findNext(view));
        } else {
          runOrQueueCodeMirrorAction(view, () => findPrevious(view));
        }
      }

      // Handle replace text changes - always include in query to keep it fresh
      if (state.replaceText !== prevState.replaceText && state.isOpen && state.query) {
        const query = buildSearchQuery(state);
        runOrQueueCodeMirrorAction(view, () => {
          view.dispatch({ effects: setSearchQuery.of(query) });
        });
      }
    });

    // Handle replace actions via custom events
    const handleReplaceCurrent = (): void => {
      const view = viewRef.current;
      if (!view) return;

      runOrQueueCodeMirrorAction(view, () => {
        const before = view.state;
        replaceNext(view);
        const anchor = replaceResumeAnchor(before, view.state);
        // Update match count after replace - double rAF for state to settle
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const current = viewRef.current;
            if (!current) return;
            syncingCounterToSelection = true;
            try {
              recomputeAfterReplace(current, useUIStore.getState().search, anchor);
            } finally {
              syncingCounterToSelection = false;
            }
          });
        });
      });
    };

    const handleReplaceAll = (): void => {
      const view = viewRef.current;
      if (!view) return;

      runOrQueueCodeMirrorAction(view, () => replaceAll(view));
      // Update match count after replace all - double rAF for state to settle
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const state = useUIStore.getState().search;
          if (viewRef.current) {
            recomputeMatches(viewRef.current, state);
          }
        });
      });
    };

    window.addEventListener("search:replace-current", handleReplaceCurrent);
    window.addEventListener("search:replace-all", handleReplaceAll);

    return () => {
      if (initTimers.interval !== null) clearInterval(initTimers.interval);
      if (initTimers.timeout !== null) clearTimeout(initTimers.timeout);
      unsubscribe();
      window.removeEventListener("search:replace-current", handleReplaceCurrent);
      window.removeEventListener("search:replace-all", handleReplaceAll);
    };
  }, [viewRef]);
}
