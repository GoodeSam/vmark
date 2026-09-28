// @vitest-environment node
/**
 * The source highlighter must actually colour real grammars.
 *
 * A dependency bump left two copies of `@lezer/common` in the lockfile:
 * `@codemirror/language` on one, `@lezer/highlight` and every `@lezer/*`
 * grammar on the other. Each copy numbers its NodeProps from its own counter,
 * so a prop id from one collides with a prop id from the other, the
 * highlighter reads the wrong prop as its style rule, and `style(tags)` throws.
 * CodeMirror catches the throw and logs "plugin crashed" — every Source pane
 * went monochrome while every check stayed green. This walks the same path the
 * editor's `syntaxHighlighting` plugin does and fails loudly instead.
 */
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, type LanguageSupport } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";
import { yaml } from "@codemirror/lang-yaml";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { codeHighlightStyle } from "./theme";

function highlightedClasses(doc: string, language: LanguageSupport): string[] {
  const state = EditorState.create({ doc, extensions: [language] });
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  if (!tree) throw new Error("the parser did not finish");
  const classes: string[] = [];
  highlightTree(tree, codeHighlightStyle, (_from, _to, cls) => classes.push(cls));
  return classes;
}

describe("codeHighlightStyle on real grammars", () => {
  it.each<[string, string, LanguageSupport]>([
    ["yaml", "name: demo\nitems:\n  - a\nnested:\n  ok: true\n", yaml()],
    ["json", '{ "name": "demo", "ok": true, "n": 1 }', json()],
    ["markdown", "# Title\n\nSome *emphasis* and `code`.\n", markdown()],
  ])("colours %s without throwing", (_name, doc, language) => {
    const classes = highlightedClasses(doc, language);
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.some((c) => /(^|\s)cm-hl-/.test(c))).toBe(true);
  });
});
