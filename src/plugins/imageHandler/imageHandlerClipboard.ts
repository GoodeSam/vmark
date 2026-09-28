/**
 * Clipboard Image Paste
 *
 * Purpose: Save a pasted clipboard image into the document's `.assets/` folder
 * and insert it — whether the engine exposed the image bytes or withheld them.
 *
 * Pipeline: handlePaste -> processClipboardImage (bytes in clipboardData)
 *   or -> findPastedBlobImageSrcs + processPastedBlobImages (bytes withheld)
 *   -> saveImageToAssets -> insertBlockImageNode
 *
 * Key decisions:
 *   - Withheld bytes (#1453): WebKitGTK (upstream bug 218519) fires the paste
 *     event with an EMPTY clipboardData when the clipboard holds image bytes.
 *     ProseMirror then captures the browser's native paste into a hidden
 *     element and calls handlePaste again with the parsed slice, which holds
 *     `<img src="blob:<page origin>/<uuid>">`. Left alone, that URL is written
 *     into the markdown and is dead after a restart. Recovery keys on the
 *     slice, not the platform, so any engine that does this is covered.
 *   - Only blobs minted by THIS page's origin are claimed — they are the only
 *     ones `fetch` can read — and only when the slice is images and nothing
 *     else of substance, so real pasted content is never dropped.
 *   - One reentry guard for both paths: a paste is processed once.
 *   - Host operations (saving, inserting, the window label) arrive as a
 *     ClipboardImageHost from tiptap.ts, so this module stays inside the
 *     plugin boundary (no `@/services` import).
 *
 * @coordinates-with plugins/imageHandler/tiptap.ts — handlePaste calls into this module
 * @module plugins/imageHandler/imageHandlerClipboard
 */

import type { Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { withReentryGuard } from "@/utils/reentryGuard";
import { imageHandlerWarn } from "@/utils/debug";
import {
  generateClipboardImageFilename,
  getActiveFilePathForCurrentWindow,
  isViewConnected,
  showUnsavedDocWarning,
} from "./imageHandlerUtils";

/** Host operations a clipboard paste needs, supplied by tiptap.ts. */
export interface ClipboardImageHost {
  windowLabel: () => string;
  saveImageToAssets: (bytes: Uint8Array, filename: string, documentPath: string) => Promise<string>;
  insertBlockImageNode: (view: EditorView, relativePath: string) => void;
}

const CLIPBOARD_IMAGE_GUARD = "clipboard-image";
const IMAGE_NODE_TYPES = new Set(["image", "block_image"]);

interface ClipboardImage {
  bytes: Uint8Array;
  /** Original name; only its extension is kept. */
  name: string;
}

/**
 * Save each image to the active document's assets folder and insert it, in
 * order. Each source yields an image (null skips it); a rejection stops the
 * paste there. The first source runs synchronously, before any await, which
 * a DataTransferItem needs: it goes dead once the paste event returns.
 */
async function saveAndInsertImages(
  view: EditorView,
  host: ClipboardImageHost,
  sources: readonly (() => Promise<ClipboardImage | null>)[],
): Promise<void> {
  await withReentryGuard(host.windowLabel(), CLIPBOARD_IMAGE_GUARD, async () => {
    const filePath = getActiveFilePathForCurrentWindow();
    if (!filePath) {
      await showUnsavedDocWarning();
      return;
    }

    for (const read of sources) {
      const image = await read();
      if (!image) continue;
      // Unique filename to avoid collisions
      const filename = generateClipboardImageFilename(image.name);
      const relativePath = await host.saveImageToAssets(image.bytes, filename, filePath);
      if (!isViewConnected(view)) {
        imageHandlerWarn("View disconnected after saving image");
        return;
      }
      host.insertBlockImageNode(view, relativePath);
    }
  });
}

/** Save and insert an image the clipboard exposed as a file item. */
export function processClipboardImage(
  view: EditorView,
  item: DataTransferItem,
  host: ClipboardImageHost,
): Promise<void> {
  return saveAndInsertImages(view, host, [
    async () => {
      const file = item.getAsFile();
      if (!file) return null;
      return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name || "image.png" };
    },
  ]);
}

/**
 * The blob srcs of a pasted slice that consists only of images minted by
 * `pageOrigin` (whitespace-only text around them is allowed). Null when the
 * slice holds anything else, so the caller leaves the paste alone.
 */
export function findPastedBlobImageSrcs(slice: Slice, pageOrigin: string): string[] | null {
  // An opaque origin serialises as "null"; its blobs cannot be told apart.
  if (!pageOrigin || pageOrigin === "null") return null;
  const ownBlobPrefix = `blob:${pageOrigin}/`;
  const srcs: string[] = [];
  let claimable = true;

  slice.content.descendants((node) => {
    if (!claimable) return false;
    if (IMAGE_NODE_TYPES.has(node.type.name)) {
      const src = String(node.attrs.src ?? "");
      if (src.startsWith(ownBlobPrefix)) srcs.push(src);
      else claimable = false;
      return false;
    }
    if (node.isText) {
      if ((node.text ?? "").trim() !== "") claimable = false;
      return false;
    }
    if (node.isLeaf) claimable = false;
    return claimable;
  });

  return claimable && srcs.length > 0 ? srcs : null;
}

async function readBlobImage(src: string): Promise<ClipboardImage> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`pasted image could not be read (HTTP ${res.status})`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error(`pasted blob is not an image (${blob.type || "no type"})`);
  }
  // `image/svg+xml` -> `svg`
  const ext = blob.type.slice("image/".length).split("+")[0] || "png";
  return { bytes: new Uint8Array(await blob.arrayBuffer()), name: `image.${ext}` };
}

/**
 * Save and insert the blob images found by findPastedBlobImageSrcs. Rejects
 * on the first blob that cannot be read or is not an image.
 */
export function processPastedBlobImages(
  view: EditorView,
  srcs: readonly string[],
  host: ClipboardImageHost,
): Promise<void> {
  return saveAndInsertImages(view, host, srcs.map((src) => () => readBlobImage(src)));
}
