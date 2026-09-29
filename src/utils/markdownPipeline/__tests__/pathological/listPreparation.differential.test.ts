// @vitest-environment node
/**
 * #1473 — preparing list items must not change a parse.
 *
 * `mdast-util-from-markdown` adds a `listItem` enter and exit around every
 * list item, and infers each item's and each list's `spread`, before it builds
 * the tree. `patches/mdast-util-from-markdown@2.0.3.patch` changes only HOW the
 * enters and exits get into the event array (queued for the whole document,
 * inserted in one pass, instead of one `splice` each). That is a cost change
 * and nothing else, so two things must be identical to the unpatched package:
 *
 *   - the mdast — node for node, position for position, `spread` for `spread`;
 *   - the event order around line endings. The tree alone cannot show where an
 *     item's exit sits among its trailing line endings (a line ending outside a
 *     paragraph adds nothing to it), yet that is exactly what the patch
 *     places. An mdast extension that only OBSERVES line endings — it adds
 *     handlers for events that have none by default — records each one's type
 *     (the walk rewrites `lineEnding` and `lineEndingBlank`) and the node
 *     stack open around it.
 *
 * Both builds are checked, each loaded by path: `dev/` (the `development`
 * export condition, which vitest resolves) and `lib/` (the `default` one,
 * which the production bundle ships). The patch edits them separately.
 *
 * With the patch applied there is no unpatched from-markdown left to run, so
 * the reference is RECORDED. `listPreparation.reference.json` holds what the
 * UNPATCHED 2.0.3 produced for three corpora:
 *
 *   1. named inputs, one per list shape — nesting, loose and tight, task
 *      lists, CJK and RTL, lists in blockquotes and blockquotes in lists,
 *      odd ordered starts, lazy lines, CRLF, empty items, trailing blanks —
 *      trees stored whole, so a failure diffs readably;
 *   2. every example of the pinned CommonMark and GFM corpora whose tree
 *      holds a list, stored as digests;
 *   3. a seeded fuzz dense in list markers, indentation, blockquote prefixes
 *      and blank lines — the interactions nobody wrote down — as digests.
 *
 * To re-record: remove the `mdast-util-from-markdown@2.0.3` entry from
 * `pnpm.patchedDependencies`, `pnpm install`, run this file with
 * `VMARK_RECORD_LIST_REFERENCE=1`, restore the entry, `pnpm install`. The
 * recorder refuses unless both installed builds hash to the pristine 2.0.3
 * files — recording a patched build would make this test compare the patch
 * with itself — and a recording run always FAILS, so it can never pass for a
 * verification.
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
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CORPORA, loadExamples } from "../spec/corpusRegistry";

const REFERENCE_PATH = new URL("./listPreparation.reference.json", import.meta.url);
const RECORD = process.env.VMARK_RECORD_LIST_REFERENCE === "1";

type FromMarkdown = (
  markdown: string,
  options: { extensions: unknown[]; mdastExtensions: unknown[] },
) => unknown;

type Build = "development" | "production";
const BUILDS: readonly Build[] = ["development", "production"];

/**
 * The installed package's directory, found the way remark-parse finds it. The
 * resolved entry depends on the export conditions in force (vitest adds
 * `development`), so walk up from it to the package's own `package.json`.
 */
function packageRoot(): string {
  const remarkParse = createRequire(import.meta.url).resolve("remark-parse");
  let dir = dirname(createRequire(remarkParse).resolve("mdast-util-from-markdown"));
  while (dirname(dir) !== dir) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
      if (manifest.name === "mdast-util-from-markdown") return dir;
    } catch {
      // No package.json here; keep walking up.
    }
    dir = dirname(dir);
  }
  throw new Error("mdast-util-from-markdown: package root not found");
}
const PACKAGE_ROOT = packageRoot();
const ENTRY: Record<Build, string> = { development: "dev/index.js", production: "index.js" };
const IMPLEMENTATION: Record<Build, string> = { development: "dev/lib/index.js", production: "lib/index.js" };

/** sha256 of each build's implementation in the pristine 2.0.3 tarball. */
const PRISTINE_SHA256: Record<Build, string> = {
  development: "bc4760bec02ae905b362fbe7eb7dd935ceb49cfcff8728c6cc07f5940a1a26c8",
  production: "2b19a9873232679ef08429e08c5836c865a54d8113ae5d58cb9409a60863727b",
};

const fromMarkdown = {} as Record<Build, FromMarkdown>;
for (const build of BUILDS) {
  const url = pathToFileURL(join(PACKAGE_ROOT, ENTRY[build])).href;
  fromMarkdown[build] = ((await import(url)) as { fromMarkdown: FromMarkdown }).fromMarkdown;
}

/** Stock syntax only: the contract is from-markdown's, not VMark's dialect. */
const syntax = unified().use(remarkGfm, { singleTilde: false }).use(remarkMath).freeze().data() as {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
};
const EXTENSIONS = syntax.micromarkExtensions ?? [];
const MDAST_EXTENSIONS = syntax.fromMarkdownExtensions ?? [];

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

function parse(build: Build, markdown: string): unknown {
  return fromMarkdown[build](markdown, { extensions: EXTENSIONS, mdastExtensions: MDAST_EXTENSIONS });
}

interface LoggedToken {
  type: string;
  start: { offset?: number };
}

/** The handlers the line-ending observer adds, by event kind. */
const OBSERVED = { enter: ["lineEnding", "lineEndingBlank"], exit: ["lineEndingBlank"] } as const;

/**
 * Every line ending's type and offset, and the node types open around it —
 * which shows on which side of its trailing line endings each item closed.
 * from-markdown has no default for the handlers in `OBSERVED` (only `exit` of
 * `lineEnding`), and a test below checks these extensions have none either,
 * so adding them leaves the tree as it is — also checked below.
 */
function observeLineEndings(build: Build, markdown: string): { log: string; tree: unknown } {
  const log: string[] = [];
  function record(this: { stack: { type: string }[] }, token: LoggedToken): void {
    log.push(`${token.type}@${token.start.offset}:${this.stack.map((node) => node.type).join(">")}`);
  }
  const observer = {
    enter: Object.fromEntries(OBSERVED.enter.map((type) => [type, record])),
    exit: Object.fromEntries(OBSERVED.exit.map((type) => [type, record])),
  };
  const tree = fromMarkdown[build](markdown, {
    extensions: EXTENSIONS,
    mdastExtensions: [...MDAST_EXTENSIONS, observer],
  });
  return { log: log.join("\n"), tree };
}

function lineEndingLog(build: Build, markdown: string): string {
  return observeLineEndings(build, markdown).log;
}

interface Reference {
  /** How and from what this file was recorded. */
  provenance: string;
  /** Named input → canonical tree. */
  named: Record<string, string>;
  /** `<corpus prefix>-<example>` → digest of the canonical tree. */
  corpus: Record<string, string>;
  /** `fuzz-<seed>` → digest of the canonical tree. */
  fuzz: Record<string, string>;
  /** Named input, corpus id or fuzz id → digest of its line-ending log. */
  lineEndings: Record<string, string>;
}

function corpusExamples(): Map<string, string> {
  const examples = new Map<string, string>();
  for (const entry of CORPORA) {
    if (!CORPUS_PREFIXES.includes(entry.prefix)) continue;
    for (const example of loadExamples(entry)) examples.set(example.id, example.markdown);
  }
  return examples;
}

/** Every input the reference covers, keyed as `lineEndings` is. */
function allInputs(corpusIds: Iterable<string>): Map<string, string> {
  const inputs = new Map<string, string>(Object.entries(NAMED));
  const examples = corpusExamples();
  for (const id of corpusIds) {
    const markdown = examples.get(id);
    if (markdown === undefined) throw new Error(`${id}: example no longer in its corpus`);
    inputs.set(id, markdown);
  }
  for (let seed = 0; seed < FUZZ_COUNT; seed += 1) inputs.set(`fuzz-${seed}`, fuzzDocument(seed));
  return inputs;
}

function implementationSha256(build: Build): string {
  const source = readFileSync(join(PACKAGE_ROOT, IMPLEMENTATION[build]));
  return createHash("sha256").update(source).digest("hex");
}

function record(): Reference {
  for (const build of BUILDS) {
    if (implementationSha256(build) !== PRISTINE_SHA256[build]) {
      throw new Error(
        `Refusing to record: ${IMPLEMENTATION[build]} is not the pristine 2.0.3 file. ` +
          "Remove the patch from pnpm.patchedDependencies and reinstall first.",
      );
    }
  }
  const [build, other] = BUILDS;
  const treeOf = (markdown: string): string => {
    const tree = canonical(parse(build, markdown));
    if (canonical(parse(other, markdown)) !== tree) throw new Error(`Builds disagree on ${JSON.stringify(markdown)}`);
    return tree;
  };
  const named: Record<string, string> = {};
  for (const [name, markdown] of Object.entries(NAMED)) named[name] = treeOf(markdown);
  const corpus: Record<string, string> = {};
  for (const [id, markdown] of corpusExamples()) {
    if (hasList(parse(build, markdown))) corpus[id] = digest(treeOf(markdown));
  }
  const fuzz: Record<string, string> = {};
  for (let seed = 0; seed < FUZZ_COUNT; seed += 1) fuzz[`fuzz-${seed}`] = digest(treeOf(fuzzDocument(seed)));
  const lineEndings: Record<string, string> = {};
  for (const [key, markdown] of allInputs(Object.keys(corpus))) {
    const log = lineEndingLog(build, markdown);
    if (lineEndingLog(other, markdown) !== log) throw new Error(`Builds disagree on ${JSON.stringify(markdown)}`);
    lineEndings[key] = digest(log);
  }
  return {
    provenance:
      "Recorded from the pristine mdast-util-from-markdown@2.0.3 (both builds, hash-checked; " +
      "remark-gfm 4.0.1, remark-math 6.0.0, patched micromark 4.0.2) by " +
      "listPreparation.differential.test.ts in record mode. See its header before re-recording.",
    named,
    corpus,
    fuzz,
    lineEndings,
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
    expect(Object.keys(reference.lineEndings).sort()).toEqual(
      [...allInputs(Object.keys(reference.corpus)).keys()].sort(),
    );
    // A fuzz that stopped producing lists would compare nothing of interest.
    // Measured: 335 of the 400 documents hold at least one list.
    let withLists = 0;
    for (let seed = 0; seed < FUZZ_COUNT; seed += 1) {
      if (hasList(parse("development", fuzzDocument(seed)))) withLists += 1;
    }
    expect(withLists).toBeGreaterThanOrEqual(FUZZ_COUNT * 0.8);
  });

  it("loads two different builds, so both are really checked", () => {
    expect(implementationSha256("development")).not.toBe(implementationSha256("production"));
  });

  it("observes line endings without replacing any extension's handler", () => {
    const replaced: string[] = [];
    for (const extension of MDAST_EXTENSIONS.flat(Infinity) as {
      enter?: Record<string, unknown>;
      exit?: Record<string, unknown>;
    }[]) {
      for (const type of OBSERVED.enter) if (extension.enter?.[type]) replaced.push(`enter ${type}`);
      for (const type of OBSERVED.exit) if (extension.exit?.[type]) replaced.push(`exit ${type}`);
    }
    expect(replaced).toEqual([]);
  });

  describe.each(BUILDS)("%s build", (build) => {
    it.each(Object.keys(NAMED))("named input %s parses to the recorded tree", (name) => {
      expect(canonical(parse(build, NAMED[name])), JSON.stringify(NAMED[name])).toBe(reference.named[name]);
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
        if (digest(canonical(parse(build, markdown))) !== expected) mismatches.push(`${id}: ${JSON.stringify(markdown)}`);
      }
      expect(mismatches).toEqual([]);
    });

    it("every seeded fuzz document parses to the recorded tree", () => {
      const mismatches: string[] = [];
      for (let seed = 0; seed < FUZZ_COUNT; seed += 1) {
        const markdown = fuzzDocument(seed);
        if (digest(canonical(parse(build, markdown))) !== reference.fuzz[`fuzz-${seed}`]) {
          mismatches.push(`fuzz-${seed}: ${JSON.stringify(markdown)}`);
        }
      }
      expect(mismatches).toEqual([]);
    });

    it.each(Object.keys(NAMED))("observing line endings leaves the tree of %s unchanged", (name) => {
      expect(canonical(observeLineEndings(build, NAMED[name]).tree)).toBe(canonical(parse(build, NAMED[name])));
    });

    it("every input puts its line endings inside the recorded nodes", () => {
      const mismatches: string[] = [];
      for (const [key, markdown] of allInputs(Object.keys(reference.corpus))) {
        if (digest(lineEndingLog(build, markdown)) !== reference.lineEndings[key]) {
          mismatches.push(`${key}: ${JSON.stringify(markdown)}`);
        }
      }
      expect(mismatches).toEqual([]);
    });
  });
});
