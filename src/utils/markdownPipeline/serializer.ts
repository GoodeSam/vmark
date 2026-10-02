/**
 * Markdown Serializer (remark-stringify based)
 *
 * Purpose: Serializes MDAST back to markdown text with consistent formatting.
 * The serializer configuration determines VMark's canonical markdown style.
 *
 * Key decisions:
 *   - Bullet: `-` (not `*`), emphasis: `*`, strong: `**`, fence: backtick.
 *     Emphasis flush against a `**` sibling is written `_` instead, because
 *     flush `*` runs merge (serializerAttention.ts)
 *   - listItemIndent: "one" — minimizes diff noise compared to "tab"
 *   - Custom handlers for image/link (serializerHandlers.ts): angle brackets
 *     for URLs with spaces instead of percent-encoding, and autolink
 *     preservation for links whose text equals their URL (#1102)
 *   - tocToMarkdown handler serializes `toc` MDAST nodes back to `[TOC]` text
 *   - A verified cosmetic pass converts serializer-emitted &#x20; entities
 *     back to spaces and strips defensive backslash escapes ($, [, ], *, _,
 *     `, !, (, ), :, @) — but only when re-parsing the cleaned output yields the
 *     exact same mdast as the conservative output, so it can never change
 *     document meaning (audit H6/H7).
 *   - hardBreakStyle picks the spelling of a `break` NODE (serializerBreak.ts).
 *     It is never applied to the finished string, where a hard break cannot be
 *     told from math, HTML or a literal backslash that ends a line
 *   - Before stringifying, a hard break that ends its block is dropped —
 *     markdown cannot write one (serializerBlockFinalBreak.ts) — and inline
 *     HTML that follows a hard break is retyped so upstream does not swallow
 *     the break's line ending (serializerBreakBeforeHtml.ts). The tree passed
 *     in is not changed
 *   - join re-emits captured blank-line runs (blankLinesJoin, ADR-1a), and
 *     keeps a list that cannot interrupt a paragraph off its last line
 *     (listInterruptJoin, CommonMark §5.2)
 *
 * @coordinates-with parser.ts — plugins must match between parser and serializer
 * @coordinates-with adapter.ts — wraps this with error handling
 * @coordinates-with serializerHandlers.ts — custom image/link to-markdown handlers
 * @coordinates-with serializerAttention.ts — emphasis/strong/delete handlers
 * @coordinates-with listInterruptJoin.ts — blank line before a non-interrupting list
 * @coordinates-with serializerText.ts — text line endings that would make a blank line
 * @coordinates-with serializerBreak.ts — the `break` handler, one per hard-break style
 * @coordinates-with serializerBreakBeforeHtml.ts — the line ending between a break and inline HTML
 * @coordinates-with serializerBlockFinalBreak.ts — a break that ends its block
 * @module utils/markdownPipeline/serializer
 */

import { unified } from "unified";
import remarkStringify from "remark-stringify";
import { handleDelete, handleEmphasis, handleStrong } from "./serializerAttention";
import { handleText } from "./serializerText";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import type { Root } from "mdast";
import { remarkCustomInline, remarkDetailsBlock, remarkWikiLinks, tocToMarkdown } from "./plugins";
import { handleImage, handleLink, blankLinesJoin } from "./serializerHandlers";
import { listInterruptJoin } from "./listInterruptJoin";
import type { MarkdownPipelineOptions } from "./types";
import { parseMarkdownToMdast } from "./parser";
import { applyCosmeticPass } from "./serializerCosmetics";
import { createBreakHandler, type HardBreakSpelling } from "./serializerBreak";
import {
  HTML_AFTER_BREAK,
  handleHtmlAfterBreak,
  keepLineEndingsBeforeHtml,
} from "./serializerBreakBeforeHtml";
import { dropBlockFinalBreaks } from "./serializerBlockFinalBreak";

/**
 * Build the unified processor configured for VMark markdown serialization.
 *
 * Plugins (must match parser configuration):
 * - remark-stringify: Base CommonMark serializer
 * - remark-gfm: GitHub Flavored Markdown output
 * - remark-math: Math output ($...$ and $$...$$)
 * - remark-frontmatter: YAML frontmatter output
 * - remarkCustomInline: Custom inline marks (==highlight==, ~sub~, etc.)
 *
 * The plugin set has no content-dependent branches, and its only
 * option-dependent part is the `break` handler, so getSerializer() builds one
 * processor per hard-break spelling and reuses it across every serialize call.
 */
function buildSerializer(hardBreak: HardBreakSpelling) {
  // Cast inline: `join` is forwarded to mdast-util-to-markdown at runtime but
  // absent from remark-stringify's published Options type.
  return unified()
    .use(remarkStringify, {
      bullet: "-", // Use - for unordered lists
      bulletOther: "*", // Fallback bullet
      bulletOrdered: ".", // Use . for ordered lists
      emphasis: "*", // Use * for emphasis (single: *italic*)
      strong: "*", // Use * for strong (double: **bold**)
      fence: "`", // Use ` for code fences
      fences: true, // Use fenced code blocks
      rule: "-", // Use --- for thematic breaks
      listItemIndent: "one", // Use one space indent for list items
      handlers: {
        image: handleImage,
        link: handleLink,
        // Attention delimiters share one flanking model, including the
        // alternate `_` that keeps emphasis from merging into a neighbouring
        // `**` (serializerAttention.ts).
        emphasis: handleEmphasis,
        strong: handleStrong,
        delete: handleDelete,
        // A text line ending that would make a blank line is written as a
        // character reference (serializerText.ts).
        text: handleText,
        // The hard-break spelling belongs to the node, not to a pass over the
        // finished string (serializerBreak.ts).
        break: createBreakHandler(hardBreak),
        [HTML_AFTER_BREAK]: handleHtmlAfterBreak,
        ...tocToMarkdown.handlers,
      } as Record<string, unknown>,
      // Joins are consulted last-first: listInterruptJoin can raise a captured
      // blank-line run (ADR-1a) that CommonMark would read as paragraph text.
      join: [blankLinesJoin, listInterruptJoin],
    } as Parameters<typeof remarkStringify>[0])
    .use(remarkGfm, {
      singleTilde: false, // Match parser config
    })
    .use(remarkMath)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkWikiLinks)
    .use(remarkDetailsBlock)
    .use(remarkCustomInline);
}

const cachedSerializers = new Map<HardBreakSpelling, ReturnType<typeof buildSerializer>>();

/** Return the shared processor for one hard-break spelling, building it on first use. */
function getSerializer(hardBreak: HardBreakSpelling) {
  let serializer = cachedSerializers.get(hardBreak);
  if (!serializer) {
    serializer = buildSerializer(hardBreak);
    cachedSerializers.set(hardBreak, serializer);
  }
  return serializer;
}

/**
 * Serialize MDAST to markdown text.
 *
 * @param mdast - The MDAST root node to serialize
 * @returns The markdown text
 *
 * @example
 * const md = serializeMdastToMarkdown(mdast);
 * // "# Hello\n\nWorld\n"
 */
export function serializeMdastToMarkdown(
  mdast: Root,
  options: MarkdownPipelineOptions = {}
): string {
  const processor = getSerializer(options.hardBreakStyle ?? "backslash");
  let result = processor.stringify(keepLineEndingsBeforeHtml(dropBlockFinalBreaks(mdast)));
  // No split-surrogate repair pass: attention neighbours are encoded as whole
  // code points when they are encoded (serializerAttention.ts and the
  // mdast-util-to-markdown patch), which a string repair afterwards could not
  // do without changing what the delimiter beside them flanks.

  // A document-leading thematic break can serialize as `---` and then be
  // REPARSED as a frontmatter fence, swallowing structure (CommonMark
  // examples 43/47/77). But that only happens when something later closes
  // the fence — a lone `---` rule reparses as a thematic break exactly as
  // written. So VERIFY rather than assume: swap to `***` only when the
  // reparse actually turns the break into frontmatter. Assuming cost real
  // fidelity — typing `---` in an empty document came back as `***`.
  if (mdast.children[0]?.type === "thematicBreak" && result.startsWith("---")) {
    if (parseMarkdownToMdast(result).children[0]?.type !== "thematicBreak") {
      result = `***${result.slice(3)}`;
    }
  }

  // Verified cosmetic pass: restore serializer-emitted &#x20; entities and
  // strip defensive escapes, accepted only when the cleaned string re-parses
  // identically to the conservative one (audit H6/H7).
  return applyCosmeticPass(result);
}
