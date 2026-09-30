/**
 * The terminal transcript renders Mermaid with `strict` security and SVG (not
 * HTML) labels. Every diagram type the transcript may meet must still render
 * under that config in a real engine — jsdom has no layout, so it cannot tell.
 * Also pins that a strict render leaves the editor's config intact.
 */
import { describe, it, expect } from "vitest";
import "@/styles/index.css";
import { renderMermaid } from "./index";

const DIAGRAMS = {
  flowchart: 'flowchart LR\n  A["User types"] --> B{"Mermaid?"}\n  B -->|Yes| C["Render"]',
  sequence: 'sequenceDiagram\n  participant U as User\n  participant W as Webview\n  U->>W: Click Save\n  W-->>U: Ok',
};

describe("strict (transcript) Mermaid rendering, real engine", () => {
  it.each(Object.entries(DIAGRAMS))("renders a %s diagram", async (_kind, source) => {
    const svg = await renderMermaid(source, `strict-${_kind}`, true);
    expect(svg).toMatch(/^<svg/);
    expect(svg).not.toContain("<foreignObject");
  });

  it("returns the editor to its own config after a strict render", async () => {
    await renderMermaid(DIAGRAMS.flowchart, "strict-first", true);
    const svg = await renderMermaid(DIAGRAMS.flowchart, "editor-after");
    expect(svg).toContain("<foreignObject");
  });
});
