/**
 * Purpose: `vmark.document.{read, write, transform}` handlers — the read/write spine of the pruned MCP surface.
 *
 *   `read` returns full content + a revision token. `write` replaces
 *   full content (optimistic-concurrency-protected via expected_revision)
 *   AND persists to disk by default — the buffer-vs-disk distinction is
 *   a VMark internal concern that has no business in the AI's reasoning
 *   loop. Set `save: false` to leave changes in-memory only (rare).
 *   `transform` runs the deterministic CJK rewriter — kept because CJK
 *   rules are too nuanced for AI prose to reimplement reliably.
 *
 * Origin: MCP pruning plan (2026-05-04, retired) ADR-1, ADR-2, ADR-4.
 *
 * Key decisions:
 *   - Full-content write, not diff. Correctness first; if large-doc
 *     cost ever proves a real problem, add `apply_diff` later.
 *   - `expected_revision` is optional. If absent, we still allow the
 *     write — useful for greenfield "AI types from scratch" flows. When
 *     present, mismatch returns STALE.
 *   - `transform` operates on the whole document, not a selection.
 *   - `write` saves to disk by default. The previous "buffer-only"
 *     behaviour caused AI agents to bypass MCP and write files directly
 *     when they noticed disk was stale — losing checkpoint history and
 *     setting up race conditions with VMark's eventual auto-save. Save
 *     failure does NOT fail the write: the buffer is updated, the
 *     response carries `saved: false` plus EITHER `save_skipped`
 *     (we didn't attempt — opt-out or untitled tab) OR `save_error`
 *     (we attempted and it was refused or rejected). The two fields are
 *     mutually exclusive so AI clients can branch without parsing free-form
 *     text.
 *   - The save is the app's own save (`bridgeSave.ts`), so the file keeps
 *     its line endings and byte-order mark, the write is atomic and ordered
 *     with every other save, and history and provenance are recorded there.
 *     What is saved is the BUFFER as this write left it — the store's
 *     canonical text, not the raw string the client sent. For the tab the
 *     live WYSIWYG editor is showing, that buffer is the editor's
 *     serialization of the client's text, so disk, store and editor agree
 *     and the reply's `saved` and `revision` stay true after the editor
 *     settles (`liveEditor.ts`).
 *   - Every handler here first flushes the mounted editors into the store,
 *     so it reads, checks and replaces what the user actually has — pending
 *     keystrokes included.
 *
 * @coordinates-with stores/documentStore/revision.ts — current revision + isCurrentRevision
 * @coordinates-with documentTransform.ts — CJK transform helpers (extracted)
 * @coordinates-with liveEditor.ts — the mounted WYSIWYG editor ↔ store seam
 * @coordinates-with stores/documentStore.ts — content + dirty state
 * @coordinates-with stores/tabStore.ts — tab → window resolution
 * @coordinates-with bridgeSave.ts — the path guard and the save pipeline
 * @coordinates-with services/coherence/mcpCapture.ts — MCP read capture; the write is captured by the save pipeline
 * @module services/mcpBridge/v2/document
 */

import { recordMcpRead } from "@/services/coherence/mcpCapture";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import {
  isWorkflowYaml,
  looksLikeWorkflowPath,
} from "@/lib/ghaWorkflow/detection";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { saveTabForBridge } from "./bridgeSave";
import { flushLiveEditors, loadIntoLiveWysiwyg } from "./liveEditor";
import { readOperationArgs } from "./readOperationArgs";
import { v2ErrorString } from "./types";
import type { DocumentKind, V2Error } from "./types";
import { useMcpStore } from "@/stores/mcpStore";
import { appendCheckpoint } from "@/stores/mcpCheckpointPersistence";
import type { CheckpointTool } from "@/stores/mcpStore";

interface ResolvedTab {
  tabId: string;
  windowLabel: string;
  filePath: string | null;
  content: string;
  dirty: boolean;
  kind: DocumentKind;
}

/**
 * Decide a tab's kind from its filePath + content. Pure helper so
 * callers can re-evaluate against incoming content (e.g. on write).
 */
function resolveKind(filePath: string | null, content: string): DocumentKind {
  if (looksLikeWorkflowPath(filePath ?? undefined)) return "yaml-workflow";
  if (isWorkflowYaml(content)) return "yaml-workflow";
  return "markdown";
}

function resolveTab(tabIdArg: string | undefined): ResolvedTab | null {
  const tabState = useTabStore.getState();
  const docState = useDocumentStore.getState();

  let tabId: string;
  let windowLabel: string;

  if (tabIdArg) {
    const owner = Object.entries(tabState.tabs).find(([, list]) =>
      list.some((t) => t.id === tabIdArg),
    );
    if (!owner) return null;
    tabId = tabIdArg;
    windowLabel = owner[0];
  } else {
    windowLabel = getCurrentWindowLabel();
    const active = tabState.activeTabId[windowLabel];
    if (!active) return null;
    tabId = active;
  }

  const doc = docState.documents[tabId];
  if (!doc) return null;

  const content = doc.content;
  const filePath = doc.filePath;
  const kind = resolveKind(filePath, content);

  return {
    tabId,
    windowLabel,
    filePath,
    content,
    dirty: doc.isDirty,
    kind,
  };
}

function structuredError(id: string, err: V2Error): Promise<void> {
  return respond({ id, success: false, error: v2ErrorString(err) });
}

/**
 * Capture a checkpoint for the just-completed MCP write. Push the
 * snapshot synchronously so callers can read it back immediately, then
 * fire the disk append asynchronously (errors are logged, never
 * surfaced — a failed history write must not break the MCP path).
 */
function recordCheckpoint(args: {
  resolved: ResolvedTab;
  tool: CheckpointTool;
  description: string;
  contentBefore: string;
  revisionBefore: string;
  revisionAfter: string;
}): void {
  const id = useMcpStore.getState().checkpointPush({
    tabId: args.resolved.tabId,
    filePath: args.resolved.filePath,
    tool: args.tool,
    description: args.description,
    contentBefore: args.contentBefore,
    revisionBefore: args.revisionBefore,
    revisionAfter: args.revisionAfter,
  });
  const cp = useMcpStore.getState().checkpointGet(id);
  if (cp) void appendCheckpoint(cp);
}

/**
 * Replace a tab's content and return the revision the document is then at.
 * Does NOT call `respond` — callers decide how to package the result.
 *
 * The store takes the content as an EDIT that keeps the document's disk
 * convention. A Markdown tab the live WYSIWYG editor is showing is then loaded
 * into that editor, which leaves the store holding the editor's serialization
 * (see `liveEditor.ts`); a background or Source-mode tab is store-only — the
 * live editor shows a different document, and dispatching into it would
 * replace that one.
 *
 * The revision is bumped HERE, last, so the token returned is by construction
 * the document's newest: nothing after this point changes the document.
 */
function writeContent(tabId: string, content: string, kind: DocumentKind): { revision: string } {
  useDocumentStore.getState().ingestExternalContent(tabId, content, "mcp-write");
  if (kind === "markdown") loadIntoLiveWysiwyg(tabId, content);
  return { revision: useRevisionStore.getState().updateRevision(tabId) };
}

/**
 * Handle `vmark.document.read`. Args: `{tabId?: string}`.
 */
export async function handleDocumentRead(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  return wrapHandler(id, async () => {
    const tabIdArg = typeof args.tabId === "string" ? args.tabId : undefined;
    flushLiveEditors();
    const resolved = resolveTab(tabIdArg);
    if (!resolved) {
      await structuredError(id, {
        error: "INVALID_TAB",
        message: "tabId could not be resolved",
      });
      return;
    }
    const revision = useRevisionStore.getState().getRevision(resolved.tabId);
    await respond({
      id,
      success: true,
      data: {
        content: resolved.content,
        revision,
        filePath: resolved.filePath,
        kind: resolved.kind,
        dirty: resolved.dirty,
      },
    });
    // Coherence (WI-1.6): only a read the client actually RECEIVED joins the
    // next write's inputs (audit T6), pinned to the content served (#133).
    if (resolved.filePath) recordMcpRead(resolved.filePath, resolved.content, resolved.tabId);
  });
}

/**
 * Handle `vmark.document.write`.
 *
 * Args: `{tabId?, content: string, expected_revision?: string, save?: boolean}`.
 *
 * `save` defaults to `true`: after the buffer is updated it is saved
 * through the app's save pipeline, which clears the dirty flag. Untitled
 * tabs (no filePath) skip the save with `saved: false` so the AI can decide
 * whether to call `workspace.save_as`. Save failure leaves the buffer
 * updated; the response surfaces `saved: false, save_error` instead of
 * throwing — re-writing on a transient FS error would lose intent.
 */
export async function handleDocumentWrite(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  return wrapHandler(id, async () => {
    // One parse against the generated contract (WI-15), not four `typeof`
    // chains restating it. Wrong runtime shape reads as absent, as before.
    const wire = readOperationArgs("vmark.document.write", args);
    if (wire.content === undefined) {
      await structuredError(id, { error: "INTERNAL", message: "content must be a string" });
      return;
    }
    const { content, tabId: tabIdArg, expected_revision: expectedRevision } = wire;
    // `save` defaults to true. AI agents shouldn't have to know about
    // VMark's buffer-vs-disk distinction; the natural mental model is
    // "I wrote the file → file is updated."
    const shouldSave = wire.save !== false;

    flushLiveEditors();
    const resolved = resolveTab(tabIdArg);
    if (!resolved) {
      await structuredError(id, {
        error: "INVALID_TAB",
        message: "tabId could not be resolved",
      });
      return;
    }

    const revisionStore = useRevisionStore.getState();
    if (
      expectedRevision !== undefined &&
      !revisionStore.isCurrentRevision(resolved.tabId, expectedRevision)
    ) {
      await structuredError(id, {
        error: "STALE",
        message: "Document has changed since the last read",
        current_revision: revisionStore.getRevision(resolved.tabId),
      });
      return;
    }

    const contentBefore = resolved.content;
    const revisionBefore = revisionStore.getRevision(resolved.tabId);
    // Re-detect kind against the INCOMING content. resolveTab read the
    // current content, which is empty for fresh untitled tabs — that
    // would default kind=markdown and run YAML writes through Tiptap's
    // markdown parser, garbling the document. The new content is the
    // authoritative source of truth at write time.
    const writeKind = resolveKind(resolved.filePath, content);
    const result = writeContent(resolved.tabId, content, writeKind);
    // The buffer this write produced, read back from the store BEFORE any
    // await: canonical text (a client may send CRLF; a live WYSIWYG editor
    // re-serializes), and this request's own — a later request can replace
    // the buffer while the save is in flight.
    const buffer = useDocumentStore.getState().documents[resolved.tabId]?.content ?? content;
    if (contentBefore !== buffer) {
      recordCheckpoint({
        resolved: { ...resolved, kind: writeKind },
        tool: "document.write",
        description: describeWrite(buffer, contentBefore),
        contentBefore,
        revisionBefore,
        revisionAfter: result.revision,
      });
    }

    // Persist to disk by default. The response carries structured fields
    // so AI clients can branch on outcome without parsing prose:
    //   - saved: true                            → buffer updated AND on disk
    //   - saved: false, save_skipped: "opt_out"  → caller passed save:false
    //   - saved: false, save_skipped: "untitled" → no filePath; call save_as
    //   - saved: false, save_error: <message>    → the save was refused or failed
    // save_skipped and save_error are mutually exclusive — the former
    // means "we never tried", the latter means "we tried and failed".
    let saved = false;
    let saveSkipped: "opt_out" | "untitled" | undefined;
    let saveError: string | undefined;
    if (!shouldSave) {
      saveSkipped = "opt_out";
    } else if (!resolved.filePath) {
      saveSkipped = "untitled";
    } else {
      const outcome = await saveTabForBridge(
        resolved.tabId,
        resolved.filePath,
        buffer,
        "document.write",
      );
      if (outcome.saved) saved = true;
      else saveError = outcome.message;
    }

    await respond({
      id,
      success: true,
      data: {
        ...result,
        saved,
        ...(saveSkipped !== undefined ? { save_skipped: saveSkipped } : {}),
        ...(saveError !== undefined ? { save_error: saveError } : {}),
      },
    });
  });
}

/** One-line summary of a `document.write` for the checkpoint panel. */
function describeWrite(after: string, before: string): string {
  const beforeBytes = before.length;
  const afterBytes = after.length;
  const delta = afterBytes - beforeBytes;
  const sign = delta >= 0 ? "+" : "−";
  const magnitude = Math.abs(delta);
  return `Wrote document (${sign}${magnitude} chars, was ${beforeBytes}, now ${afterBytes})`;
}

import { applyTransform, currentTransformSettings, isTransformKind, TRANSFORM_KINDS } from "./documentTransform";

/**
 * Handle `vmark.document.transform`.
 *
 * Args: `{tabId?, kind: "cjk-format" | "cjk-spacing" | "cjk-punctuation",
 * expected_revision?}`.
 */
export async function handleDocumentTransform(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  return wrapHandler(id, async () => {
    if (!isTransformKind(args.kind)) {
      await structuredError(id, {
        error: "INTERNAL",
        message: `kind must be one of: ${TRANSFORM_KINDS.join(", ")}`,
      });
      return;
    }
    const tabIdArg = typeof args.tabId === "string" ? args.tabId : undefined;
    const expectedRevision =
      typeof args.expected_revision === "string"
        ? args.expected_revision
        : undefined;

    flushLiveEditors();
    const resolved = resolveTab(tabIdArg);
    if (!resolved) {
      await structuredError(id, {
        error: "INVALID_TAB",
        message: "tabId could not be resolved",
      });
      return;
    }

    const revisionStore = useRevisionStore.getState();
    if (
      expectedRevision !== undefined &&
      !revisionStore.isCurrentRevision(resolved.tabId, expectedRevision)
    ) {
      await structuredError(id, {
        error: "STALE",
        message: "Document has changed since the last read",
        current_revision: revisionStore.getRevision(resolved.tabId),
      });
      return;
    }

    const transformed = applyTransform(args.kind, resolved.content, currentTransformSettings());
    if (transformed === resolved.content) {
      await respond({
        id,
        success: true,
        data: { revision: revisionStore.getRevision(resolved.tabId) },
      });
      return;
    }

    const contentBefore = resolved.content;
    const revisionBefore = revisionStore.getRevision(resolved.tabId);
    const result = writeContent(resolved.tabId, transformed, resolved.kind);
    recordCheckpoint({
      resolved,
      tool: "document.transform",
      description: `Transform: ${args.kind}`,
      contentBefore,
      revisionBefore,
      revisionAfter: result.revision,
    });
    await respond({ id, success: true, data: result });
  });
}
