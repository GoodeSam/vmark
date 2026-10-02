// WI-RA8.1 — the Source-mode diagram popup renders the document's own SVG; a
// link or a form in it must never navigate the app's webview.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../mermaid-preview.css", () => ({}));
// The renderers need real layout; this test supplies the rendered markup.
vi.mock("../mermaidPreviewRender", () => ({ renderPreview: vi.fn(() => 1) }));

import { MermaidPreviewView } from "../MermaidPreviewView";

const ANCHOR = { top: 10, left: 10, bottom: 20, right: 20 };

function shown(markup: string) {
  const view = new MermaidPreviewView();
  view.show("<svg/>", ANCHOR, undefined, "svg");
  const surface = document.querySelector<HTMLElement>(".mermaid-preview-content")!;
  surface.innerHTML = markup;
  return { view, surface };
}

const click = () => new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail: 1 });

let current: MermaidPreviewView | null = null;
afterEach(() => {
  current?.destroy();
  current = null;
});

describe("the Source-mode diagram popup", () => {
  it("prevents a click on a link in the rendered diagram", () => {
    const { view, surface } = shown(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://evil.example/"><text>x</text></a></svg>',
    );
    current = view;
    const event = click();
    surface.querySelector("text")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("prevents a form submit", () => {
    const { view, surface } = shown('<form action="https://evil.example/collect"></form>');
    current = view;
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    surface.querySelector("form")!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
  });

  it("leaves its own controls alone", () => {
    const { view } = shown("<svg/>");
    current = view;
    const zoomIn = document.querySelector<HTMLElement>('.mermaid-preview-zoom-btn[data-action="in"]')!;
    const event = click();
    zoomIn.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector(".mermaid-preview-zoom-value")!.textContent).toBe("110%");
  });

  it("still guards a diagram rendered after the popup was hidden and shown again", () => {
    const { view, surface } = shown("<svg/>");
    current = view;
    view.hide();
    view.show("<svg/>", ANCHOR, undefined, "svg");
    surface.innerHTML = '<a href="https://evil.example/">x</a>';
    const event = click();
    surface.querySelector("a")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
