/**
 * Real-WebKit tier — inline math does not make KaTeX's wrapper boxes render
 * layers, and taking them out of positioning moves nothing.
 *
 * KaTeX gives `.katex` and every `.katex-base` `position: relative` with no
 * offset. In WebKit each positioned box is a render layer; a math-heavy
 * document had ~11,000 of them after a scroll, 60% from these two classes,
 * and layer bookkeeping dominated every frame. latex.css makes them static
 * inside `.math-inline`. jsdom computes no layout, so only a real engine can
 * show that no glyph moved.
 *
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

let host: HTMLElement;
let override: HTMLStyleElement | null = null;

afterEach(() => {
  host?.remove();
  override?.remove();
  override = null;
});

/** Render every source as the node view does: `.math-inline > .math-inline-preview > .katex`. */
function renderInline(): HTMLElement {
  host = document.createElement("p");
  host.style.cssText = "width:900px;font-size:18px;line-height:32px;";
  for (const source of SOURCES) {
    const node = document.createElement("span");
    node.className = "math-inline";
    const preview = document.createElement("span");
    preview.className = "math-inline-preview";
    katex.render(source, preview, { throwOnError: false, displayMode: false });
    node.appendChild(preview);
    host.append(node, document.createTextNode(" 文字 "));
  }
  document.body.appendChild(host);
  return host;
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
  it("keeps KaTeX's wrapper boxes out of positioning", () => {
    const root = renderInline();
    const ours = positioned(root);
    for (const el of root.querySelectorAll(".katex, .katex-base")) {
      expect(getComputedStyle(el).position).toBe("static");
    }

    restoreKatexPositioning();
    expect(positioned(root)).toBeGreaterThan(ours);
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
