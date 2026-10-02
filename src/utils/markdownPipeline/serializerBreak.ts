/**
 * Hard-break serialization — the `break` handler.
 *
 * Purpose: write a hard break in the document's chosen spelling (`\` or two
 * trailing spaces) at the one place that knows it is writing a hard break.
 *
 * The style cannot be applied to the finished string instead. A backslash
 * that ends a line of text is a hard break, a LaTeX row separator in `$$`
 * math, a line of an HTML block, an attribute value spanning two lines, or a
 * literal backslash before a soft break — and the string does not say which.
 * Rewriting it by pattern corrupts every one of those but the first. Here only
 * `break` nodes are written, so nothing else can be.
 *
 * Key decisions:
 *   - "May a line ending appear here?" is asked of upstream, through
 *     `state.safe`, rather than re-derived: a table cell answers no, and the
 *     break degrades to a space exactly as upstream's own handler does.
 *     `serializerBreak.test.ts` holds the backslash style to stock
 *     remark-stringify's output for every construct a break can sit in.
 *   - Two trailing spaces say "hard break" only directly after a
 *     non-whitespace character, so a break is written with a backslash,
 *     whatever the style, in the two places they cannot:
 *       · at the start of its line (first in a paragraph, or right after
 *         another break) — spaces alone make a BLANK line, the paragraph
 *         splits and the break is gone;
 *       · after text that ends in a space or tab — the spaces join that run
 *         and are read back as part of the break, so the text loses its own
 *         whitespace, and after a tab no break is read back at all.
 *   - `peek` answers lookahead without running the handler. Lookahead has no
 *     `before`, so running the handler for it would report a backslash, and the
 *     text before a two-space break would escape a trailing literal backslash
 *     it has no need to. `peek` therefore cannot know about the two fallbacks
 *     above and still answers a space for them. That is harmless: the only
 *     use of the answer is to decide whether a preceding literal backslash
 *     needs escaping, and in neither fallback does the preceding output end
 *     in a backslash — it is empty, a line ending, or whitespace.
 *
 * @coordinates-with serializer.ts — installs this handler, one processor per style
 * @coordinates-with serializerText.ts — text line endings, the sibling concern
 * @module utils/markdownPipeline/serializerBreak
 */

/** How a hard break is spelled. */
export type HardBreakSpelling = "backslash" | "twoSpaces";

/** The slice of mdast-util-to-markdown's `State` this handler uses. */
interface BreakState {
  safe: (value: string, info: BreakInfo) => string;
}

/** The characters around the node being serialized. */
interface BreakInfo {
  before: string;
  after: string;
}

const BACKSLASH_BREAK = "\\\n";
const TWO_SPACE_BREAK = "  \n";

/**
 * True when two trailing spaces written after `before` are read back as
 * exactly one hard break and nothing else: `before` must end in a character
 * that is neither a line ending (or nothing) nor a space or tab.
 */
function canTakeTrailingSpaces(before: string): boolean {
  return before !== "" && !/[ \t\r\n]$/.test(before);
}

/** Build the `break` handler for one hard-break spelling. */
export function createBreakHandler(spelling: HardBreakSpelling) {
  const handle = (
    _node: unknown,
    _parent: unknown,
    state: BreakState,
    info: BreakInfo,
  ): string => {
    // A construct that cannot hold a line ending (a table cell) gets a space,
    // or nothing when whitespace already separates the two sides.
    if (state.safe("\n", info) !== "\n") {
      return /[ \t]/.test(info.before) ? "" : " ";
    }
    if (spelling === "twoSpaces" && canTakeTrailingSpaces(info.before)) {
      return TWO_SPACE_BREAK;
    }
    return BACKSLASH_BREAK;
  };
  return Object.assign(handle, {
    peek: (): string => (spelling === "twoSpaces" ? " " : "\\"),
  });
}
