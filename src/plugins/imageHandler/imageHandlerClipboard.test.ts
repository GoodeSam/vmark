// @vitest-environment node
/**
 * Tests for clipboard image paste — bytes exposed, and bytes withheld (#1453).
 *
 * WebKitGTK hands the paste event an EMPTY clipboardData for an in-memory
 * image, so ProseMirror captures the browser's native paste instead and calls
 * handlePaste again with a slice holding `<img src="blob:…">`. These pin:
 *   - which slices are claimed (images whose src is a blob the page minted,
 *     and nothing else of substance) and which fall through untouched
 *   - that exposed and blob bytes are saved through saveImageToAssets
 *   - unsaved document, non-image blob, and unreadable blob failures
 *   - that the plugin's handlePaste routes the captured slice here
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSaveImageToAssets = vi.fn((..._args: unknown[]) => Promise.resolve(".assets/saved.png"));
const mockInsertBlockImageNode = vi.fn((..._args: unknown[]) => undefined);
vi.mock("@/services/media/imageOperations", () => ({
  saveImageToAssets: (...args: unknown[]) => mockSaveImageToAssets(...args),
  insertBlockImageNode: (...args: unknown[]) => mockInsertBlockImageNode(...args),
}));

vi.mock("@/services/navigation/windowFocus", () => ({
  getWindowLabel: () => "main",
}));

vi.mock("@/utils/reentryGuard", () => ({
  withReentryGuard: async (_label: string, _guard: string, fn: () => Promise<void>) => fn(),
}));

vi.mock("@/utils/debug", () => ({
  imageHandlerWarn: vi.fn(),
  imageHandlerError: vi.fn(),
}));

const mockGetActiveFilePath = vi.fn<() => string | null>(() => "/docs/test.md");
const mockShowUnsavedDocWarning = vi.fn(() => Promise.resolve());
const mockIsViewConnected = vi.fn(() => true);
vi.mock("./imageHandlerUtils", () => ({
  getActiveFilePathForCurrentWindow: () => mockGetActiveFilePath(),
  showUnsavedDocWarning: () => mockShowUnsavedDocWarning(),
  isViewConnected: () => mockIsViewConnected(),
  generateClipboardImageFilename: (name: string) => `clipboard-1-abcd.${name.split(".").pop()}`,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn(() => Promise.resolve()) }));
vi.mock("@/plugins/shared/hostSettings", () => ({ hostSettings: { copyImagesToAssets: () => true } }));

import { Schema, Slice, Fragment } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/core";
import {
  findPastedBlobImageSrcs,
  processClipboardImage,
  processPastedBlobImages,
  type ClipboardImageHost,
} from "./imageHandlerClipboard";
import { imageHandlerExtension } from "./tiptap";

const ORIGIN = "tauri://localhost";

/** The host tiptap.ts supplies — here backed by the same spies the plugin's mocks use. */
const host: ClipboardImageHost = {
  windowLabel: () => "main",
  saveImageToAssets: (...args) => mockSaveImageToAssets(...args),
  insertBlockImageNode: (...args) => mockInsertBlockImageNode(...args),
};

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    block_image: { group: "block", atom: true, attrs: { src: { default: "" } } },
    text: { group: "inline" },
    image: { group: "inline", inline: true, atom: true, attrs: { src: { default: "" } } },
    hardBreak: { group: "inline", inline: true },
  },
});

const img = (src: string) => schema.nodes.image.create({ src });
const para = (...children: Parameters<typeof Fragment.from>[0][]) =>
  schema.nodes.paragraph.create(null, children.flatMap((c) => Fragment.from(c).content));
const slice = (...nodes: ReturnType<typeof para>[]) => new Slice(Fragment.from(nodes), 0, 0);

const OWN_BLOB = `blob:${ORIGIN}/6f1c2a4e-0000-4000-8000-000000000001`;
const OWN_BLOB_2 = `blob:${ORIGIN}/6f1c2a4e-0000-4000-8000-000000000002`;

describe("findPastedBlobImageSrcs", () => {
  it.each([
    ["an empty slice", Slice.empty],
    ["plain text", slice(para(schema.text("hello")))],
    ["an image with an ordinary URL", slice(para(img("https://example.com/a.png")))],
    ["an image with a relative path", slice(para(img(".assets/a.png")))],
    ["a blob minted by another origin", slice(para(img("blob:https://evil.example/1234")))],
    ["a blob URL whose origin only shares a prefix", slice(para(img(`blob:${ORIGIN}.evil/1234`)))],
    ["an own blob mixed with real text", slice(para(img(OWN_BLOB), schema.text("caption")))],
    ["an own blob mixed with a foreign image", slice(para(img(OWN_BLOB), img("https://x.test/b.png")))],
    ["an own blob next to a non-image atom", slice(para(img(OWN_BLOB), schema.nodes.hardBreak.create()))],
  ])("returns null for %s", (_label, s) => {
    expect(findPastedBlobImageSrcs(s, ORIGIN)).toBeNull();
  });

  it("claims a single inline image whose src is a blob this page minted", () => {
    expect(findPastedBlobImageSrcs(slice(para(img(OWN_BLOB))), ORIGIN)).toEqual([OWN_BLOB]);
  });

  it("tolerates whitespace-only text around the image (native paste leaves it)", () => {
    const s = slice(para(schema.text(" \n"), img(OWN_BLOB), schema.text(" ")));
    expect(findPastedBlobImageSrcs(s, ORIGIN)).toEqual([OWN_BLOB]);
  });

  it("claims block images and keeps document order across several images", () => {
    const s = new Slice(
      Fragment.from([schema.nodes.block_image.create({ src: OWN_BLOB }), para(img(OWN_BLOB_2))]),
      0,
      0,
    );
    expect(findPastedBlobImageSrcs(s, ORIGIN)).toEqual([OWN_BLOB, OWN_BLOB_2]);
  });

  it("returns null when the page origin is opaque", () => {
    expect(findPastedBlobImageSrcs(slice(para(img("blob:null/1234"))), "null")).toBeNull();
  });
});

describe("processPastedBlobImages", () => {
  const view = {} as EditorView;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveFilePath.mockReturnValue("/docs/test.md");
    mockIsViewConnected.mockReturnValue(true);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const blobResponse = (bytes: number[], type: string) => ({
    ok: true,
    status: 200,
    blob: () => Promise.resolve(new Blob([new Uint8Array(bytes)], { type })),
  });

  it("reads each blob and saves its bytes to assets under an extension from its MIME type", async () => {
    fetchMock
      .mockResolvedValueOnce(blobResponse([1, 2, 3], "image/png"))
      .mockResolvedValueOnce(blobResponse([4, 5], "image/jpeg"));
    mockSaveImageToAssets
      .mockResolvedValueOnce(".assets/one.png")
      .mockResolvedValueOnce(".assets/two.jpeg");

    await processPastedBlobImages(view, [OWN_BLOB, OWN_BLOB_2], host);

    expect(fetchMock).toHaveBeenNthCalledWith(1, OWN_BLOB);
    expect(fetchMock).toHaveBeenNthCalledWith(2, OWN_BLOB_2);
    expect(mockSaveImageToAssets).toHaveBeenNthCalledWith(
      1, new Uint8Array([1, 2, 3]), "clipboard-1-abcd.png", "/docs/test.md",
    );
    expect(mockSaveImageToAssets).toHaveBeenNthCalledWith(
      2, new Uint8Array([4, 5]), "clipboard-1-abcd.jpeg", "/docs/test.md",
    );
    expect(mockInsertBlockImageNode.mock.calls.map((c) => c[1])).toEqual([".assets/one.png", ".assets/two.jpeg"]);
  });

  it("maps image/svg+xml to .svg", async () => {
    fetchMock.mockResolvedValueOnce(blobResponse([60], "image/svg+xml"));
    await processPastedBlobImages(view, [OWN_BLOB], host);
    expect(mockSaveImageToAssets).toHaveBeenCalledWith(expect.any(Uint8Array), "clipboard-1-abcd.svg", "/docs/test.md");
  });

  it("warns and writes nothing for an unsaved document", async () => {
    mockGetActiveFilePath.mockReturnValue(null);
    await processPastedBlobImages(view, [OWN_BLOB], host);
    expect(mockShowUnsavedDocWarning).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSaveImageToAssets).not.toHaveBeenCalled();
  });

  it("rejects a blob that is not an image, saving nothing", async () => {
    fetchMock.mockResolvedValueOnce(blobResponse([1], "text/html"));
    await expect(processPastedBlobImages(view, [OWN_BLOB], host)).rejects.toThrow(/not an image/);
    expect(mockSaveImageToAssets).not.toHaveBeenCalled();
  });

  it("rejects when the blob can no longer be read", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, blob: vi.fn() });
    await expect(processPastedBlobImages(view, [OWN_BLOB], host)).rejects.toThrow(/404/);
    expect(mockSaveImageToAssets).not.toHaveBeenCalled();
  });

  it("stops inserting once the view has been torn down", async () => {
    fetchMock.mockResolvedValue(blobResponse([1], "image/png"));
    mockIsViewConnected.mockReturnValue(false);
    await processPastedBlobImages(view, [OWN_BLOB, OWN_BLOB_2], host);
    expect(mockInsertBlockImageNode).not.toHaveBeenCalled();
    expect(mockSaveImageToAssets).toHaveBeenCalledOnce();
  });
});

describe("processClipboardImage", () => {
  const view = {} as EditorView;
  const fileItem = (file: File | null) => ({ getAsFile: () => file }) as unknown as DataTransferItem;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveFilePath.mockReturnValue("/docs/test.md");
    mockIsViewConnected.mockReturnValue(true);
  });

  it("saves the clipboard file's bytes under its extension and inserts the result", async () => {
    await processClipboardImage(view, fileItem(new File([new Uint8Array([7, 8])], "shot.jpg", { type: "image/jpeg" })), host);
    expect(mockSaveImageToAssets).toHaveBeenCalledWith(new Uint8Array([7, 8]), "clipboard-1-abcd.jpg", "/docs/test.md");
    expect(mockInsertBlockImageNode).toHaveBeenCalledWith(view, ".assets/saved.png");
  });

  it("falls back to .png for an unnamed clipboard file", async () => {
    await processClipboardImage(view, fileItem(new File([new Uint8Array([1])], "", { type: "image/png" })), host);
    expect(mockSaveImageToAssets).toHaveBeenCalledWith(expect.any(Uint8Array), "clipboard-1-abcd.png", "/docs/test.md");
  });

  it("reads the file before the paste event returns, while the item is still live", async () => {
    // A DataTransferItem goes dead once the paste handler returns.
    let live = true;
    const file = new File([new Uint8Array([9])], "a.png", { type: "image/png" });
    const item = { getAsFile: () => (live ? file : null) } as unknown as DataTransferItem;

    const pending = processClipboardImage(view, item, host);
    live = false;
    await pending;

    expect(mockSaveImageToAssets).toHaveBeenCalledWith(new Uint8Array([9]), "clipboard-1-abcd.png", "/docs/test.md");
  });

  it("does nothing when the item yields no file", async () => {
    await processClipboardImage(view, fileItem(null), host);
    expect(mockSaveImageToAssets).not.toHaveBeenCalled();
    expect(mockInsertBlockImageNode).not.toHaveBeenCalled();
  });

  it("warns and writes nothing for an unsaved document", async () => {
    mockGetActiveFilePath.mockReturnValue(null);
    await processClipboardImage(view, fileItem(new File([new Uint8Array([1])], "a.png")), host);
    expect(mockShowUnsavedDocWarning).toHaveBeenCalledOnce();
    expect(mockSaveImageToAssets).not.toHaveBeenCalled();
  });
});

describe("imageHandler handlePaste — captured native paste (#1453)", () => {
  type HandlePaste = (view: EditorView, event: ClipboardEvent, slice: Slice) => boolean;
  let handlePaste: HandlePaste;
  // After ProseMirror's capture fallback, the event still carries the empty
  // clipboard WebKitGTK handed over.
  const emptyClipboardEvent = () =>
    ({ clipboardData: { items: [], getData: () => "" }, preventDefault: vi.fn() }) as unknown as ClipboardEvent;
  const view = { dom: { isConnected: true } } as unknown as EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveFilePath.mockReturnValue("/docs/test.md");
    mockIsViewConnected.mockReturnValue(true);
    vi.stubGlobal("window", { location: { origin: ORIGIN } });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob([new Uint8Array([1, 2])], { type: "image/png" })),
    })));
    const plugin = imageHandlerExtension.config.addProseMirrorPlugins!.call({
      name: imageHandlerExtension.name,
      options: imageHandlerExtension.options,
      storage: imageHandlerExtension.storage,
      editor: {} as Editor,
      type: null,
      parent: undefined,
    } as never)[0];
    handlePaste = (v, e, sl) => plugin.props.handlePaste!.call(plugin, v, e, sl) === true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("claims a slice holding a blob image this page minted and saves it to assets", async () => {
    const event = emptyClipboardEvent();
    expect(handlePaste(view, event, slice(para(img(OWN_BLOB))))).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(mockInsertBlockImageNode).toHaveBeenCalledWith(view, ".assets/saved.png"));
    expect(mockSaveImageToAssets).toHaveBeenCalledWith(new Uint8Array([1, 2]), "clipboard-1-abcd.png", "/docs/test.md");
  });

  it("leaves a slice with an ordinary image URL to the default paste", () => {
    const event = emptyClipboardEvent();
    expect(handlePaste(view, event, slice(para(img("https://example.com/a.png"))))).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves an empty paste (the first, pre-capture call) to ProseMirror's capture", () => {
    expect(handlePaste(view, emptyClipboardEvent(), Slice.empty)).toBe(false);
  });
});
