/**
 * Purpose: keep the mounted WYSIWYG editor and the document store in step
 * while a bridge handler reads or replaces a document.
 *
 * The store is what the bridge reads and saves, but while a tab is open in
 * WYSIWYG mode the EDITOR holds the truth and the store trails it: keystrokes
 * reach the store on a debounced flush (a frame for small documents, seconds
 * for large ones), and the store's text is the editor's serialization, not
 * whatever text was loaded into it. A handler that ignores either fact reports
 * a state that stops being true a frame later.
 *
 * Key decisions:
 *   - Flush BEFORE reading. `flushLiveEditors` brings pending keystrokes into
 *     the store (bumping the revision as an edit does), so a read returns what
 *     the user sees, a save writes it, and a write based on an older read is
 *     refused as stale instead of silently replacing typing it never saw.
 *   - A replaced document is a LOAD, not typing. The transaction carries
 *     `preventUpdate`, the mark the editor's own content loads use, so the
 *     editor does not schedule a flush that would write its re-serialization
 *     back as a user edit — which re-dirtied a document one frame after it was
 *     reported saved. It stays in the undo history: the user can undo an AI
 *     write.
 *   - Flush AFTER loading. The store then holds exactly the text the editor
 *     serializes to, and the editor knows the store holds it, so its content
 *     sync does not load the same document a second time. That reload was a
 *     further document transaction, and the revision tracker counts every one,
 *     so the revision a handler had just returned was stale on arrival.
 *     The consequence is deliberate: for the live WYSIWYG tab the buffer — and
 *     so what gets saved — is the editor's serialization of the client's text,
 *     not its exact characters. Disk, store and editor then agree, which no
 *     other choice can offer while the editor holds a parsed document.
 *
 * Known limitations:
 *   - Only the editor registered as the active WYSIWYG editor is loaded
 *     directly. A tab that is also mounted in an unfocused split pane is
 *     updated by that editor's own content sync, whose reload the revision
 *     tracker still counts as a change.
 *
 * @coordinates-with utils/wysiwygFlush.ts — the flusher registry
 * @coordinates-with components/Editor/useTiptapFlush.ts — what a flush does
 * @coordinates-with components/Editor/tiptapEditorHelpers.ts — the editor's own content loads
 * @coordinates-with services/mcpBridge/revisionTracker.ts — bumps on every document transaction
 * @module services/mcpBridge/v2/liveEditor
 */
import { useEditorStore } from "@/stores/editorStore";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { flushAllWysiwygNow } from "@/utils/wysiwygFlush";
import { getSerializeOptions } from "@/plugins/toolbarActions/wysiwygAdapterUtils";
import { mcpBridgeLog } from "@/utils/debug";

/**
 * Bring the document store up to date with every mounted WYSIWYG editor.
 * Call before a handler reads a tab's content, dirty flag or revision.
 */
export function flushLiveEditors(): void {
  flushAllWysiwygNow();
}

/**
 * Show `content` in the live WYSIWYG editor, if `tabId` is the tab it is
 * showing, and bring the store to the text the editor now holds.
 *
 * Returns whether the editor took the content. `false` means the store keeps
 * whatever the caller put there: the tab is in the background or in Source
 * mode (the live editor shows a different document, and dispatching into it
 * would replace that one), or the content could not be parsed — the editor
 * then keeps its old document and its own content sync reports the tab as
 * unparseable and moves it to Source mode.
 */
export function loadIntoLiveWysiwyg(tabId: string, content: string): boolean {
  const { tiptap, active } = useEditorStore.getState();
  const editor = tiptap.editor;
  if (!editor || active.activeWysiwygTabId !== tabId) return false;
  try {
    const next = parseMarkdown(editor.schema, content, {
      preserveLineBreaks: getSerializeOptions().preserveLineBreaks,
    });
    const view = editor.view;
    view.dispatch(
      view.state.tr
        .replaceWith(0, view.state.doc.content.size, next.content)
        .setMeta("addToHistory", true)
        .setMeta("preventUpdate", true),
    );
  } catch (error) {
    // Not flushed: the editor still holds the OLD document, and flushing it
    // would write that over the content the caller just stored.
    mcpBridgeLog("live editor did not take the written content:", error);
    return false;
  }
  flushAllWysiwygNow();
  return true;
}
