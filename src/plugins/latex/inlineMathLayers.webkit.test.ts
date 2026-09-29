/**
 * Real-WebKit tier — inline math keeps KaTeX's per-base wrappers out of
 * positioning, keeps `.katex` itself positioned, and moves nothing.
 *
 * KaTeX gives `.katex` and every `.katex-base` `position: relative` with no
 * offset. In WebKit each positioned box is a render layer; a math-heavy
 * document had ~11,000 of them after a scroll, 60% from these two classes,
 * and layer bookkeeping dominated every frame. latex.css makes `.katex-base`
 * static inside `.math-inline`.
 *
 * `.katex` stays positioned on purpose: it is the containing block of the
 * absolutely positioned, visually hidden MathML copy. Made static, that copy's
 * containing block became the editor's `.ProseMirror` root, and WebKit lays out
 * EVERY statically placed positioned descendant of a block whenever the block
 * lays out — measured on the synthetic textbook with all 10,963 formulas
 * rendered, a keystroke's forced layout went from 59 ms to 197 ms.
 *
 * jsdom computes no layout, so only a real engine can show either property.
 * **The failure is constructed, not assumed.** Each comparison restores
 * KaTeX's own positioning with an override and measures both, so a probe
 * that read nothing could not pass.
 */
import "katex/dist/katex.min.css";
import "@/styles/katexFixes.css";
import "./latex.css";
import { describe, it, expect, afterEach } from "vitest";
import katex from "katex";

/** Everyday school math plus the constructs KaTeX positions absolutely. */
const SOURCES = [
  "0", "-1", "x^2", "(-2)^{4}", "\\frac{2}{5}", "\\left(\\frac{2}{5}\\right)^{3}", "\\sqrt[3]{x+1}",
  "|a| = 8.7", "x_{i}^{2}", "\\begin{cases} x + y = 7 \\\\ x - y = 3 \\end{cases}", "\\overrightarrow{AB}",
  "\\widehat{ABC}", "\\underbrace{a \\times \\cdots \\times a}_{n}", "\\overbrace{1+2}^{3}", "\\not=",
  "\\llap{/}=", "\\xrightarrow{\\text{化简}}", "\\sum_{i=1}^{n} i", "\\cancel{x}", "\\boxed{x=2}", "\\binom{n}{k}",
];

/** KaTeX's own positioning, which latex.css overrides inside inline math. */
const KATEX_DEFAULT = ".math-inline .katex, .math-inline .katex .katex-base { position: relative !important; }";

let editorRoot: HTMLElement;
let override: HTMLStyleElement | null = null;

afterEach(() => {
  editorRoot?.remove();
  override?.remove();
  override = null;
});

/**
 * Render every source as the node view does — `.math-inline >
 * .math-inline-preview > .katex` — in a paragraph inside a positioned
 * `.ProseMirror`, as ProseMirror's own stylesheet positions the editor root.
 */
function renderInline(): HTMLElement {
  editorRoot = document.createElement("div");
  editorRoot.className = "ProseMirror";
  editorRoot.style.position = "relative";
  const paragraph = document.createElement("p");
  paragraph.style.cssText = "width:900px;font-size:18px;line-height:32px;";
  for (const source of SOURCES) {
    const node = document.createElement("span");
    node.className = "math-inline";
    const preview = document.createElement("span");
    preview.className = "math-inline-preview";
    katex.render(source, preview, { throwOnError: false, displayMode: false });
    node.appendChild(preview);
    paragraph.append(node, document.createTextNode(" 文字 "));
  }
  editorRoot.appendChild(paragraph);
  document.body.appendChild(editorRoot);
  return paragraph;
}

const katexBoxes = (root: HTMLElement) => [...root.querySelectorAll(".katex, .katex *")];

function geometry(root: HTMLElement): number[][] {
  return katexBoxes(root).map((el) => {
    const r = el.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  });
}

const positioned = (root: HTMLElement) =>
  katexBoxes(root).filter((el) => getComputedStyle(el).position !== "static").length;

function restoreKatexPositioning(): void {
  override = document.createElement("style");
  override.textContent = KATEX_DEFAULT;
  document.head.appendChild(override);
}

describe("inline math render layers", () => {
  it("keeps every .katex-base out of positioning", () => {
    const root = renderInline();
    const ours = positioned(root);
    const bases = root.querySelectorAll(".katex-base");
    expect(bases.length).toBeGreaterThan(SOURCES.length);
    for (const el of bases) expect(getComputedStyle(el).position).toBe("static");

    restoreKatexPositioning();
    expect(positioned(root)).toBeGreaterThan(ours);
  });

  it("keeps each formula's hidden MathML copy contained by its own .katex", () => {
    const root = renderInline();
    const copies = [...root.querySelectorAll<HTMLElement>(".katex-mathml")];
    expect(copies.length).toBe(SOURCES.length);
    for (const copy of copies) {
      expect(getComputedStyle(copy).position).toBe("absolute");
      expect(copy.offsetParent).toBe(copy.closest(".katex"));
    }
  });

  it("moves no KaTeX box", () => {
    const root = renderInline();
    const ours = geometry(root);
    restoreKatexPositioning();
    const katexs = geometry(root);

    expect(ours.length).toBe(katexs.length);
    expect(ours.length).toBeGreaterThan(500);
    const drift = Math.max(...ours.flatMap((box, i) => box.map((v, j) => Math.abs(v - katexs[i][j]))));
    expect(drift).toBeLessThan(0.01);
  });

  it("leaves KaTeX outside inline math (display math) as KaTeX styles it", () => {
    const display = document.createElement("div");
    katex.render("\\frac{1}{2}", display, { throwOnError: false, displayMode: true });
    document.body.appendChild(display);
    expect(getComputedStyle(display.querySelector(".katex")!).position).toBe("relative");
    display.remove();
  });
});
