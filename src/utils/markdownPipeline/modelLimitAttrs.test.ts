// @vitest-environment node
// WI-RA2.3 — code-fence meta and list looseness pass through the converters
// for a schema that can hold them.
/**
 * The production schema has no attribute for either today: the code block
 * keeps only its language, and lists keep no tight/loose flag. The spec
 * round-trip ledger records both as `model-limit` data loss. The converters
 * are the half of the fix this module owns; the attributes are declared on
 * the editor's node extensions, so these tests run on the pipeline's test
 * schema with the two attributes added — the shape those extensions need.
 * Until then the converters pass nothing, because ProseMirror ignores an
 * attribute a node type does not declare.
 */
import { describe, it, expect } from "vitest";
import { Schema, type NodeSpec } from "@tiptap/pm/model";
import { testSchema } from "./testSchema";
import { parseMarkdown, serializeMarkdown } from "./adapter";
import { getProductionSchema } from "@/test/productionSchema";

function withAttrs(names: Record<string, Record<string, { default: unknown }>>): Schema {
  let nodes = testSchema.spec.nodes;
  for (const [name, attrs] of Object.entries(names)) {
    const spec = nodes.get(name) as NodeSpec;
    nodes = nodes.update(name, { ...spec, attrs: { ...spec.attrs, ...attrs } });
  }
  return new Schema({ nodes, marks: testSchema.spec.marks });
}

const schema = withAttrs({
  codeBlock: { meta: { default: null } },
  bulletList: { spread: { default: false } },
  orderedList: { spread: { default: false } },
});
const roundTrip = (markdown: string, on: Schema = schema): string =>
  serializeMarkdown(on, parseMarkdown(on, markdown));

describe("code-fence meta", () => {
  it.each([
    ["line highlights", "```js {1,3}\ncode\n```\n"],
    ["a title", '```ts title="a.ts"\nconst a = 1;\n```\n'],
    ["CJK", "```python 标题\nprint(1)\n```\n"],
    ["a tilde fence", "~~~js meta\ncode\n~~~\n", "```js meta\ncode\n```\n"],
  ])("keeps %s", (_label, source, expected = source) => {
    const doc = parseMarkdown(schema, source);
    expect(doc.firstChild?.attrs.meta).toBe(source.split("\n")[0].replace(/^[`~]{3}\S+ /, ""));
    expect(roundTrip(source)).toBe(expected);
    expect(roundTrip(roundTrip(source))).toBe(expected);
  });

  it("writes no meta for a block without one", () => {
    expect(roundTrip("```js\ncode\n```\n")).toBe("```js\ncode\n```\n");
    expect(parseMarkdown(schema, "```js\ncode\n```\n").firstChild?.attrs.meta).toBeNull();
  });

  it("is still dropped by the production schema, which has no attribute for it", () => {
    expect(roundTrip("```js {1,3}\ncode\n```\n", getProductionSchema())).toBe("```js\ncode\n```\n");
  });
});

describe("list looseness", () => {
  it.each([
    ["a loose bullet list", "- a\n\n- b\n\n- c\n"],
    ["a loose ordered list", "1. a\n\n2. b\n"],
    ["a tight bullet list", "- a\n- b\n"],
    ["a tight ordered list", "1. a\n2. b\n"],
    ["a loose list of CJK items", "- 甲\n\n- 乙\n"],
    // Looseness is a property of the LIST here. A blank line between an
    // item's own paragraph and its nested list (item-level spread) is not
    // carried; the list as a whole stays loose.
    ["a tight list inside a loose one", "- a\n  - x\n  - y\n\n- b\n"],
  ])("keeps %s", (_label, source) => {
    expect(roundTrip(source)).toBe(source);
  });

  it("marks a list loose when any item holds two blocks", () => {
    expect(roundTrip("- a\n\n  more\n- b\n")).toBe("- a\n\n  more\n\n- b\n");
  });

  it("is still lost by the production schema, which has no attribute for it", () => {
    expect(roundTrip("- a\n\n- b\n", getProductionSchema())).toBe("- a\n- b\n");
  });
});
