/** One Markdown parser for the transcript: the renderer's tree, and the question of
 * whether a reply holds anything the terminal grid cannot draw (tables, diagrams).
 * @module components/Terminal/transcriptMarkdownTree */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent } from "mdast";
const processor = unified().use(remarkParse).use(remarkGfm);
/** Top-level nodes, or null when the text cannot be parsed (render it raw). */
export function parseTranscriptMarkdown(text: string): RootContent[] | null {
  try { return (processor.runSync(processor.parse(text)) as Root).children; }
  catch { return null; }
}
function isRich(node: RootContent): boolean {
  if (node.type === "table") return true;
  if (node.type === "code") return node.lang === "mermaid";
  return "children" in node && (node.children as RootContent[]).some(isRich);
}
/** True when the reply contains a GFM table or a Mermaid block, at any depth. */
export function hasRichTranscriptContent(text: string): boolean {
  return parseTranscriptMarkdown(text)?.some(isRich) ?? false;
}
