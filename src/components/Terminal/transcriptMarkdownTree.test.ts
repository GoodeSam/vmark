// @vitest-environment node
// WI-TP3.1: only replies the terminal cannot draw (tables, diagrams) open the transcript.
import { describe, expect, it } from "vitest";
import { hasRichTranscriptContent, parseTranscriptMarkdown } from "./transcriptMarkdownTree";
describe("hasRichTranscriptContent", () => {
  it.each([
    ["a GFM table", "Intro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |"],
    ["a Mermaid fence", "```mermaid\ngraph TD; A-->B\n```"],
    ["a tilde Mermaid fence", "~~~mermaid\nsequenceDiagram\n  A->>B: hi\n~~~"],
    ["a table nested in a list", "- item\n\n  | A | B |\n  | - | - |\n  | 1 | 2 |"],
    ["a table in a blockquote", "> | A |\n> | - |\n> | 1 |"],
  ])("detects %s", (_label, text) => {
    expect(hasRichTranscriptContent(text)).toBe(true);
  });
  it.each([
    ["plain prose", "Just text, with a | pipe."],
    ["a table inside a code block", "```\n| A | B |\n| --- | --- |\n```"],
    ["a non-Mermaid code block", "```ts\nconst mermaid = 1;\n```"],
    ["pipes without a delimiter row", "| A | B |\n| 1 | 2 |"],
    ["an empty reply", ""],
    ["CJK prose", "这是一个表格：没有分隔行"],
  ])("ignores %s", (_label, text) => {
    expect(hasRichTranscriptContent(text)).toBe(false);
  });
});
describe("parseTranscriptMarkdown", () => {
  it("returns the top-level block nodes", () => {
    expect(parseTranscriptMarkdown("# H\n\ntext")?.map(node => node.type)).toEqual(["heading", "paragraph"]);
  });
});
