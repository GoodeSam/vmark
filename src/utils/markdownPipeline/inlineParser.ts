/**
 * Inline Markdown Parser
 *
 * Purpose: Parses inline markdown text to MDAST inline content nodes,
 * used for contexts where only inline (phrasing) content is expected.
 *
 * Pipeline: inline markdown string → unified/remark → extract paragraph children
 *
 * Key decisions:
 *   - Fast-path check for text without markdown chars avoids remark overhead
 *   - Falls back to plain text node on parse failure for resilience
 *   - Creates a fresh unified processor each call (stateless, no caching needed
 *     since this is only used for short summary text)
 *
 * @coordinates-with plugins/detailsBlock.ts — parses <summary> text with inline formatting
 * @coordinates-with parser/escapeMarkers.ts — escaped custom markers, as in the document parse
 * @coordinates-with mdastToProseMirror.ts — consumers convert resulting MDAST to PM nodes
 * The processor comes from the shared `inline-summary` dialect (WI-3.1), so
 * this parser cannot drift from the others on what `~x~` or `==x==` mean.
 *
 * @module utils/markdownPipeline/inlineParser
 */

import type { Content, Paragraph, Root } from "mdast";
import { buildProcessorForMode } from "./dialect";
import {
  preprocessEscapedMarkers,
  restoreEscapedMarkers,
  restoreRawEscapedMarkers,
} from "./parser/escapeMarkers";
import { mdPipelineWarn } from "@/utils/debug";

/**
 * Parse inline markdown text to MDAST inline content.
 *
 * Wraps the text in a paragraph, parses it, and extracts the inline children.
 *
 * @param text - The inline markdown text to parse
 * @returns Array of inline MDAST content nodes
 */
export function parseInlineMarkdown(text: string): Content[] {
  if (!text || !text.trim()) {
    return [];
  }

  // Check if text contains any markdown characters that need parsing
  // (=, +, ^ cover the custom ==highlight==, ++underline++, ^sup^ marks)
  if (!/[*_`~[\]=+^]/.test(text)) {
    // No markdown characters - return as plain text
    return [{ type: "text", value: text } as Content];
  }

  try {
    // The `inline-summary` dialect — the smallest that still has inline marks.
    // Built from the shared descriptors so it cannot drift from the others on
    // what `~x~` or `==x==` mean (WI-3.1).
    const processor = buildProcessorForMode("inline-summary");

    // Escaped custom markers (`\==`) are hidden from the inline-mark plugin
    // exactly as the document parse hides them (parser/escapeMarkers.ts).
    const source = preprocessEscapedMarkers(text);
    const tree = processor.parse(source) as Root;
    if (source !== text) restoreRawEscapedMarkers(tree, source);
    const transformed = processor.runSync(tree) as Root;
    if (source !== text) restoreEscapedMarkers(transformed);

    // The parser creates a root with children
    // For inline text, this should result in a single paragraph
    /* v8 ignore next -- @preserve runSync output always has children for valid remark processors */
    const children = (transformed as { children?: Content[] }).children ?? [];

    // Inline contexts (e.g. a details <summary>) accept phrasing content
    // only. Anything that parsed to something other than exactly one
    // paragraph — a thematic break for "***", a heading, multiple blocks —
    // is not representable inline and would throw when inserted into an
    // inline-only schema. Fall back to the literal text instead.
    const first = children[0];
    if (children.length === 1 && first?.type === "paragraph") {
      return (first as Paragraph).children as Content[];
    }

    return [{ type: "text", value: text } as Content];
  } catch (error) {
    // If parsing fails, return as plain text
    mdPipelineWarn("Failed to parse inline markdown:", error);
    return [{ type: "text", value: text } as Content];
  }
}
