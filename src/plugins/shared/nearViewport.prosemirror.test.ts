/**
 * nearViewport against a REAL ProseMirror view: the observed block must follow
 * a node view that ProseMirror moves into a new wrapper without destroying it
 * (`recreateWrapper`, e.g. paragraph → heading), or the render never runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { whenNearViewport, flushNearViewport, resetNearViewportForTest } from "./nearViewport";
import { installFakeIntersectionObserver, onlyObserver } from "@/test/fakeIntersectionObserver";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    heading: { group: "block", content: "inline*", toDOM: () => ["h2", 0] },
    math: { group: "inline", inline: true, atom: true, toDOM: () => ["span", { class: "math" }] },
    text: { group: "inline" },
  },
});

let frames: FrameRequestCallback[] = [];
const runFrame = () => {
  const due = frames;
  frames = [];
  due.forEach((cb) => cb(0));
};

function mountView(render: () => void) {
  const root = document.createElement("div");
  root.className = "editor-content";
  document.body.appendChild(root);
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("a "), schema.node("math")]),
  ]);
  const view = new EditorView(root, {
    state: EditorState.create({ doc }),
    nodeViews: {
      math: () => {
        const dom = document.createElement("span");
        dom.className = "math";
        const cancel = whenNearViewport(dom, root, render);
        return { dom, destroy: cancel };
      },
    },
  });
  view.dom.classList.add("ProseMirror");
  return { root, view };
}

beforeEach(() => {
  resetNearViewportForTest();
  document.body.innerHTML = "";
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  installFakeIntersectionObserver();
});

afterEach(() => vi.unstubAllGlobals());

describe("nearViewport — ProseMirror moving a node view to a new block", () => {
  it("follows a waiting formula into the heading its paragraph became", async () => {
    const render = vi.fn();
    const { view } = mountView(render);
    await Promise.resolve();
    const math = view.dom.querySelector(".math")!;
    expect([...onlyObserver().observed]).toEqual([view.dom.querySelector("p")]);

    // setBlockType keeps the content, so ProseMirror re-wraps the SAME node view.
    view.dispatch(view.state.tr.setBlockType(0, view.state.doc.content.size, schema.nodes.heading));
    await Promise.resolve();
    await Promise.resolve();

    const heading = view.dom.querySelector("h2")!;
    expect(heading.contains(math)).toBe(true); // same node view, new block
    expect([...onlyObserver().observed]).toEqual([heading]);

    onlyObserver().trigger();
    runFrame();
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe("flushNearViewport — renders already in flight", () => {
  it("waits for a render the frame queue started but has not finished", async () => {
    let finish!: () => void;
    let done = false;
    const render = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            done = true;
            resolve();
          };
        }),
    );
    const { root } = mountView(render);
    await Promise.resolve();
    onlyObserver().trigger();
    runFrame(); // started: e.g. waiting for KaTeX to load
    expect(render).toHaveBeenCalledTimes(1);

    let flushed = false;
    const flushing = flushNearViewport(root).then(() => {
      flushed = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(flushed).toBe(false);

    finish();
    await flushing;
    expect(done).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
