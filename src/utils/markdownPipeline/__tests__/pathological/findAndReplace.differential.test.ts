// @vitest-environment node
/**
 * #1473 follow-up — finding and replacing text must not change a parse.
 *
 * `patches/mdast-util-find-and-replace@3.0.2.patch` changes only how the
 * package finds a node's index among its siblings (no ancestor index unless
 * the `ignore` test can read it; the text node's own found by looking outward
 * from the last one, while the siblings are distinct objects), so everything
 * observable must be identical to the unpatched package:
 *
 *   - the tree GFM's autolink transform (its main user) leaves after the stock
 *     GFM parse — node for node, position for position. Its `ignore` test is
 *     a type list, so this is the path that skips the ancestor index;
 *   - what a direct `findAndReplace` call does with patterns that remove,
 *     keep, wrap and split text, and every `(node, index, parent)` its
 *     `ignore` test — a function, so the other path — is called with;
 *   - the same for constructed trees a parser never builds: a node object
 *     shared between positions, and replace functions that return the text
 *     node itself, a sibling, or one node twice, or edit the tree.
 *
 * With the patch applied there is no unpatched package left to run, so the
 * reference is RECORDED. `findAndReplace.reference.json` holds what the
 * UNPATCHED 3.0.2 produced for small named inputs (stored whole, so a failure
 * diffs readably), and — as digests — the two shapes the patch speeds up,
 * every example of the pinned CommonMark and GFM corpora, and a seeded fuzz
 * dense in URLs, emails, links, code and nesting.
 *
 * To re-record: remove the `mdast-util-find-and-replace@3.0.2` entry from
 * `pnpm.patchedDependencies`, `pnpm install`, run this file with
 * `VMARK_RECORD_FIND_AND_REPLACE_REFERENCE=1`, restore the entry,
 * `pnpm install`. The recorder refuses unless the installed file hashes to the
 * pristine 3.0.2 one, and a recording run always FAILS, so it can never pass
 * for a verification.
 *
 * That the patch makes anything faster lives in `pathologicalScaling.test.ts`.
 *
 * @coordinates-with patches/mdast-util-find-and-replace@3.0.2.patch — the change under test
 * @coordinates-with pathologicalScaling.test.ts — its growth bound
 * @coordinates-with ../spec/corpusRegistry.ts — the pinned corpora
 * @module utils/markdownPipeline/__tests__/pathological/findAndReplace.differential.test
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { Root } from "mdast";
import { CORPORA, loadExamples } from "../spec/corpusRegistry";

const REFERENCE_PATH = new URL("./findAndReplace.reference.json", import.meta.url);
const RECORD = process.env.VMARK_RECORD_FIND_AND_REPLACE_REFERENCE === "1";

/** sha256 of `lib/index.js` in the pristine 3.0.2 tarball. */
const PRISTINE_SHA256 = "b171699f61c99a82565a6d6f8f3a1348d7d37756f889be30def0337caa9dbe2f";

/** Stock syntax only: the contract is the package's, not VMark's dialect. */
const stock = unified().use(remarkParse).use(remarkGfm, { singleTilde: false });
/** The same parse without any mdast transform, for the direct calls. */
const bare = unified().use(remarkParse);

/** The pinned upstream corpora (the registry checks each file's sha256). */
const CORPUS_PREFIXES = ["cm", "gfm", "cmreg", "gfmreg", "gfmext"];

const NAMED: Record<string, string> = {
  empty: "",
  "no-match": "plain text only\n",
  url: "Visit https://example.com/path?q=1 now.\n",
  www: "See www.example.com.\n",
  email: "Mail a.b+c@example.co.uk please\n",
  "several-in-one-text": "a https://a.com b https://b.com c www.c.com d x@y.com e\n",
  "url-inside-link-is-ignored": "[https://a.com](https://b.com) and https://c.com\n",
  "url-in-emphasis": "*https://a.com* and **www.b.com**\n",
  "url-in-heading": "# Title https://a.com\n",
  "url-in-table": "| a | b |\n|---|---|\n| https://a.com | x@y.com |\n",
  "url-in-quote-and-list": "> - https://a.com\n>   - www.b.com\n",
  "trailing-punctuation": "(https://a.com/x)). https://a.com/b?. www.x.com,\n",
  cjk: "访问 https://例子.com 或者 www.例子.中国。邮件 用户@例子.com\n",
  "url-in-code-is-not-text": "`https://a.com` and\n\n```\nhttps://b.com\n```\n",
  "footnote-with-url": "Text[^1]\n\n[^1]: see https://a.com\n",
  "html-around-url": "<span>https://a.com</span>\n",
};

/** The shapes the patch speeds up, at a size worth storing only as digests. */
const LARGE: Record<string, string> = {
  "many-siblings": "`a` https://a.com `b` www.b.com `c` c@d.com ".repeat(20),
  "flat-paragraphs": Array.from({ length: 50 }, (_, i) => `Para ${i} https://e.com/${i} and \`c\`.\n\n`).join(""),
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

const FUZZ_BLOCKS = ["", "", "# ", "## ", "> ", "- ", "1. ", "  - ", "| ", "> > "];
const FUZZ_PIECES = [
  "https://a.com", "http://b.org/x_(y)", "www.c.net", "d@e.io", "f.g@h.co.uk", "[link](https://i.com)",
  "[https://j.com](k)", "`code`", "*em*", "**strong**", "~~del~~", "abc", "b1c2", "中文", "a.", ",", "(", ")",
  "<br>", "\\", "  ", "$x$",
];
const FUZZ_COUNT = 300;

function fuzzDocument(seed: number): string {
  const next = prng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const lines: string[] = [];
  const count = 2 + Math.floor(next() * 10);
  for (let i = 0; i < count; i += 1) {
    const words = Array.from({ length: 1 + Math.floor(next() * 8) }, () => pick(FUZZ_PIECES));
    lines.push(`${pick(FUZZ_BLOCKS)}${words.join(pick([" ", " ", "", "\t"]))}`);
  }
  return lines.join(next() < 0.1 ? "\r\n" : "\n") + pick(["", "\n", "\n\n"]);
}

/** Keys sorted, positions compacted: the tree as a comparable string. */
function canonical(node: unknown): string {
  return JSON.stringify(normalize(node));
}

function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node).sort()) {
    const value = (node as Record<string, unknown>)[key];
    if (key === "position") {
      const { start, end } = value as { start: { offset?: number }; end: { offset?: number } };
      out[key] = `${start.offset}-${end.offset}`;
    } else out[key] = normalize(value);
  }
  return out;
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * A direct call exercising every kind of replacement, with an `ignore` test
 * that logs each `(node, index, parent)` it is asked about.
 */
function directRun(markdown: string): string {
  const tree = bare.parse(markdown) as Root;
  const calls: string[] = [];
  findAndReplace(
    tree,
    [
      [/b/g, (value: string) => ({ type: "emphasis", children: [{ type: "text", value }] })],
      ["a", ""],
      [/c/, () => false],
      [/(\d)/g, (_: string, digit: string) => [{ type: "text", value: digit }, { type: "break" }]],
      [/\./g, "!"],
    ],
    {
      ignore: (node: { type: string }, index: number | undefined, parent: { type: string } | undefined): boolean => {
        calls.push(`${node.type}@${index}<${parent?.type}`);
        return node.type === "link";
      },
    },
  );
  return `${canonical(tree)}\n${calls.join(",")}`;
}

type Node = { type: string; value?: string; children?: Node[] };
type Replace = (...parameters: never[]) => unknown;
const text = (value: string): Node => ({ type: "text", value });
const paragraph = (...children: Node[]): Node => ({ type: "paragraph", children });

/**
 * Trees a parser never builds, where a node object is shared or returned
 * again (`indexOf` then answers with the FIRST occurrence, and the patch must
 * too), and `ignore` tests in every form that can read the index: a function
 * alone, inside flat, nested and mixed arrays, and behind a getter. Each
 * returns the tree after the call plus the `ignore` log.
 */
const CONSTRUCTED: Record<string, () => string> = {
  "same-paragraph-twice": () => {
    const shared = paragraph(text("x b y"));
    return constructedRun({ type: "root", children: [shared, text("z"), shared] }, [[/b/g, "B"]]);
  },
  "replace-returns-the-text-node": () =>
    constructedRun({ type: "root", children: [paragraph(text("a b c"), text("d b"))] }, [
      [/b/, (...args: unknown[]) => (args.at(-1) as { stack: Node[] }).stack.at(-1)],
    ]),
  "replace-returns-a-sibling": () => {
    const sibling = { type: "inlineCode", value: "s" };
    return constructedRun({ type: "root", children: [paragraph(text("a b"), sibling, text("b c"))] }, [
      [/b/g, () => sibling],
    ]);
  },
  "replace-returns-one-node-twice": () => {
    const twice = { type: "break" };
    return constructedRun({ type: "root", children: [paragraph(text("a b c b"), text("b"))] }, [
      [/b/g, () => [twice, twice]],
    ]);
  },
  "replace-returns-a-later-text-sibling": () => {
    const shared = text("a");
    return constructedRun(
      { type: "root", children: [paragraph(text("b"), { type: "break" }, text("c"), text("d"), shared)] },
      [[/[ab]/g, (value: string) => (value === "b" ? shared : "A")]],
    );
  },
  "ignore-array-holding-a-function": () =>
    constructedRun(twoParagraphs(), [[/b/g, "B"]], firstParagraph, (test) => ["link", test]),
  "ignore-nested-array-holding-a-function": () =>
    constructedRun(twoParagraphs(), [[/b/g, "B"]], firstParagraph, (test) => [["strong", test]]),
  "ignore-mixed-tests-holding-a-function": () =>
    constructedRun(twoParagraphs(), [[/b/g, "B"]], firstParagraph, (test) => [{ type: "heading" }, ["x", test]]),
  "ignore-read-once-through-a-getter": () => {
    let reads = 0;
    const calls: string[] = [];
    const tree = twoParagraphs();
    findAndReplace(tree as Root, [[/b/g, "B"]], {
      get ignore() {
        reads += 1;
        return reads === 1
          ? (node: { type: string }, index: number | undefined): boolean => {
              calls.push(`${node.type}@${index}`);
              return node.type === "paragraph" && index === 0;
            }
          : undefined;
      },
    } as never);
    return `${canonical(tree)}\n${calls.join(",")}\nreads=${reads}`;
  },
  "callback-edits-the-tree-and-ignore-reads-the-index": () => {
    const c = paragraph(text("c"));
    const root = { type: "root", children: [paragraph(text("a")), paragraph(text("b")), c] };
    return constructedRun(
      root,
      [[/[bc]/g, (value: string) => {
        if (value === "b") {
          root.children[0] = c;
          return false;
        }
        return "C";
      }]],
      (node, index) => node === c && index === 0,
    );
  },
};

const twoParagraphs = (): Node => ({ type: "root", children: [paragraph(text("a b")), paragraph(text("b c"))] });
const firstParagraph = (node: Node, index: number | undefined): boolean =>
  node.type === "paragraph" && index === 0;

type IndexTest = (node: { type: string }, index: number | undefined, parent: { type: string } | undefined) => boolean;

/**
 * Run `findAndReplace` with a logging test function as (or, via `wrap`,
 * inside) the `ignore` test; return the tree and the log.
 */
function constructedRun(
  tree: Node,
  list: [RegExp, string | Replace][],
  ignoreWhen: (node: Node, index: number | undefined) => boolean = () => false,
  wrap: (test: IndexTest) => unknown = (test) => test,
): string {
  const calls: string[] = [];
  const test: IndexTest = (node, index, parent) => {
    calls.push(`${node.type}@${index}<${parent?.type}`);
    return ignoreWhen(node as Node, index);
  };
  findAndReplace(tree as Root, list as never, { ignore: wrap(test) as never });
  return `${canonical(tree)}\n${calls.join(",")}`;
}

function observe(markdown: string): string {
  return `${canonical(stock.parse(markdown))}\n${directRun(markdown)}`;
}

/** Both the direct import and GFM's autolink transform use this one file. */
function installedFiles(): string[] {
  const here = createRequire(import.meta.url);
  const direct = here.resolve("mdast-util-find-and-replace");
  const viaGfm = ["mdast-util-gfm", "mdast-util-gfm-autolink-literal", "mdast-util-find-and-replace"].reduce(
    (from, spec) => createRequire(from).resolve(spec),
    here.resolve("remark-gfm"),
  );
  return [direct, viaGfm].map((entry) => realpathSync(join(dirname(entry), "lib/index.js")));
}

function installedSha256(): string {
  return createHash("sha256").update(readFileSync(installedFiles()[0])).digest("hex");
}

interface Reference {
  provenance: string;
  /** Named input → trees and ignore-test log, whole. */
  named: Record<string, string>;
  /** Large shape → digest. */
  large: Record<string, string>;
  /** Constructed tree → tree and ignore-test log, whole. */
  constructed: Record<string, string>;
  /** `<corpus prefix>-<example>` → digest. */
  corpus: Record<string, string>;
  /** `fuzz-<seed>` → digest. */
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
  if (installedSha256() !== PRISTINE_SHA256) {
    throw new Error(
      "Refusing to record: the installed mdast-util-find-and-replace is not the pristine 3.0.2. " +
        "Remove the patch from pnpm.patchedDependencies and reinstall first.",
    );
  }
  const named: Record<string, string> = {};
  for (const [name, markdown] of Object.entries(NAMED)) named[name] = observe(markdown);
  const large: Record<string, string> = {};
  for (const [name, markdown] of Object.entries(LARGE)) large[name] = digest(observe(markdown));
  const constructed: Record<string, string> = {};
  for (const [name, run] of Object.entries(CONSTRUCTED)) constructed[name] = run();
  const corpus: Record<string, string> = {};
  for (const [id, markdown] of corpusExamples()) corpus[id] = digest(observe(markdown));
  const fuzz: Record<string, string> = {};
  for (let seed = 0; seed < FUZZ_COUNT; seed += 1) fuzz[`fuzz-${seed}`] = digest(observe(fuzzDocument(seed)));
  return {
    provenance:
      "Recorded from the pristine mdast-util-find-and-replace@3.0.2 (hash-checked; remark-parse 11.0.0, " +
      "remark-gfm 4.0.1) by findAndReplace.differential.test.ts in record mode. See its header before re-recording.",
    named,
    large,
    constructed,
    corpus,
    fuzz,
  };
}

describe("find-and-replace matches the unpatched package (#1473 follow-up)", () => {
  if (RECORD) {
    it("records the reference (always fails: a recording is not a verification)", () => {
      writeFileSync(REFERENCE_PATH, `${JSON.stringify(record(), null, 2)}\n`);
      expect.fail(`Recorded ${REFERENCE_PATH.pathname}; re-run without VMARK_RECORD_FIND_AND_REPLACE_REFERENCE.`);
    });
    return;
  }

  const reference = JSON.parse(readFileSync(REFERENCE_PATH, "utf8")) as Reference;

  it("covers every named input, every pinned corpus example, and the fuzz", () => {
    expect(Object.keys(reference.named).sort()).toEqual(Object.keys(NAMED).sort());
    expect(Object.keys(reference.large).sort()).toEqual(Object.keys(LARGE).sort());
    expect(Object.keys(reference.constructed).sort()).toEqual(Object.keys(CONSTRUCTED).sort());
    expect(Object.keys(reference.corpus).sort()).toEqual([...corpusExamples().keys()].sort());
    expect(Object.keys(reference.fuzz)).toHaveLength(FUZZ_COUNT);
  });

  it("tests the one file both paths load", () => {
    const [direct, viaGfm] = installedFiles();
    expect(viaGfm).toBe(direct);
  });

  it("really exercises the patched lookups: ignore tests see indices, replacements happen", () => {
    const run = directRun("x b1 [l](u)\n\n> y. 2\n");
    expect(run).toMatch(/paragraph@0<root/);
    expect(run).toMatch(/link@\d+<paragraph/);
    expect(run).toContain('"type":"break"');
  });

  it.each(Object.keys(NAMED))("named input %s", (name) => {
    expect(observe(NAMED[name]), JSON.stringify(NAMED[name])).toBe(reference.named[name]);
  });

  it.each(Object.keys(LARGE))("large shape %s", (name) => {
    expect(digest(observe(LARGE[name]))).toBe(reference.large[name]);
  });

  it.each(Object.keys(CONSTRUCTED))("constructed tree %s", (name) => {
    expect(CONSTRUCTED[name]()).toBe(reference.constructed[name]);
  });

  it("every pinned corpus example", () => {
    const examples = corpusExamples();
    const mismatches = Object.entries(reference.corpus)
      .filter(([id, expected]) => digest(observe(examples.get(id) ?? "")) !== expected)
      .map(([id]) => `${id}: ${JSON.stringify(examples.get(id))}`);
    expect(mismatches).toEqual([]);
  });

  it("every seeded fuzz document", () => {
    const mismatches: string[] = [];
    for (let seed = 0; seed < FUZZ_COUNT; seed += 1) {
      const markdown = fuzzDocument(seed);
      if (digest(observe(markdown)) !== reference.fuzz[`fuzz-${seed}`]) {
        mismatches.push(`fuzz-${seed}: ${JSON.stringify(markdown)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
