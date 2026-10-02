// @vitest-environment node
// WI-RA2.1 — how many whole-document parses respelling costs. Each one is paid
// synchronously on the save path, so the count is part of the contract.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Pass-through spies: the real functions run, and their calls are counted.
vi.mock("./hardBreakRanges", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hardBreakRanges")>();
  return { ...actual, findHardBreakRanges: vi.fn(actual.findHardBreakRanges) };
});
vi.mock("./parser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./parser")>();
  return { ...actual, parseMarkdownToMdast: vi.fn(actual.parseMarkdownToMdast) };
});

import { findHardBreakRanges } from "./hardBreakRanges";
import { parseMarkdownToMdast } from "./parser";
import { respellHardBreaks } from "./hardBreakRespell";

/** Parses of the text as written, to find candidate breaks. */
const finds = (): number => vi.mocked(findHardBreakRanges).mock.calls.length;
/** Document parses, to verify an edited text against the original. */
const verifies = (): number => vi.mocked(parseMarkdownToMdast).mock.calls.length;

beforeEach(() => {
  vi.mocked(findHardBreakRanges).mockClear();
  vi.mocked(parseMarkdownToMdast).mockClear();
});

describe("respellHardBreaks — parse count", () => {
  it.each([
    ["no line endings", "plain text", "twoSpaces"],
    ["only LaTeX row separators", "$$\na \\\\\nb \\\\\nc\n$$\n", "twoSpaces"],
    ["breaks already in the target spelling", "a  \nb\n", "twoSpaces"],
    ["breaks already in the target spelling", "a\\\nb\n", "backslash"],
  ] as const)("does not parse a document with %s", (_label, source, target) => {
    expect(respellHardBreaks(source, target)).toBe(source);
    expect([finds(), verifies()]).toEqual([0, 0]);
  });

  it.each([
    ["a table with trailing spaces", "| a |  \n| - |  \n", "backslash"],
    ["a backslash that ends a line of code", "```\na \\\nb\n```\n", "twoSpaces"],
  ] as const)("parses once when %s turns out to hold no break", (_label, source, target) => {
    expect(respellHardBreaks(source, target)).toBe(source);
    expect([finds(), verifies()]).toEqual([1, 0]);
  });

  it.each([
    ["twoSpaces", "a\\\nb\n", "a  \nb\n"],
    ["backslash", "a  \nb\n", "a\\\nb\n"],
  ] as const)("converts to %s with one finding parse and two verifying ones", (target, source, expected) => {
    expect(respellHardBreaks(source, target)).toBe(expected);
    expect([finds(), verifies()]).toEqual([1, 2]);
  });

  // Each of these respellings would change the tree. Not attempting it leaves
  // nothing to verify — and, in a longer document, nothing to make the
  // verification of the other edits fail.
  it.each([
    ["a break that starts its line", "\\\nb\n", "twoSpaces"],
    ["a break after a soft break", "a\n\\\nb\n", "twoSpaces"],
    // No space after `>`: the character before the break is the marker, so
    // only the preceding text's own value says the line is otherwise empty.
    ["a break after a soft break in a tight blockquote", ">a\n>\\\n>b\n", "twoSpaces"],
    ["a break after a soft break in a blockquote", "> a\n> \\\n> b\n", "twoSpaces"],
    ["a backslash break after a space", "a \\\nb\n", "twoSpaces"],
    ["a backslash break after a tab", "a\t\\\nb\n", "twoSpaces"],
    ["a two-space break after an unpaired backslash", "a\\  \nb\n", "backslash"],
  ] as const)("does not attempt %s, so there is nothing to verify", (_label, source, target) => {
    expect(respellHardBreaks(source, target)).toBe(source);
    expect([finds(), verifies()]).toEqual([1, 0]);
  });

  // The same rules, seen from the output: the break that cannot be respelled
  // is skipped, and the one beside it is still converted.
  it.each([
    ["the second of two consecutive breaks", "a\\\n\\\nb\n", "twoSpaces", "a  \n\\\nb\n"],
    ["a break after a space", "a\\\nb \\\nc\n", "twoSpaces", "a  \nb \\\nc\n"],
    ["a break after an unpaired backslash", "a  \nb\\  \nc\n", "backslash", "a\\\nb\\  \nc\n"],
  ] as const)("skips %s and converts its neighbour", (_label, source, target, expected) => {
    expect(respellHardBreaks(source, target)).toBe(expected);
    expect([finds(), verifies()]).toEqual([1, 2]);
  });

  it("verifies once and gives up when an unforeseen edit changes the document", () => {
    // `| h |\` becomes a table header as `| h |  `. No rule foresees it; the
    // verification refuses, and the whole document is left as written.
    const source = "a\\\nb\n\n| h |\\\n| - |\n";
    expect(respellHardBreaks(source, "twoSpaces")).toBe(source);
    expect([finds(), verifies()]).toEqual([1, 2]);
  });
});
