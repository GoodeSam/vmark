// @vitest-environment node
import { describe, it, expect } from "vitest";
import { scanHtmlTags } from "./htmlTags";

const tags = (html: string) => scanHtmlTags(html).map((t) => [t.name, t.offset, t.attrs.map((a) => [a.name, a.value])]);

describe("scanHtmlTags — start tags with parsed attributes, in one pass", () => {
  it("reads a start tag, its offset and its attributes", () => {
    expect(tags(`<p>a</p><script defer SRC = 'a.js' type="module"></script>`)).toEqual([
      ["p", 0, []],
      ["script", 8, [["defer", null], ["src", "a.js"], ["type", "module"]]],
    ]);
  });

  it("keeps `>` and `src=` inside a quoted value out of the markup", () => {
    expect(tags(`<script data-x=">" src="app.js"></script>`)).toEqual([["script", 0, [["data-x", ">"], ["src", "app.js"]]]]);
    expect(tags(`<script data-x="prefix src='x.js'">1</script>`)).toEqual([["script", 0, [["data-x", "prefix src='x.js'"]]]]);
  });

  it("reads unquoted values, empty attributes and a self-closing slash", () => {
    expect(tags(`<script async src=a.js defer/>`)).toEqual([["script", 0, [["async", null], ["src", "a.js"], ["defer", null]]]]);
    expect(tags(`<script src></script>`)).toEqual([["script", 0, [["src", null]]]]);
  });

  it("matches the tag name exactly", () => {
    expect(tags(`<script-foo src="a"></script-foo><scripts src="b"></scripts>`).map((t) => t[0])).toEqual(["script-foo", "scripts"]);
  });

  it("skips comments, CDATA, declarations and end tags", () => {
    expect(tags(`<!-- <script src="a.js"></script> --><!DOCTYPE html><?x?></p>`)).toEqual([]);
    expect(tags(`<svg><![CDATA[<script src="a.js"></script>]]></svg>`)).toEqual([["svg", 0, []]]);
  });

  it("does not read markup inside raw-text elements", () => {
    expect(tags(`<script>if (a<b && c>d) x("<a onclick=y>")</script><style>p>a{}</style><b>`).map((t) => t[0])).toEqual([
      "script",
      "style",
      "b",
    ]);
  });

  it("ends a raw-text element at its end tag, case-insensitively", () => {
    expect(tags(`<SCRIPT>1</SCRIPT ><a href=x>`).map((t) => t[0])).toEqual(["script", "a"]);
  });

  it("survives unterminated markup, dropping a tag still open at end of input as the browser does", () => {
    expect(tags(`<a href="x`)).toEqual([]);
    expect(tags(`<a href=x`)).toEqual([]);
    expect(tags(`<!-- never closed <script>`)).toEqual([]);
    expect(tags(`<script>never closed <b>`).map((t) => t[0])).toEqual(["script"]);
  });

});
