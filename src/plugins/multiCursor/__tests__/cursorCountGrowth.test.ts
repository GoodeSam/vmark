// @vitest-environment node
// WI-RA23.1 — every multi-cursor operation costs at most about linearly in the
// number of cursors.
//
// "Select all occurrences" of a common word reaches hundreds of cursors, and
// each keystroke then runs once per cursor. Typing measured N^2.30 — 273 ms per
// keystroke at 500 cursors — because every edit re-mapped the whole selection
// and every cursor was mapped through every edit. Each operation here is timed
// at 50 and at 500 cursors on a fixed paragraph, on the test thread's CPU clock
// (`measureGrowth`), and its growth exponent must stay below 1.5: the work is
// at most a sort of the cursors (N log N, which reads about 1.2 over this
// range), while a cost quadratic in the cursors reads 2. A wall-clock budget
// would measure the machine's load instead (the tests it replaced failed only
// under parallel suites). Typing itself is pinned in feature-complete.test.ts.
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, SelectionRange, TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { MultiSelection } from "@/plugins/shared/MultiSelection";
import { measureGrowth, growthExponent } from "@/test/cpuClock";
import { multiCursorPlugin } from "../multiCursorPlugin";
import {
  handleMultiCursorBackspace,
  handleMultiCursorDelete,
  handleMultiCursorInput,
} from "../inputHandling";

const SMALL = 50;
const LARGE = 500;
const MAX_EXPONENT = 1.5;
const PARAGRAPH_LENGTH = 2000;

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

/** One paragraph of `text` with the multi-cursor plugin and the given ranges selected. */
function stateWith(text: string, ranges: ReadonlyArray<readonly [number, number]>): EditorState {
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text(text)])]);
  const base = EditorState.create({
    doc,
    schema,
    plugins: [multiCursorPlugin()],
    selection: TextSelection.atStart(doc),
  });
  const selected = ranges.map(([from, to]) => new SelectionRange(doc.resolve(from), doc.resolve(to)));
  return base.apply(base.tr.setSelection(new MultiSelection(selected, selected.length - 1)));
}

/** `count` evenly spaced ranges of `width` characters across the paragraph. */
function spaced(count: number, width: number): Array<[number, number]> {
  const step = Math.floor(PARAGRAPH_LENGTH / count);
  return Array.from({ length: count }, (_, i) => [1 + i * step, 1 + i * step + width]);
}

const cursorsAcross = (count: number) => stateWith("0".repeat(PARAGRAPH_LENGTH), spaced(count, 0));
const selectionsAcross = (count: number) => stateWith("0".repeat(PARAGRAPH_LENGTH), spaced(count, 1));

/** The growth exponent of `operation` from SMALL to LARGE cursors, applying its transaction. */
function exponentOf(
  build: (count: number) => EditorState,
  operation: (state: EditorState) => Transaction | null,
): number {
  const run = (state: EditorState) => {
    const tr = operation(state);
    if (!tr) throw new Error("the operation declined: nothing was measured");
    state.apply(tr);
  };
  return growthExponent(measureGrowth(run, build(SMALL), build(LARGE)), SMALL, LARGE);
}

describe("multi-cursor cost grows at most linearly with the cursor count", () => {
  it("typing over a selection at every cursor", () => {
    expect(exponentOf(selectionsAcross, (s) => handleMultiCursorInput(s, "X"))).toBeLessThan(MAX_EXPONENT);
  });

  it("Backspace at every cursor", () => {
    expect(exponentOf(cursorsAcross, handleMultiCursorBackspace)).toBeLessThan(MAX_EXPONENT);
  });

  it("Delete at every cursor", () => {
    expect(exponentOf(cursorsAcross, handleMultiCursorDelete)).toBeLessThan(MAX_EXPONENT);
  });
});
