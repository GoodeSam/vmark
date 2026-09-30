/**
 * The rendered transcript must share the terminal surface without covering it,
 * measured in a real engine (rule 32: shared-surface chrome gets a geometry test).
 *
 * In a top/bottom panel — wide and short — the transcript sits to the RIGHT of
 * the CLI; stacking it below would halve a height that is already scarce. In a
 * side panel it sits BELOW. The grid's overlays (search bar) stay over the CLI,
 * never over the transcript. Collapsed, the region is not mounted at all (its
 * toggle lives in the tab bar), so the CLI gets the whole area back.
 *
 * Renders the production TerminalSessionsArea + TerminalTranscript with the real
 * panel and transcript styles.
 *
 * Stylesheets load in TerminalPanel.tsx's order — the transcript's (imported by
 * TerminalTranscript) BEFORE terminal-panel.css. Equal-specificity rules resolve
 * by that order; importing them the other way round once hid a real bug here.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import "@/styles/index.css";
import type { EffectiveTerminalPosition } from "@/stores/uiStore";
import "./TerminalSearchBar.css";
import { TerminalTranscript } from "./TerminalTranscript";
import { TerminalSessionsArea } from "./TerminalSessionsArea";
import "./terminal-panel.css";

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(position: EffectiveTerminalPosition, open = true) {
  host = document.createElement("div");
  const wide = position === "top" || position === "bottom";
  host.style.cssText = `width: ${wide ? 900 : 420}px; height: ${wide ? 260 : 700}px; display: flex`;
  document.body.append(host);
  root = createRoot(host);
  flushSync(() =>
    root!.render(
      <TerminalSessionsArea position={position} transcript={open ? <TerminalTranscript id="tx" messages={[]} failed={false} configuration="ready" /> : null}>
        <div className="terminal-container" data-testid="grid" />
        <div className="terminal-search-bar" data-testid="search">search</div>
      </TerminalSessionsArea>,
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

describe("terminal transcript layout (real engine, production components)", () => {
  it.each(["bottom", "top"] as const)("a %s panel puts the open transcript to the right of the CLI", async (position) => {
    mount(position);
    await new Promise(requestAnimationFrame);
    const grid = box('[data-testid="grid"]');
    const transcript = box(".terminal-transcript");
    expect(grid.width).toBeGreaterThan(300);
    expect(grid.right).toBeLessThanOrEqual(transcript.left + 0.5);
    expect(Math.round(transcript.height)).toBe(Math.round(grid.height));
  });

  it.each(["right", "left"] as const)("a %s panel puts the open transcript below the CLI", async (position) => {
    mount(position);
    await new Promise(requestAnimationFrame);
    const grid = box('[data-testid="grid"]');
    const transcript = box(".terminal-transcript");
    expect(grid.height).toBeGreaterThan(200);
    expect(grid.bottom).toBeLessThanOrEqual(transcript.top + 0.5);
  });

  it("the search bar stays over the CLI, not the transcript", async () => {
    mount("bottom");
    await new Promise(requestAnimationFrame);
    const search = box('[data-testid="search"]');
    const transcript = box(".terminal-transcript");
    expect(search.right).toBeLessThanOrEqual(transcript.left + 0.5);
  });

  it("collapsed, the transcript leaves the layout and the CLI takes the whole area", async () => {
    mount("bottom", false);
    await new Promise(requestAnimationFrame);
    expect(document.querySelector(".terminal-transcript")).toBeNull();
    expect(Math.round(box('[data-testid="grid"]').width)).toBe(900);
  });
});
