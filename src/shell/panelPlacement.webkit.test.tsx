/**
 * The panel is drawn on its side of the editor, measured in a real engine.
 *
 * EditorArea keeps the panel in ONE child slot and reverses the flex axis for
 * top/left (moving it between slots remounted the terminal and killed its
 * PTYs). jsdom has no layout, so only a real engine can show the reversed axis
 * still puts the panel where the user asked for it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import "@/styles/index.css";
import { EditorArea } from "./EditorArea";

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(panelPosition: "top" | "bottom" | "left" | "right") {
  host = document.createElement("div");
  host.style.cssText = "width: 800px; height: 600px; display: flex";
  document.body.append(host);
  root = createRoot(host);
  const horizontal = panelPosition === "left" || panelPosition === "right";
  flushSync(() =>
    root!.render(
      <EditorArea
        panelPosition={panelPosition}
        editor={<div style={{ height: "100%" }} />}
        bottomBar={<div style={{ height: 40 }} />}
        panel={<div data-testid="panel" style={horizontal ? { width: 200 } : { height: 150 }} />}
      />,
    ),
  );
}

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

const box = (sel: string) => (document.querySelector(sel) as HTMLElement).getBoundingClientRect();

describe("panel placement (real engine, production EditorArea)", () => {
  it("top: above the editor", () => {
    mount("top");
    expect(box('[data-testid="panel"]').bottom).toBeLessThanOrEqual(box('[role="main"]').top + 0.5);
  });
  it("bottom: below the editor and its bar", () => {
    mount("bottom");
    expect(box('[data-testid="panel"]').top).toBeGreaterThanOrEqual(box('[role="main"]').bottom - 0.5);
  });
  it("left: left of the editor", () => {
    mount("left");
    expect(box('[data-testid="panel"]').right).toBeLessThanOrEqual(box('[role="main"]').left + 0.5);
  });
  it("right: right of the editor", () => {
    mount("right");
    expect(box('[data-testid="panel"]').left).toBeGreaterThanOrEqual(box('[role="main"]').right - 0.5);
  });
});
