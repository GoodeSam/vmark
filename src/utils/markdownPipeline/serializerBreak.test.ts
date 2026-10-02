// @vitest-environment node
// WI-RA2.1 — the hard-break style is applied where a `break` node is
// serialized, so nothing that merely looks like a break (math, HTML, a literal
// backslash) is rewritten.
// WI-RA2.2 — a literal trailing backslash before a soft break stays a soft
// break in two-space style.
import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";
import type { Node as PMNode } from "@tiptap/pm/model";
import { parseMarkdown, serializeMarkdown } from "./adapter";
import { serializeMdastToMarkdown } from "./serializer";
import { getProductionSchema } from "@/test/productionSchema";

const schema = getProductionSchema();
const TWO_SPACES = { hardBreakStyle: "twoSpaces" } as const;
const BACKSLASH = { hardBreakStyle: "backslash" } as const;

const roundTrip = (markdown: string, options = {}): string =>
  serializeMarkdown(schema, parseMarkdown(schema, markdown), options);

/** Number of hard-break nodes anywhere in a document. */
function countHardBreaks(doc: PMNode): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === "hardBreak") count += 1;
  });
  return count;
}

const text = (value: string) => ({ type: "text" as const, value });
const hardBreak = { type: "break" as const };
const root = (children: unknown[]): Root => ({ type: "root", children }) as Root;
const paragraph = (children: unknown[]) => ({ type: "paragraph", children });

describe("hard-break style — constructs that are not hard breaks", () => {
  it("leaves a LaTeX row separator inside a $$ block alone", () => {
    const source = "$$\na \\\\\nb\n$$\n";
    expect(roundTrip(source, TWO_SPACES)).toBe(source);
  });

  it("leaves a backslash line ending inside an HTML block alone", () => {
    const source = "<div>\na \\\nb\n</div>\n";
    expect(roundTrip(source, TWO_SPACES)).toBe(source);
  });

  it("leaves a backslash line ending inside an inline HTML attribute alone", () => {
    const source = 'x <span title="a\\\nb">y</span>\n';
    expect(roundTrip(source, TWO_SPACES)).toBe(source);
  });

  it("leaves a backslash line ending inside inline math alone", () => {
    const source = "x $a \\\\\nb$ y\n";
    expect(roundTrip(source, TWO_SPACES)).toBe(source);
  });

  it("leaves fenced code alone", () => {
    const source = "```\na \\\nb\n```\n";
    expect(roundTrip(source, TWO_SPACES)).toBe(source);
  });

  it("keeps a literal trailing backslash before a soft break a soft break", () => {
    const source = "C:\\dir\\\\\nnext\n";
    const before = parseMarkdown(schema, source);
    expect(countHardBreaks(before)).toBe(0);

    const output = roundTrip(source, TWO_SPACES);
    const after = parseMarkdown(schema, output);
    expect(countHardBreaks(after)).toBe(0);
    expect(after.textContent).toBe(before.textContent);
  });
});

describe("hard-break style — real hard breaks", () => {
  it.each([
    ["paragraph", "a\\\nb\n", "a  \nb\n"],
    // A mark spanning a break comes back as one wrapper per side: the break is
    // an unmarked atom between two marked text nodes.
    ["emphasis", "*a*\\\n*b*\n", "*a*  \n*b*\n"],
    ["blockquote", "> a\\\n> b\n", "> a  \n> b\n"],
    ["list item", "- a\\\n  b\n", "- a  \n  b\n"],
    ["CJK", "中文\\\n日本語\n", "中文  \n日本語\n"],
  ])("writes a %s break in each style", (_label, backslash, twoSpaces) => {
    expect(roundTrip(backslash, BACKSLASH)).toBe(backslash);
    expect(roundTrip(backslash, TWO_SPACES)).toBe(twoSpaces);
    expect(roundTrip(twoSpaces, BACKSLASH)).toBe(backslash);
    expect(roundTrip(twoSpaces, TWO_SPACES)).toBe(twoSpaces);
  });

  it("defaults to the backslash style", () => {
    expect(roundTrip("a  \nb\n")).toBe("a\\\nb\n");
  });

  it.each([
    ["two-space", TWO_SPACES],
    ["backslash", BACKSLASH],
  ])("keeps a literal backslash before a real break in %s style", (_label, options) => {
    const tree = root([paragraph([text("a\\"), hardBreak, text("b")])]);
    const doc = parseMarkdown(schema, serializeMdastToMarkdown(tree, options));
    expect(countHardBreaks(doc)).toBe(1);
    expect(doc.textContent).toBe("a\\b");
  });

  it.each([
    ["a leading break", [hardBreak, text("b")], 1],
    ["consecutive breaks", [text("a"), hardBreak, hardBreak, text("b")], 2],
    ["three consecutive breaks", [text("a"), hardBreak, hardBreak, hardBreak, text("b")], 3],
  ])("does not turn %s into a blank line in two-space style", (_label, children, expected) => {
    const output = serializeMdastToMarkdown(root([paragraph(children)]), TWO_SPACES);
    const doc = parseMarkdown(schema, output);
    expect(doc.childCount).toBe(1);
    expect(countHardBreaks(doc)).toBe(expected);
  });

  it("writes a break in a table cell as a space, never a line ending", () => {
    const cell = (children: unknown[]) => ({ type: "tableCell", children });
    const row = (cells: unknown[]) => ({ type: "tableRow", children: cells });
    const tree = root([
      {
        type: "table",
        align: [null],
        children: [
          row([cell([text("h")])]),
          row([cell([text("a"), hardBreak, text("b")])]),
          row([cell([text("a "), hardBreak, text("b")])]),
        ],
      },
    ]);
    for (const options of [TWO_SPACES, BACKSLASH]) {
      expect(serializeMdastToMarkdown(tree, options)).toBe(
        "| h   |\n| --- |\n| a b |\n| a b |\n",
      );
    }
  });

  it("is stable on a second round trip in both styles", () => {
    const source = "a\\\nb\n\n$$\nx \\\\\ny\n$$\n\n> c  \n> d\n";
    for (const options of [TWO_SPACES, BACKSLASH]) {
      const once = roundTrip(source, options);
      expect(roundTrip(once, options)).toBe(once);
    }
  });
});

describe("hard-break style — agreement with stock remark-stringify", () => {
  // The handler replaces upstream's, so its "is a line ending allowed here"
  // answer must not drift from upstream's. In backslash style the two must
  // produce the same text for every construct a break can sit in.
  const stock = unified().use(remarkStringify, { bullet: "-", emphasis: "*" }).use(remarkGfm);

  const cell = (children: unknown[]) => ({ type: "tableCell", children });
  const row = (cells: unknown[]) => ({ type: "tableRow", children: cells });
  const inline = [text("a"), hardBreak, text("b")];
  const cases: Array<[string, Root]> = [
    ["paragraph", root([paragraph(inline)])],
    ["heading", root([{ type: "heading", depth: 2, children: inline }])],
    ["emphasis", root([paragraph([{ type: "emphasis", children: inline }])])],
    ["strong", root([paragraph([{ type: "strong", children: inline }])])],
    ["delete", root([paragraph([{ type: "delete", children: inline }])])],
    ["blockquote", root([{ type: "blockquote", children: [paragraph(inline)] }])],
    [
      "list item",
      root([
        {
          type: "list",
          ordered: false,
          spread: false,
          children: [{ type: "listItem", spread: false, children: [paragraph(inline)] }],
        },
      ]),
    ],
    [
      "table cell",
      root([
        {
          type: "table",
          align: [null],
          children: [row([cell([text("h")])]), row([cell(inline)])],
        },
      ]),
    ],
    ["leading break", root([paragraph([hardBreak, text("b")])])],
    ["consecutive breaks", root([paragraph([text("a"), hardBreak, hardBreak, text("b")])])],
  ];

  it.each(cases)("matches upstream for a break in a %s", (_label, tree) => {
    expect(serializeMdastToMarkdown(structuredClone(tree), BACKSLASH)).toBe(
      stock.stringify(structuredClone(tree)),
    );
  });
});
