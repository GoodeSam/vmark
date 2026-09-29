import { describe, it, expect, beforeEach } from "vitest";
import { editorScrollRoot } from "./editorScrollRoot";

/** `.editor-content > .ProseMirror`, the shape the editor renders. */
function mountEditor() {
  const root = document.createElement("div");
  root.className = "editor-content";
  const pm = document.createElement("div");
  pm.className = "ProseMirror";
  root.appendChild(pm);
  document.body.appendChild(root);
  return { root, pm };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("editorScrollRoot", () => {
  it("is null outside an editor scroll container (the export surface)", () => {
    const surface = document.createElement("div");
    const pm = document.createElement("div");
    surface.appendChild(pm);
    document.body.appendChild(surface);
    expect(editorScrollRoot(pm)).toBeNull();
    expect(editorScrollRoot(null)).toBeNull();
    expect(editorScrollRoot(undefined)).toBeNull();
  });

  it("is .editor-content when nothing inside it scrolls", () => {
    const { root, pm } = mountEditor();
    expect(editorScrollRoot(pm)).toBe(root);
  });

  it("is the pane that scrolls inside .editor-content (split view preview)", () => {
    const root = document.createElement("div");
    root.className = "editor-content";
    const pane = document.createElement("div");
    pane.style.overflowY = "auto"; // jsdom does not expand the `overflow` shorthand
    const wrapper = document.createElement("div");
    const pm = document.createElement("div");
    pm.className = "ProseMirror";
    wrapper.appendChild(pm);
    pane.appendChild(wrapper);
    root.appendChild(pane);
    document.body.appendChild(root);

    expect(editorScrollRoot(pm)).toBe(pane);
  });

  it("looks again once the editor has moved to another container", () => {
    const first = mountEditor();
    expect(editorScrollRoot(first.pm)).toBe(first.root);

    const second = mountEditor();
    second.root.appendChild(first.pm);
    expect(editorScrollRoot(first.pm)).toBe(second.root);
  });
});
