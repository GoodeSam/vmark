// @vitest-environment node
import { describe, it, expect } from "vitest";
import { jsonErrorOffset } from "./jsonErrorOffset";

describe("jsonErrorOffset — where the first JSON syntax error is, on any engine", () => {
  it.each([
    [`{ "a": 1, "b": [true, false, null], "c": {"d": -1.5e+3} }`],
    [`""`],
    [`0`],
    [`{"名": "值", "emoji": "😀"}`],
    [`"escapes \\" \\\\ \\/ \\b \\f \\n \\r \\t \\u00e9"`],
    [`  [ ]  `],
  ])("accepts valid JSON: %s", (text) => {
    expect(jsonErrorOffset(text)).toBeNull();
  });

  it.each([
    // The live case: a trailing comma, then end of input. JavaScriptCore's
    // message carries no position, so this used to land on 1:1.
    [`{ "name": "broken",`, 19],
    [`{"a": 1,}`, 8],
    [`[1, 2,, 3]`, 6],
    [`{"a" 1}`, 5],
    [`"unterminated`, 13],
    [`{"a": tru}`, 6],
    [`01`, 1],
    [`1 2`, 2],
    [``, 0],
    [`   `, 3],
    ["\"a\nb\"", 2],
    [`"\\u12G4"`, 1],
    [`"\\x"`, 1],
    [`{"a": 1}}`, 8],
    [`[1, 2`, 5],
    [`-`, 1],
    [`1.`, 2],
    [`1e`, 2],
    [`{"值": 1,}`, 8],
  ])("finds the first error in %j at offset %i", (text, offset) => {
    expect(jsonErrorOffset(text)).toBe(offset);
  });

  it("does not recurse: 100,000 levels of nesting neither throw nor pass when unbalanced", () => {
    const depth = 100_000;
    expect(jsonErrorOffset("[".repeat(depth) + "]".repeat(depth))).toBeNull();
    expect(jsonErrorOffset("[".repeat(depth))).toBe(depth);
  });
});
