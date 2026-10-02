// WI-RA10B.4 — the markdown split's preview pane re-parses a large document
// once typing has settled, not on every keystroke; an editable pane and a
// small document still sync at once.
//
// Runs the real load path against a real editor: a "re-parse" is observed as
// the document-replacing transaction the load dispatches, which carries
// `preventUpdate`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useTiptapContentSync } from "./useTiptapContentSync";

let editor: Editor;
/** The text of each document loaded into the editor, in order. */
let loads: string[];
const ref = <T,>(current: T) => ({ current });
const doc = (chars: number, tail: string) => "x".repeat(chars - tail.length) + tail;

function mount(content: string, { preview }: { preview: boolean }) {
  const refs = {
    hiddenRef: ref(false),
    previewRef: ref(preview),
    isInternalChange: ref(false),
    lastExternalContent: ref(content),
    editorInitialized: ref(true),
    preserveLineBreaksRef: ref(false),
    cursorInfoRef: ref(null),
  };
  const hook = renderHook(
    (next: string) =>
      useTiptapContentSync({ editor, content: next, hidden: false, activeTabId: "tab-1", ...refs }),
    { initialProps: content },
  );
  // Only what follows the mount is under test.
  loads.length = 0;
  return { ...hook, refs };
}

beforeEach(() => {
  editor = new Editor({ extensions: [StarterKit] });
  loads = [];
  editor.on("transaction", ({ transaction }) => {
    if (transaction.getMeta("preventUpdate")) loads.push(transaction.doc.textContent);
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  editor.destroy();
});

describe("useTiptapContentSync — preview pane", () => {
  it("re-parses a large document once, after typing pauses for its tier", () => {
    const { rerender } = mount(doc(30_000, "1"), { preview: true });

    for (const tail of ["2", "3", "4"]) {
      rerender(doc(30_000, tail));
      vi.advanceTimersByTime(100);
    }
    expect(loads).toEqual([]);

    vi.advanceTimersByTime(199); // 100 ms of the 300 already passed in the loop
    expect(loads).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(loads).toEqual([doc(30_000, "4")]);
  });

  it("re-parses a small document on every change, at once", () => {
    const { rerender } = mount("one", { preview: true });
    rerender("two");
    rerender("three");
    expect(loads).toEqual(["two", "three"]);
  });

  it("drops a pending re-parse when the pane unmounts", () => {
    const { rerender, unmount } = mount(doc(30_000, "1"), { preview: true });
    rerender(doc(30_000, "2"));
    unmount();
    vi.advanceTimersByTime(5_000);
    expect(loads).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("skips a re-parse whose pane was hidden while it waited", () => {
    const { rerender, refs } = mount(doc(30_000, "1"), { preview: true });
    rerender(doc(30_000, "2"));
    refs.hiddenRef.current = true;
    vi.advanceTimersByTime(300);
    expect(loads).toEqual([]);
  });
});

describe("useTiptapContentSync — editable pane", () => {
  it("applies an external change to a large document at once", () => {
    const { rerender } = mount(doc(30_000, "1"), { preview: false });
    rerender(doc(30_000, "2"));
    expect(loads).toEqual([doc(30_000, "2")]);
  });

  it("ignores a change that is the editor's own content coming back", () => {
    const { rerender, refs } = mount("one", { preview: false });
    refs.lastExternalContent.current = "two";
    rerender("two");
    expect(loads).toEqual([]);
  });
});
