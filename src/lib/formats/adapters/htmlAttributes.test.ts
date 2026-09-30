// @vitest-environment node
import { describe, it, expect } from "vitest";
import { decodeReferences, parseAttributes } from "./htmlAttributes";

describe("decodeReferences — the character references the scanner supports", () => {
  it.each([
    ["java&#115;cript:", "javascript:"],
    ["java&#115cript:", "javascript:"],
    ["javascrip&#x74:", "javascript:"],
    ["java&#x73cript:", "javaܼript:"],
    ["javascript&colon;x", "javascript:x"],
    ["java&Tab;script:", "java\tscript:"],
    ["&lt;script&gt;", "<script>"],
    ["a &unknown; b", "a &unknown; b"],
    ["&#0;", "�"],
    ["plain", "plain"],
  ])("%j → %j", (raw, decoded) => {
    expect(decodeReferences(raw)).toBe(decoded);
  });
});

describe("parseAttributes — from just past a tag name to its closing >", () => {
  const parse = (text: string) => parseAttributes(text, text.toLowerCase(), 0);

  it("honours quotes, so a quoted > does not end the tag", () => {
    const r = parse(` data-x=">" src="a.js">rest`);
    expect(r.attrs.map((a) => [a.name, a.value])).toEqual([["data-x", ">"], ["src", "a.js"]]);
    expect(r.closed).toBe(true);
    expect(r.end).toBe(` data-x=">" src="a.js">`.length);
  });

  it("keeps the first of duplicate attributes and decodes values", () => {
    const r = parse(` HREF="java&#115;cript:x" href="y">`);
    expect(r.attrs).toEqual([{ name: "href", value: "javascript:x", offset: 1 }]);
  });

  it("reads a self-closing slash and valueless attributes", () => {
    const r = parse(` async/>`);
    expect(r.selfClosing).toBe(true);
    expect(r.attrs.map((a) => [a.name, a.value])).toEqual([["async", null]]);
  });

  it("reports a tag the input ends inside as not closed", () => {
    expect(parse(` href="x`).closed).toBe(false);
    expect(parse(` href=x`).closed).toBe(false);
  });
});
