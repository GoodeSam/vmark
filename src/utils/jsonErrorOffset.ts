/**
 * jsonErrorOffset — where the first JSON syntax error is, on any engine.
 *
 * Purpose: `JSON.parse` says THAT a document is invalid; only some engines
 * say WHERE. V8 appends "at position N (line L column C)", but JavaScriptCore
 * — the engine VMark ships on macOS and Linux — says only "JSON Parse error:
 * Property name must be a string literal". Reading the position out of the
 * message therefore passed every Node-run test and put every production error
 * on line 1, column 1. This scanner finds the offset itself.
 *
 * Key decisions:
 *   - A state machine over an explicit stack, not recursive descent, so a
 *     deeply nested document cannot overflow the call stack.
 *   - Strict RFC 8259: no comments, trailing commas, single quotes, leading
 *     zeros or raw control characters — the grammar `JSON.parse` accepts.
 *   - Returns the offset of the first character that cannot continue a valid
 *     document; at end of input that is `text.length`.
 *
 * @module utils/jsonErrorOffset
 */

type Expect = "value" | "valueOrEnd" | "key" | "keyOrEnd" | "colon" | "commaOrEnd" | "done";

const HEX = /^[0-9a-fA-F]{4}$/;
const SIMPLE_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/** Offset of the first syntax error in `text`, or `null` when it is valid JSON. */
export function jsonErrorOffset(text: string): number | null {
  const n = text.length;
  const stack: ("{" | "[")[] = [];
  let i = 0;
  let expect: Expect = "value";
  const afterValue = (): Expect => (stack.length > 0 ? "commaOrEnd" : "done");

  /** Scan a string at `i` (on its opening quote); the error offset, or null. */
  const scanString = (): number | null => {
    i += 1;
    while (i < n) {
      const c = text[i];
      if (c === '"') {
        i += 1;
        return null;
      }
      if (c === "\\") {
        const next = text[i + 1];
        if (next !== undefined && SIMPLE_ESCAPES.has(next)) i += 2;
        else if (next === "u" && HEX.test(text.slice(i + 2, i + 6))) i += 6;
        else return i;
        continue;
      }
      if (c.charCodeAt(0) < 0x20) return i;
      i += 1;
    }
    return n;
  };

  /** Scan a number at `i`; the error offset, or null. */
  const scanNumber = (): number | null => {
    if (text[i] === "-") i += 1;
    if (text[i] === "0") {
      i += 1;
      if (isDigit(text[i])) return i;
    } else if (isDigit(text[i])) {
      while (isDigit(text[i])) i += 1;
    } else {
      return i;
    }
    if (text[i] === ".") {
      i += 1;
      if (!isDigit(text[i])) return i;
      while (isDigit(text[i])) i += 1;
    }
    if (text[i] === "e" || text[i] === "E") {
      i += 1;
      if (text[i] === "+" || text[i] === "-") i += 1;
      if (!isDigit(text[i])) return i;
      while (isDigit(text[i])) i += 1;
    }
    return null;
  };

  for (;;) {
    while (i < n && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i += 1;
    if (expect === "done") return i < n ? i : null;
    if (i >= n) return n;
    const c = text[i];
    // An empty container may close where its first member would start.
    if ((expect === "valueOrEnd" && c === "]") || (expect === "keyOrEnd" && c === "}")) {
      i += 1;
      stack.pop();
      expect = afterValue();
      continue;
    }
    if (expect === "valueOrEnd") expect = "value";
    if (expect === "keyOrEnd") expect = "key";
    switch (expect) {
      case "value": {
        if (c === "{" || c === "[") {
          stack.push(c);
          i += 1;
          expect = c === "{" ? "keyOrEnd" : "valueOrEnd";
          break;
        }
        let error: number | null;
        if (c === '"') error = scanString();
        else if (c === "-" || isDigit(c)) error = scanNumber();
        else {
          const literal = ["true", "false", "null"].find((word) => text.startsWith(word, i));
          if (!literal) return i;
          i += literal.length;
          error = null;
        }
        if (error !== null) return error;
        expect = afterValue();
        break;
      }
      case "key": {
        if (c !== '"') return i;
        const error = scanString();
        if (error !== null) return error;
        expect = "colon";
        break;
      }
      case "colon":
        if (c !== ":") return i;
        i += 1;
        expect = "value";
        break;
      case "commaOrEnd": {
        const top = stack[stack.length - 1];
        if (c === ",") {
          i += 1;
          expect = top === "{" ? "key" : "value";
        } else if ((top === "{" && c === "}") || (top === "[" && c === "]")) {
          i += 1;
          stack.pop();
          expect = afterValue();
        } else {
          return i;
        }
        break;
      }
    }
  }
}
