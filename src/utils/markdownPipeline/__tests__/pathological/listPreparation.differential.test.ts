// @vitest-environment node
/**
 * #1473 — preparing list items must not change a parse.
 *
 * `mdast-util-from-markdown` adds a `listItem` enter and exit around every
 * list item, and infers each item's and each list's `spread`, before it builds
 * the tree. `patches/mdast-util-from-markdown@2.0.3.patch` changes only HOW the
 * enters and exits get into the event array (queued for the whole document,
 * inserted in one pass, instead of one `splice` each). That is a cost change
 * and nothing else: the mdast must be identical — node for node, position for
 * position, `spread` for `spread`.
 *
 * With the patch applied there is no unpatched from-markdown left to run, so
 * the reference is RECORDED. `listPreparation.reference.json` holds what the
 * UNPATCHED 2.0.3 produced for three corpora:
 *
 *   1. named inputs, one per list shape — nesting, loose and tight, task
 *      lists, CJK and RTL, lists in blockquotes and blockquotes in lists,
 *      odd ordered starts, lazy lines, CRLF, empty items, trailing blanks —
 *      stored whole, so a failure diffs readably;
 *   2. every example of the pinned CommonMark and GFM corpora whose tree
 *      holds a list, stored as a digest;
 *   3. a seeded fuzz dense in list markers, indentation, blockquote prefixes
 *      and blank lines — the interactions nobody wrote down — as digests.
 *
 * To re-record (only ever against an UNPATCHED from-markdown — recording a
 * patched one makes this test compare the patch with itself): remove the
 * `mdast-util-from-markdown@2.0.3` entry from `pnpm.patchedDependencies`,
 * `pnpm install`, run this file with `VMARK_RECORD_LIST_REFERENCE=1`, restore
 * the entry, `pnpm install`. A recording run always FAILS, so it can never
 * pass for a verification.
 *
 * That the patch makes anything faster is the other half of the contract, and
 * lives in `pathologicalScaling.test.ts`.
 *
 * @coordinates-with patches/mdast-util-from-markdown@2.0.3.patch — the change under test
 * @coordinates-with pathologicalScaling.test.ts — its growth bound
 * @coordinates-with ../spec/corpusRegistry.ts — the pinned corpora
 * @module utils/markdownPipeline/__tests__/pathological/listPreparation.differential.test
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CORPORA, loadExamples } from "../spec/corpusRegistry";

const REFERENCE_PATH = new URL("./listPreparation.reference.json", import.meta.url);
const RECORD = process.env.VMARK_RECORD_LIST_REFERENCE === "1";

/** Stock syntax only: the contract is from-markdown's, not VMark's dialect. */
const processor = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).use(remarkMath);

/** The pinned upstream corpora (the registry checks each file's sha256). */
const CORPUS_PREFIXES = ["cm", "gfm", "cmreg", "gfmreg", "gfmext"];

const NAMED: Record<string, string> = {
  "tight-bullets": "- a\n- b\n- c\n",
  "loose-bullets": "- a\n\n- b\n\n- c\n",
  "loose-by-inner-blank": "- a\n\n  b\n- c\n",
  "blank-between-last-two": "- a\n- b\n\n- c\n",
  "star-and-plus": "* a\n* b\n\n+ c\n+ d\n",
  "marker-change-splits": "- a\n* b\n+ c\n- d\n",
  "ordered-odd-start": "7. a\n8. b\n9. c\n",
  "ordered-zero-start": "0. a\n1. b\n",
  "ordered-leading-zeros": "003. a\n004. b\n",
  "ordered-paren": "1) a\n2) b\n\n3) c\n",
  "ordered-large-start": "123456789. a\n123456790. b\n",
  "ordered-then-bullet": "1. a\n2. b\n- c\n- d\n",
  "nested-tight": "- a\n  - b\n    - c\n  - d\n- e\n",
  "nested-inner-loose": "- a\n  - b\n\n  - c\n- d\n",
  "nested-blank-after-inner": "- a\n  - b\n  - c\n\n- d\n",
  "nested-ordered-in-bullet": "- a\n  1. b\n  2. c\n- d\n  3. e\n",
  "nested-one-line": "- - - a\n  - b\n",
  "nested-deep-blank-tail": "- a\n  - b\n    - c\n\n\n- d\n",
  "list-in-blockquote": "> - a\n> - b\n>\n> - c\n",
  "blockquote-in-list": "- > a\n- > b\n\n- c\n",
  "list-in-quote-in-list": "- > - a\n  > - b\n  >\n  > - c\n- d\n",
  "quote-lazy-list": "> - a\nlazy\n> - b\n",
  "task-list": "- [ ] a\n- [x] b\n  - [ ] c\n- [X] d\n",
  "task-list-loose": "- [ ] a\n\n- [x] b\n",
  "cjk-items": "- 中文项目\n- 日本語のテキスト\n\n- 한국어 항목\n",
  "rtl-items": "- مرحبا بالعالم\n- שלום עולם\n",
  "math-items": "- $x^2$\n- $\\frac{1}{2}$ 和 $y$\n",
  "empty-items": "-\n- a\n-\n",
  "empty-then-content": "-\n  foo\n- bar\n",
  "blank-first-line": "-\n\n  a\n- b\n",
  "code-in-item": "- a\n\n      code\n- b\n",
  "fence-in-item": "- a\n  ```\n  code\n\n  more\n  ```\n- b\n",
  "html-in-item": "- <div>\n  x\n  </div>\n- b\n",
  "heading-interrupts": "- a\n- b\n# h\n- c\n",
  "thematic-break-interrupts": "- a\n- b\n***\n- c\n",
  "lazy-continuation": "- a\nb\n- c\n",
  "multi-paragraph-items": "1. a\n\n   b\n\n2. c\n\n   d\n",
  "trailing-blank-lines": "- a\n- b\n\n\n\n",
  "list-then-paragraph": "- a\n- b\n\nafter\n",
  "tab-indented": "-\ta\n\t-\tb\n-\tc\n",
  "crlf": "- a\r\n- b\r\n\r\n- c\r\n",
  "no-final-newline": "- a\n- b",
  "footnote-with-list": "Text[^1]\n\n[^1]: - a\n    - b\n",
  "definition-after-list": "- [a]\n- b\n\n[a]: /u\n",
  "table-after-list": "- a\n\n| x | y |\n|---|---|\n| 1 | 2 |\n",
  "wide-list": Array.from({ length: 40 }, (_, i) => `- item ${i}\n`).join(""),
  "many-short-lists": "P.\n\n1. a\n2. b\n\n".repeat(12),
  "sibling-lists-separated": "- a\n\n<!-- -->\n\n- b\n",
};

/** mulberry32: small, deterministic, well distributed. */
function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_PREFIXES = ["", "", "", "", "> ", ">", "> > ", " ", "  ", "   ", "    ", "\t", "      "];
const FUZZ_MARKERS = [
  "- ", "- ", "* ", "+ ", "1. ", "2. ", "10. ", "0. ", "7) ", "-\t", "1.\t", "-", "1.", "-   ",
  "- - ", "1. - ", "- 1. ", "- [ ] ", "- [x] ", "* [X] ", "1. [ ] ",
];
const FUZZ_TEXT = [
  "a", "item", "中文项目", "日本語", "مرحبا", "$x^2$", "**b** c", "`c`", "[l](u)", "t  ", "",
  "b\\", "<b>x</b>",
];
const FUZZ_BLOCKS = [
  "", "", "", "", "para", "lazy text", "```", "~~~", "# h", "---", "***", "    indented",
  "<div>", "| a | b |", "|---|---|", "[x]: /u", "$$",
];
const FUZZ_COUNT = 400;

function fuzzDocument(seed: number): string {
  const next = prng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const lines: string[] = [];
  const count = 3 + Math.floor(next() * 14);
  for (let i = 0; i < count; i += 1) {
    const body = next() < 0.55 ? `${pick(FUZZ_MARKERS)}${pick(FUZZ_TEXT)}` : pick(FUZZ_BLOCKS);
    lines.push(`${pick(FUZZ_PREFIXES)}${body}`);
  }
  return lines.join(next() < 0.1 ? "\r\n" : "\n") + pick(["", "\n", "\n\n"]);
}

/**
 * The tree as a comparable string: keys sorted (so a refactor that builds a
 * node's fields in another order is not a difference), positions compacted.
 */
function canonical(node: unknown): string {
  return JSON.stringify(normalize(node));
}

function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node).sort()) {
    const value = (node as Record<string, unknown>)[key];
    out[key] = key === "position" ? compactPosition(value) : normalize(value);
  }
  return out;
}

function compactPosition(value: unknown): string {
  const { start, end } = value as {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
  return `${start.line}:${start.column}:${start.offset}-${end.line}:${end.column}:${end.offset}`;
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function hasList(node: unknown): boolean {
  if (node === null || typeof node !== "object") return false;
  if ((node as { type?: unknown }).type === "list") return true;
  const children = (node as { children?: unknown }).children;
  return Array.isArray(children) && children.some(hasList);
}

function parse(markdown: string): unknown {
  return processor.parse(markdown);
}

interface Reference {
  /** How and from what this file was recorded. */
  provenance: string;
  named: Record<string, string>;
  /** `<corpus prefix>-<example>` → digest of the canonical tree. */
  corpus: Record<string, string>;
  /** `fuzz-<seed>` → digest of the canonical tree. */
  fuzz: Record<string, string>;
}

function corpusExamples(): Map<string, string> {
  const examples = new Map<string, string>();
  for (const entry of CORPORA) {
    if (!CORPUS_PREFIXES.includes(entry.prefix)) continue;
    for (const example of loadExamples(entry)) examples.set(example.id, example.markdown);
  }
  return examples;
}

function record(): Reference {
  const named: Record<string, string> = {};
  for (const [name, markdown] of Object.entries(NAMED)) named[name] = canonical(parse(markdown));
  const corpus: Record<string, string> = {};
  for (const [id, markdown] of corpusExamples()) {
    const tree = parse(markdown);
    if (hasList(tree)) corpus[id] = digest(canonical(tree));
  }
  const fuzz: Record<string, string> = {};
  for (let seed = 0; seed < FUZZ_COUNT; seed += 1) {
    fuzz[`fuzz-${seed}`] = digest(canonical(parse(fuzzDocument(seed))));
  }
  return {
    provenance:
      "Recorded from UNPATCHED mdast-util-from-markdown@2.0.3 (remark-parse 11.0.0, " +
      "remark-gfm 4.0.1, remark-math 6.0.0, patched micromark 4.0.2) by " +
      "listPreparation.differential.test.ts in record mode. See its header before re-recording.",
    named,
    corpus,
    fuzz,
  };
}

describe("list preparation matches the unpatched from-markdown (#1473)", () => {
  if (RECORD) {
    it("records the reference (always fails: a recording is not a verification)", () => {
      writeFileSync(REFERENCE_PATH, `${JSON.stringify(record(), null, 2)}\n`);
      expect.fail(`Recorded ${REFERENCE_PATH.pathname}; re-run without VMARK_RECORD_LIST_REFERENCE.`);
    });
    return;
  }

  const reference = JSON.parse(readFileSync(REFERENCE_PATH, "utf8")) as Reference;

  it("covers every named input, every corpus list example, and a list-dense fuzz", () => {
    expect(Object.keys(reference.named).sort()).toEqual(Object.keys(NAMED).sort());
    // The pinned corpora hold exactly this many examples whose tree has a
    // list. A re-recording that drops some would otherwise pass quietly.
    expect(Object.keys(reference.corpus)).toHaveLength(89);
    expect(Object.keys(reference.fuzz)).toHaveLength(FUZZ_COUNT);
    // A fuzz that stopped producing lists would compare nothing of interest.
    // Measured: 335 of the 400 documents hold at least one list.
    let withLists = 0;
    for (let seed = 0; seed < FUZZ_COUNT; seed += 1) {
      if (hasList(parse(fuzzDocument(seed)))) withLists += 1;
    }
    expect(withLists).toBeGreaterThanOrEqual(FUZZ_COUNT * 0.8);
  });

  it.each(Object.keys(NAMED))("named input %s parses to the recorded tree", (name) => {
    expect(canonical(parse(NAMED[name])), JSON.stringify(NAMED[name])).toBe(reference.named[name]);
  });

  it("every pinned corpus example with a list parses to the recorded tree", () => {
    const examples = corpusExamples();
    const mismatches: string[] = [];
    for (const [id, expected] of Object.entries(reference.corpus)) {
      const markdown = examples.get(id);
      if (markdown === undefined) {
        mismatches.push(`${id}: example no longer in its corpus`);
        continue;
      }
      if (digest(canonical(parse(markdown))) !== expected) mismatches.push(`${id}: ${JSON.stringify(markdown)}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("every seeded fuzz document parses to the recorded tree", () => {
    const mismatches: string[] = [];
    for (let seed = 0; seed < FUZZ_COUNT; seed += 1) {
      const markdown = fuzzDocument(seed);
      if (digest(canonical(parse(markdown))) !== reference.fuzz[`fuzz-${seed}`]) {
        mismatches.push(`fuzz-${seed}: ${JSON.stringify(markdown)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
