/**
 * The data-tree preview separates each key from its value, measured in a
 * real engine.
 *
 * `jsonViewStyles` replaces react-json-view-lite's label class with ours to
 * recolour keys, and with it went every bit of spacing, so the json / yaml /
 * toml trees rendered `name:"demo"` — key, colon and value in one run. Renders
 * the library with the production style map and stylesheet, and measures.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { JsonView } from "react-json-view-lite";
import "@/styles/index.css";
import "./json-tree.css";
import { jsonViewStyles } from "./jsonViewStyles";

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

function mount(isDark: boolean) {
  host = document.createElement("div");
  host.className = "json-tree-preview";
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(<JsonView data={{ name: "demo", nested: { ok: true } }} style={jsonViewStyles(isDark)} />));
}

describe("data-tree preview spacing (real engine)", () => {
  it.each([[false], [true]])("a key and its value do not touch (dark: %s)", (isDark) => {
    mount(isDark);
    const keys = [...document.querySelectorAll<HTMLElement>(".vmark-json-view__key")];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const value = key.nextElementSibling as HTMLElement;
      const gap = value.getBoundingClientRect().left - key.getBoundingClientRect().right;
      // At least a third of the mono advance: a visible space, not kerning.
      const advance = parseFloat(getComputedStyle(key).fontSize) * 0.6;
      expect(gap).toBeGreaterThanOrEqual(advance / 3);
    }
  });
});
