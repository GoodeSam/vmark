import { describe, it, expect } from "vitest";
import { captureBlockAnchor, anchorDistance } from "./scrollAnchor";

/** A scroller whose visible top is at y=40, over blocks of 100px at `tops`. */
function layout(tops: number[]) {
  const container = document.createElement("div");
  container.getBoundingClientRect = () => new DOMRect(0, 40, 800, 900);
  const blocks = document.createElement("div");
  const shift = { value: 0 };
  for (const top of tops) {
    const block = document.createElement("p");
    block.getBoundingClientRect = () => new DOMRect(0, top + shift.value, 800, 100);
    blocks.appendChild(block);
  }
  return { container, blocks, shift };
}

describe("captureBlockAnchor", () => {
  it("records the first block reaching the visible top, and where its top sits from that edge", () => {
    const { container, blocks } = layout([-300, -200, -100, 0, 100, 200]);
    // block 2 ends at y=0, above the edge at 40; block 3 spans 0..100.
    expect(captureBlockAnchor(container, blocks)).toEqual({ index: 3, offset: -40 });
  });

  it("finds it in a long document", () => {
    const tops = Array.from({ length: 5000 }, (_, i) => i * 100 - 250_000);
    const { container, blocks } = layout(tops);
    // y=40 falls in the block spanning 0..100: index 2500.
    expect(captureBlockAnchor(container, blocks)).toEqual({ index: 2500, offset: -40 });
  });

  it("is null without blocks, or when every block is above the visible top", () => {
    const empty = layout([]);
    expect(captureBlockAnchor(empty.container, empty.blocks)).toBeNull();
    expect(captureBlockAnchor(empty.container, null)).toBeNull();
    const above = layout([-500, -400]);
    expect(captureBlockAnchor(above.container, above.blocks)).toBeNull();
  });
});

describe("anchorDistance", () => {
  it("is how far to scroll for the anchored block to sit where it sat", () => {
    const { container, blocks, shift } = layout([-300, -200, -100, 0, 100, 200]);
    const anchor = captureBlockAnchor(container, blocks)!;

    shift.value = -250; // the content above it is 250px shorter in this mount
    expect(anchorDistance(container, blocks, anchor)).toBe(-250);
    shift.value = 0;
    expect(anchorDistance(container, blocks, anchor)).toBe(0);
  });

  it("is null when the block is gone (the document changed)", () => {
    const { container, blocks } = layout([0, 100]);
    expect(anchorDistance(container, blocks, { index: 7, offset: 0 })).toBeNull();
  });
});
