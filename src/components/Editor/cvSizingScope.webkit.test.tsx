/**
 * The content-visibility sizing rule belongs only to editors that use
 * content-visibility (#1472 × #1473, real engine, production component).
 *
 * `contain-intrinsic-size: auto` has no layout effect without size
 * containment, but it makes the engine keep a remembered size for every
 * top-level block, updated at every rendering update: 3–4 ms per frame while
 * typing at 16,000 blocks in WebKit (#1477). Content-visibility never applies
 * on macOS (#1479) nor below the size threshold anywhere, so on those editors
 * the rule bought nothing. It has to stay on through the edit-time strip of
 * `.cv-idle` wherever content-visibility IS used — that is #1472's fix, guarded
 * by cvIdleEndOfDocument.webkit.test.ts.
 *
 * Renders the PRODUCTION TiptapEditorInner with the real extension set,
 * editor.css and stores: the class decisions under test live in the component
 * and in the helpers it calls. Only hook wiring with app side effects is
 * replaced — document state (so the test owns the content), the store flush,
 * focus and scroll restore, drag-drop and editor registrations. Every
 * assertion reads the engine's computed style, not class names.
 */
import "@/styles/index.css";
import "@/components/Editor/editor.css";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import type { Editor } from "@tiptap/core";

const doc = vi.hoisted(() => {
  let content = "";
  const listeners = new Set<() => void>();
  const noop = () => {};
  return {
    editor: null as Editor | null,
    /** The flush's sync guard, as useTiptapFlush sets it before writing the store. */
    lastExternalContent: null as { current: string } | null,
    get: () => content,
    set(next: string) {
      content = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    actions: { setContent: noop, setCursorInfo: noop, setSelectedText: noop },
    noop,
  };
});

vi.mock("@/hooks/useDocumentState", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useActiveTabId: () => "cv-sizing-scope",
    useDocumentContent: () => useSyncExternalStore(doc.subscribe, doc.get),
    useDocumentCursorInfo: () => null,
    useDocumentActions: () => doc.actions,
  };
});
// The editor instance, captured from a hook TiptapEditorInner hands it to.
vi.mock("@/hooks/useTiptapSettingsSync", () => ({
  useTiptapSettingsSync: (editor: Editor | null) => {
    doc.editor = editor;
  },
}));
vi.mock("./useTiptapFlush", async () => {
  const { useRef } = await import("react");
  return {
    useTiptapFlush: () => {
      const lastExternalContent = useRef("");
      doc.lastExternalContent = lastExternalContent;
      return {
        isInternalChange: useRef(false),
        lastExternalContent,
        pendingRaf: useRef<number | null>(null),
        pendingDebounceTimeout: useRef<number | null>(null),
        internalChangeRaf: useRef<number | null>(null),
        flushToStore: doc.noop,
        flushToStoreRef: useRef(null),
        scheduleFlush: doc.noop,
      };
    },
  };
});
vi.mock("@/services/editor/tiptapFocus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/editor/tiptapFocus")>()),
  scheduleTiptapFocusAndRestore: () => {},
}));
vi.mock("./useWysiwygScrollMemory", () => ({ useWysiwygScrollMemory: () => {} }));
vi.mock("./ImageContextMenu", () => ({ ImageContextMenu: () => null }));
vi.mock("@/hooks/useImageContextMenu", () => ({ useImageContextMenu: () => () => {} }));
vi.mock("@/hooks/useOutlineSync", () => ({ useOutlineSync: () => {} }));
vi.mock("@/hooks/useImageDragDrop", () => ({ useImageDragDrop: () => {} }));
vi.mock("@/hooks/useWysiwygFlusherRegistration", () => ({ useWysiwygFlusherRegistration: () => {} }));
vi.mock("@/hooks/useFocusedPaneTiptapRegistration", () => ({ useFocusedPaneTiptapRegistration: () => {} }));
vi.mock("@/services/mcpBridge/revisionTracker", () => ({ initializeRevisionTracking: () => {} }));
// The real provider starts window services (workspaces, tab transfer).
vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));
// Its real module pulls i18n, the document store and a toast into the page
// (see cvIdleEndOfDocument.webkit.test.ts). The markdown here always parses.
vi.mock("@/services/editor/unparseableDocument", () => ({
  reportUnparseableDocument: () => {
    throw new Error("unexpected unparseable document in the cv sizing test");
  },
}));

import { TextSelection } from "@tiptap/pm/state";
import { useSettingsStore } from "@/stores/settingsStore";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { TiptapEditorInner } from "./TiptapEditor";
import { CV_IDLE_CHAR_THRESHOLD } from "./tiptapEditorHelpers";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function until<T>(probe: () => T | null | undefined, what: string, timeoutMs = 10_000): Promise<T> {
  const began = performance.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (performance.now() - began > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await nextFrame();
  }
}

/** Deterministic prose of at least `minChars` characters (headings, paragraphs, lists). */
function prose(minChars: number): string {
  const words = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor".split(" ");
  let seed = 11;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const sentence = (n: number) => Array.from({ length: n }, () => words[next(words.length)]).join(" ");
  const lines: string[] = [];
  let length = 0;
  for (let section = 1; length < minChars; section += 1) {
    const block = [`## Section ${section}`, "", sentence(40 + next(60)), "", `- item ${sentence(8)}`, `- item ${sentence(6)}`, "", ""];
    lines.push(...block);
    length += block.join("\n").length;
  }
  return lines.join("\n");
}
const LARGE = prose(CV_IDLE_CHAR_THRESHOLD * 2.5);
const SMALL = prose(CV_IDLE_CHAR_THRESHOLD / 10);

/** How many top-level blocks the engine sizes with `auto`, and lays out with content-visibility. */
function census(editor: Editor) {
  const blocks = Array.from(editor.view.dom.children);
  const styles = blocks.map((block) => getComputedStyle(block));
  return {
    blocks: blocks.length,
    sized: styles.filter((style) => style.containIntrinsicHeight.startsWith("auto")).length,
    skippable: styles.filter((style) => style.contentVisibility === "auto").length,
  };
}

interface Mounted {
  editor: Editor;
  scroller: HTMLElement;
}

interface EditorProps {
  preview?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
}

let root: Root | null = null;
let frame: HTMLElement | null = null;

/** Render (or re-render) the production editor with `props`, synchronously. */
function render(props: EditorProps): void {
  const mounted = root;
  if (!mounted) throw new Error("render before mount");
  flushSync(() => mounted.render(<TiptapEditorInner {...props} />));
}

async function mount(markdown: string, props: EditorProps = {}): Promise<Mounted> {
  doc.editor = null;
  doc.set(markdown);
  frame = document.createElement("div");
  frame.style.cssText = "height:700px;width:900px;display:flex;flex-direction:column";
  const scroller = document.createElement("div");
  scroller.className = "editor-content";
  const host = document.createElement("div");
  scroller.appendChild(host);
  frame.appendChild(scroller);
  document.body.appendChild(frame);
  root = createRoot(host);
  render(props);
  // onCreate parses the markdown in a deferred task after mount.
  const editor = await until(() => (doc.editor && doc.editor.state.doc.childCount > 1 ? doc.editor : null), "the initial parse");
  for (let i = 0; i < 3; i += 1) await nextFrame();
  return { editor, scroller };
}

/**
 * Replace the document's content from outside the editor, as a reload or
 * external change does. A store update inside flushSync renders on the sync
 * lane, whose passive effects (the content sync) React flushes before
 * returning — so the new blocks exist when this returns, and no timer has had
 * a chance to run.
 */
function replaceContent(editor: Editor, markdown: string): void {
  const before = editor.state.doc.childCount;
  flushSync(() => doc.set(markdown));
  expect(Math.abs(editor.state.doc.childCount - before), "premise: the content sync ran").toBeGreaterThan(before / 2);
}

/** Type one character into a paragraph in view, with a real key. */
async function typeInView({ editor, scroller }: Mounted): Promise<void> {
  const top = scroller.getBoundingClientRect().top;
  const target = Array.from(editor.view.dom.children).find(
    (block) => block.tagName === "P" && block.getBoundingClientRect().top - top > 40,
  );
  expect(target, "premise: a paragraph in view").toBeDefined();
  editor.view.focus();
  const pos = editor.view.posAtDOM(target!, 0) + 1;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  const sizeBefore = editor.state.doc.content.size;
  await userEvent.keyboard("x");
  expect(editor.state.doc.content.size, "premise: the keystroke reached the editor").toBe(sizeBefore + 1);
}

/** Wait until content-visibility is back on the blocks, then let it settle. */
async function untilSkippableAgain(editor: Editor): Promise<void> {
  await until(() => census(editor).skippable > 0 || null, "content-visibility to return", 5_000);
  for (let i = 0; i < 10; i += 1) await nextFrame();
}

function pinPlatform(platform: string): void {
  Object.defineProperty(navigator, "platform", { configurable: true, get: () => platform });
}

describe("content-visibility sizing scope (real engine, production editor)", () => {
  beforeEach(() => {
    doc.editor = null;
  });
  afterEach(() => {
    const unmounting = root;
    if (unmounting) flushSync(() => unmounting.unmount());
    frame?.remove();
    root = null;
    frame = null;
    Reflect.deleteProperty(navigator, "platform");
    useSettingsStore.getState().updateMarkdownSetting("codeBlockLineNumbers", false);
  });

  it.each([
    { platform: "MacIntel", size: "large", markdown: LARGE },
    { platform: "Win32", size: "small", markdown: SMALL },
  ])("sizes no block on $platform with a $size document — at mount, through an edit and after the idle window", async ({ platform, markdown }) => {
    pinPlatform(platform);
    const mounted = await mount(markdown);
    const { editor } = mounted;
    const none = { blocks: editor.view.dom.children.length, sized: 0, skippable: 0 };
    expect(census(editor), "at mount").toEqual(none);

    await typeInView(mounted);
    expect(census(editor), "right after a keystroke").toEqual({ ...none, blocks: editor.view.dom.children.length });
    await wait(700);
    expect(census(editor), "after the idle window").toEqual({ ...none, blocks: editor.view.dom.children.length });
  }, 30_000);

  it("keeps every block sized on Windows with a large document — at mount, through the edit-time strip and after the re-add", async () => {
    pinPlatform("Win32");
    const mounted = await mount(LARGE);
    const { editor } = mounted;
    const count = () => editor.view.dom.children.length;
    expect(census(editor), "at mount").toEqual({ blocks: count(), sized: count(), skippable: count() });

    await typeInView(mounted);
    expect(census(editor), "the strip keeps the sizing rule").toEqual({ blocks: count(), sized: count(), skippable: 0 });

    await untilSkippableAgain(editor);
    expect(census(editor), "after the idle re-add").toEqual({ blocks: count(), sized: count(), skippable: count() });
  }, 30_000);

  // A re-render that changes the container's other classes (code-block line
  // numbers) must neither bring content-visibility back in the middle of an
  // edit nor take the sizing rule away.
  it("keeps an edit's strip and the sizing rule through a re-render of the container's classes", async () => {
    pinPlatform("Win32");
    const mounted = await mount(LARGE);
    const { editor } = mounted;
    const count = () => editor.view.dom.children.length;
    await typeInView(mounted);
    expect(census(editor), "premise: the edit stripped content-visibility").toEqual({ blocks: count(), sized: count(), skippable: 0 });

    flushSync(() => useSettingsStore.getState().updateMarkdownSetting("codeBlockLineNumbers", true));
    expect(editor.view.dom.closest(".tiptap-editor")?.classList.contains("show-line-numbers"), "premise: the re-render happened").toBe(true);
    expect(census(editor), "mid-edit, after the re-render").toEqual({ blocks: count(), sized: count(), skippable: 0 });

    await untilSkippableAgain(editor);
    expect(census(editor), "after the idle re-add").toEqual({ blocks: count(), sized: count(), skippable: count() });
  }, 30_000);

  // A reload or external change sets preventUpdate and never reaches onUpdate,
  // and a split preview never handles onUpdate at all: the crossing has to be
  // followed from the content itself.
  it.each([{ preview: false }, { preview: true }])(
    "sizes first and skips only after the idle window when a content sync takes a document past the threshold (preview: $preview)",
    async ({ preview }) => {
      pinPlatform("Win32");
      const { editor } = await mount(SMALL, preview ? { preview, readOnly: true } : {});
      expect(census(editor).sized, "premise: a small document is not sized").toBe(0);

      replaceContent(editor, LARGE);
      const count = editor.view.dom.children.length;
      expect(census(editor), "right after the sync").toEqual({ blocks: count, sized: count, skippable: 0 });
      const laidOut = editor.view.dom.getBoundingClientRect().height;

      // Every block rendered once with the rule on, so each one comes back
      // at its own height when it is skipped — not at the 2.5em estimate.
      await untilSkippableAgain(editor);
      expect(census(editor), "after the idle window").toEqual({ blocks: count, sized: count, skippable: count });
      expect(Math.abs(editor.view.dom.getBoundingClientRect().height - laidOut), "document height change (px)").toBeLessThanOrEqual(1);
    },
    30_000,
  );

  it.each([{ preview: false }, { preview: true }])(
    "drops the sizing rule with content-visibility when a content sync takes a document below the threshold (preview: $preview)",
    async ({ preview }) => {
      pinPlatform("Win32");
      const { editor } = await mount(LARGE, preview ? { preview, readOnly: true } : {});
      const large = editor.view.dom.children.length;
      expect(census(editor), "premise: a large document uses content-visibility").toEqual({ blocks: large, sized: large, skippable: large });

      replaceContent(editor, SMALL);
      await wait(700);
      expect(census(editor)).toEqual({ blocks: editor.view.dom.children.length, sized: 0, skippable: 0 });
    },
    30_000,
  );

  // Near the threshold the serialized markdown and the ProseMirror document
  // differ in length. An edit decides from the document; the flush that
  // follows must not overrule it. The flushed markdown here is shorter than
  // the document's real serialization — it stands in for one that landed just
  // below the threshold while the document stayed above it.
  it("keeps an edit's decision when the flushed markdown lands below the threshold", async () => {
    pinPlatform("Win32");
    const mounted = await mount(LARGE);
    const { editor } = mounted;
    await typeInView(mounted);
    expect(editor.state.doc.content.size, "premise: the document stays above the threshold").toBeGreaterThanOrEqual(CV_IDLE_CHAR_THRESHOLD);

    const flushed = LARGE.slice(0, CV_IDLE_CHAR_THRESHOLD - 1_000);
    const guard = doc.lastExternalContent;
    if (!guard) throw new Error("premise: the flush guard is wired");
    guard.current = flushed; // as useTiptapFlush does before writing the store
    flushSync(() => doc.set(flushed));

    await wait(700);
    const count = editor.view.dom.children.length;
    expect(census(editor), "after the edit's idle window").toEqual({ blocks: count, sized: count, skippable: count });
  }, 30_000);

  // keepBothEditorsAlive: Source-mode typing reaches a hidden WYSIWYG editor's
  // store, but its document is synced only when it is shown — and a hidden
  // block is never rendered, so no size could be recorded while hidden.
  it("follows a crossing made while the editor was hidden only once it is shown", async () => {
    pinPlatform("Win32");
    const { editor } = await mount(SMALL);
    const small = editor.view.dom.children.length;
    render({ hidden: true });
    flushSync(() => doc.set(LARGE));
    await wait(700);
    expect(census(editor), "while hidden").toEqual({ blocks: small, sized: 0, skippable: 0 });

    render({ hidden: false });
    const count = editor.view.dom.children.length;
    expect(count, "premise: showing the editor synced the document").toBeGreaterThan(small * 2);
    expect(census(editor), "right after it is shown").toEqual({ blocks: count, sized: count, skippable: 0 });
    const laidOut = editor.view.dom.getBoundingClientRect().height;

    await untilSkippableAgain(editor);
    expect(census(editor), "after the idle window").toEqual({ blocks: count, sized: count, skippable: count });
    expect(Math.abs(editor.view.dom.getBoundingClientRect().height - laidOut), "document height change (px)").toBeLessThanOrEqual(1);
  }, 30_000);

  // The content can change between mount and onCreate's deferred parse,
  // which then loads the latest content. The parse is not an edit, and no
  // React state changes when it completes: the document itself must be followed.
  it("follows a crossing that lands before the initial parse", async () => {
    pinPlatform("Win32");
    doc.editor = null;
    doc.set(SMALL);
    frame = document.createElement("div");
    frame.style.cssText = "height:700px;width:900px;display:flex;flex-direction:column";
    const scroller = document.createElement("div");
    scroller.className = "editor-content";
    const host = document.createElement("div");
    scroller.appendChild(host);
    frame.appendChild(scroller);
    document.body.appendChild(frame);
    root = createRoot(host);
    render({});
    flushSync(() => doc.set(LARGE)); // before the parse's task runs
    const editor = await until(() => (doc.editor && doc.editor.state.doc.content.size > CV_IDLE_CHAR_THRESHOLD ? doc.editor : null), "the parse of the latest content");
    const count = editor.view.dom.children.length;
    expect(census(editor), "after the parse").toEqual({ blocks: count, sized: count, skippable: 0 });

    await untilSkippableAgain(editor);
    expect(census(editor), "after the idle window").toEqual({ blocks: count, sized: count, skippable: count });
  }, 30_000);

  // A load's own transaction is not the final document: plugins append to it
  // (the footnote plugin deletes a definition whose reference is gone), and
  // onTransaction reports the root transaction.
  it("decides a load from the document after the transactions appended to it", async () => {
    pinPlatform("Win32");
    const definition = `[^1]: ${"lorem ipsum ".repeat(Math.ceil(CV_IDLE_CHAR_THRESHOLD / 11) + 100)}`;
    const { editor } = await mount(`A paragraph with a note.[^1]\n\n${definition}\n`);
    expect(editor.state.doc.content.size, "premise: mounted above the threshold").toBeGreaterThanOrEqual(CV_IDLE_CHAR_THRESHOLD);
    const mounted = census(editor);
    expect(mounted.sized, "premise: its blocks are sized").toBe(mounted.blocks);

    flushSync(() => doc.set(`A paragraph without it.\n\n${definition}\n`));
    expect(editor.state.doc.content.size, "premise: the orphaned definition was removed").toBeLessThan(CV_IDLE_CHAR_THRESHOLD);
    await wait(700);
    expect(census(editor)).toEqual({ blocks: editor.view.dom.children.length, sized: 0, skippable: 0 });
  }, 30_000);

  // An edit that takes the document past the threshold starts the idle
  // window; hiding the editor before one frame has rendered its blocks with
  // the rule must not let content-visibility return while nothing is rendered.
  it("restarts the idle window when an editor hidden mid-window is shown again", async () => {
    pinPlatform("Win32");
    const { editor } = await mount(SMALL);
    const addition = parseMarkdown(editor.schema, LARGE).content;
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, addition)); // an edit, not a load
    render({ hidden: true }); // same task: no frame has rendered the new blocks
    await wait(700);
    const count = editor.view.dom.children.length;
    expect(census(editor), "while hidden").toEqual({ blocks: count, sized: count, skippable: 0 });

    render({ hidden: false });
    expect(census(editor), "right after it is shown").toEqual({ blocks: count, sized: count, skippable: 0 });
    await nextFrame();
    const laidOut = editor.view.dom.getBoundingClientRect().height;

    await untilSkippableAgain(editor);
    expect(census(editor), "after the idle window").toEqual({ blocks: count, sized: count, skippable: count });
    expect(Math.abs(editor.view.dom.getBoundingClientRect().height - laidOut), "document height change (px)").toBeLessThanOrEqual(1);
  }, 30_000);
});
