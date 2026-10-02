// WI-RA8.5 — in a real engine, converting clipboard HTML loads nothing and
// runs nothing.
/**
 * jsdom never loads an image, so only a real engine can show the effect: an
 * `<img>` the parser creates in the PAGE's document starts loading at once,
 * attached or not, and its `onerror` runs. The first test below is the
 * control — it proves this engine behaves that way, so the second test's
 * silence means something.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { htmlToMarkdown } from "./htmlToMarkdown";

declare global {
  interface Window {
    __ra85Loads?: string[];
  }
}

/** An image that cannot load, and reports the attempt by name. */
const probe = (name: string) =>
  `<img src="about:ra85-${name}" onerror="(window.__ra85Loads = window.__ra85Loads || []).push('${name}')">`;

/** Resolve once an image created after every earlier one has failed to load. */
function laterImageSettled(): Promise<void> {
  return new Promise((resolve) => {
    const control = new Image();
    control.onerror = () => resolve();
    control.src = "about:ra85-control";
  });
}

beforeEach(() => {
  window.__ra85Loads = [];
});

describe("clipboard HTML and the network, real engine", () => {
  it("control: markup parsed into the page's own document does load", async () => {
    const detached = document.createElement("div");
    detached.innerHTML = probe("page");
    await laterImageSettled();
    expect(window.__ra85Loads).toEqual(["page"]);
  });

  it("htmlToMarkdown loads nothing and runs no handler", async () => {
    const markdown = htmlToMarkdown(
      `<p>before ${probe("plain")}</p><b>bold ${probe("bold")}</b><i>italic ${probe("italic")}</i>`,
    );
    await laterImageSettled();
    expect(window.__ra85Loads).toEqual([]);
    // The images are still converted — they were parsed, just not loaded.
    expect(markdown).toContain("![](about:ra85-plain)");
    expect(markdown).toContain("![](about:ra85-bold)");
  });
});
