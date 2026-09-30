/** Read-only transcript Markdown: React elements, no raw HTML or remote resources.
 * @module components/Terminal/TranscriptMarkdown */
import { useMemo, type ReactNode } from "react";
import type { RootContent, PhrasingContent } from "mdast";
import { TranscriptMermaid } from "./TranscriptMermaid";
import { parseTranscriptMarkdown } from "./transcriptMarkdownTree";
type Node = RootContent | PhrasingContent;
function renderNode(node: Node, key: number): ReactNode {
  const children = "children" in node ? node.children.map((child, index) => renderNode(child as Node, index)) : null;
  switch (node.type) {
    case "text": return node.value;
    case "paragraph": return <p key={key}>{children}</p>;
    case "heading": return <strong key={key} className="transcript-heading">{children}</strong>;
    case "emphasis": return <em key={key}>{children}</em>;
    case "strong": return <strong key={key}>{children}</strong>;
    case "delete": return <del key={key}>{children}</del>;
    case "inlineCode": return <code key={key}>{node.value}</code>;
    case "code": return node.lang === "mermaid" ? <TranscriptMermaid key={key} source={node.value} /> : <pre key={key}><code>{node.value}</code></pre>;
    case "blockquote": return <blockquote key={key}>{children}</blockquote>;
    case "list": return node.ordered ? <ol key={key} start={node.start ?? 1}>{children}</ol> : <ul key={key}>{children}</ul>;
    case "listItem": return <li key={key}>{children}</li>;
    case "break": return <br key={key} />;
    case "thematicBreak": return <hr key={key} />;
    case "table": return <div key={key} className="transcript-table"><table><thead><tr>{node.children[0]?.children.map((cell, index) => <th key={index}>{cell.children.map(renderNode)}</th>)}</tr></thead><tbody>{node.children.slice(1).map((row, index) => <tr key={index}>{row.children.map((cell, index) => <td key={index}>{cell.children.map(renderNode)}</td>)}</tr>)}</tbody></table></div>;
    case "link": case "linkReference": return <span key={key}>{children}</span>;
    case "image": case "imageReference": return <span key={key}>{node.alt}</span>;
    case "html": return <pre key={key}>{node.value}</pre>;
    default: return null;
  }
}
export function TranscriptMarkdown({ text }: { text: string }) {
  const nodes = useMemo(() => parseTranscriptMarkdown(text), [text]);
  return <div className="transcript-markdown">{nodes ? nodes.map(renderNode) : <pre>{text}</pre>}</div>;
}
