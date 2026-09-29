import { describe, it, expect, vi, afterEach } from "vitest";
import { measureAboveViewport, holdViewStill } from "./renderAnchor";

/** A scroller whose visible box starts at `top`, with a writable scrollTop. */
function scroller(top = 100, anchor = "auto"): HTMLElement {
  const root = document.createElement("div");
  let scrollTop = 5000;
  Object.defineProperty(root, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  root.getBoundingClientRect = () => new DOMRect(0, top, 800, 900);
  root.dataset.anchor = anchor;
  document.body.appendChild(root);
  return root;
}

/** A block whose box spans `top`..`top + height()`; `height` may change later. */
function block(root: HTMLElement, top: number, height: () => number): HTMLElement {
  const el = document.createElement("p");
  el.getBoundingClientRect = () => new DOMRect(0, top, 800, height());
  root.appendChild(el);
  return el;
}

/** The engine's anchoring support and each scroller's computed overflow-anchor. */
function engine(supportsAnchoring: boolean): void {
  vi.stubGlobal("CSS", { supports: (property: string, value: string) => supportsAnchoring && property === "overflow-anchor" && value === "auto" });
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
    const style = real(el);
    const anchor = el instanceof HTMLElement ? el.dataset.anchor : undefined;
    return anchor ? ({ ...style, overflowAnchor: anchor } as CSSStyleDeclaration) : style;
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("holdViewStill — engines without scroll anchoring (WKWebView before macOS 27)", () => {
  it("scrolls by what blocks above the visible top gained, so the visible content stays put", () => {
    engine(false);
    const root = scroller(100);
    let grownHeight = 200;
    const above = block(root, -250, () => grownHeight); // ends at -50: entirely above y=100
    const measured = measureAboveViewport([{ root, block: above }]);

    grownHeight = 260; // the render made it 60px taller
    holdViewStill(measured);

    expect(root.scrollTop).toBe(5060);
  });

  it("follows a block that shrank as well as one that grew", () => {
    engine(false);
    const root = scroller(100);
    let h1 = 100;
    let h2 = 100;
    const first = block(root, -400, () => h1);
    const second = block(root, -200, () => h2);
    const measured = measureAboveViewport([{ root, block: first }, { root, block: second }]);

    h1 = 150;
    h2 = 70;
    holdViewStill(measured);

    expect(root.scrollTop).toBe(5020);
  });

  it("leaves the scroll alone for a block that reaches into the visible box", () => {
    engine(false);
    const root = scroller(100);
    let h = 200;
    const straddling = block(root, 0, () => h); // 0..200 crosses y=100
    const below = block(root, 400, () => h);
    const measured = measureAboveViewport([{ root, block: straddling }, { root, block: below }]);

    h = 300;
    holdViewStill(measured);

    expect(root.scrollTop).toBe(5000);
  });

  it("counts a block once however many renders wait in it", () => {
    engine(false);
    const root = scroller(100);
    let h = 100;
    const above = block(root, -300, () => h);
    const measured = measureAboveViewport([{ root, block: above }, { root, block: above }, { root, block: above }]);

    h = 130;
    holdViewStill(measured);

    expect(root.scrollTop).toBe(5030);
  });

  it("ignores a block removed from the document meanwhile", () => {
    engine(false);
    const root = scroller(100);
    let h = 100;
    const above = block(root, -300, () => h);
    const measured = measureAboveViewport([{ root, block: above }]);

    h = 500;
    above.remove();
    holdViewStill(measured);

    expect(root.scrollTop).toBe(5000);
  });

  it("corrects each scroller by its own blocks", () => {
    engine(false);
    const left = scroller(100);
    const right = scroller(100);
    let hl = 100;
    let hr = 100;
    const measured = measureAboveViewport([
      { root: left, block: block(left, -300, () => hl) },
      { root: right, block: block(right, -300, () => hr) },
    ]);

    hl = 110;
    hr = 90;
    holdViewStill(measured);

    expect(left.scrollTop).toBe(5010);
    expect(right.scrollTop).toBe(4990);
  });

  it("skips items with no block yet", () => {
    engine(false);
    const root = scroller(100);
    const measured = measureAboveViewport([{ root, block: null }]);
    holdViewStill(measured);
    expect(root.scrollTop).toBe(5000);
  });

});

describe("holdViewStill — engines that anchor scrolling themselves", () => {
  it("does nothing where CSS scroll anchoring is on (Chromium, Safari 27+)", () => {
    engine(true);
    const root = scroller(100, "auto");
    let h = 100;
    const measured = measureAboveViewport([{ root, block: block(root, -300, () => h) }]);

    h = 200;
    holdViewStill(measured);

    expect(root.scrollTop).toBe(5000);
  });

  it("corrects a scroller that opted out with overflow-anchor: none", () => {
    engine(true);
    const root = scroller(100, "none");
    let h = 100;
    const measured = measureAboveViewport([{ root, block: block(root, -300, () => h) }]);

    h = 140;
    holdViewStill(measured);

    expect(root.scrollTop).toBe(5040);
  });

  it("treats an engine with no CSS.supports as not anchoring", () => {
    vi.stubGlobal("CSS", undefined);
    const root = scroller(100);
    let h = 100;
    const measured = measureAboveViewport([{ root, block: block(root, -300, () => h) }]);

    h = 125;
    holdViewStill(measured);

    expect(root.scrollTop).toBe(5025);
  });
});
