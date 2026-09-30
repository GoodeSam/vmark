// WI-TP2.1: real tables, inert model-supplied markup, failure fallback.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TranscriptMarkdown } from "./TranscriptMarkdown";
vi.mock("@/plugins/mermaid", () => ({ renderMermaid: vi.fn().mockResolvedValue(null) }));
describe("TranscriptMarkdown", () => {
  it("renders ordinary Markdown without using editor state", () => {
    const { container } = render(<TranscriptMarkdown text={"# Heading\n\nText *emphasis* **strong** ~~removed~~ `inline`  \nbreak\n\n> quote\n\n1. ordered\n\n- unordered\n\n---\n\n```js\nconst x = 1;\n```\n\n[reference][r]\n\n[r]: https://example.com\n\n![alternate][i]\n\n[i]: https://example.com/image"} />);
    expect(container.querySelector("em")).toHaveTextContent("emphasis");
    expect(container.querySelector("del")).toHaveTextContent("removed");
    expect(container.querySelector("blockquote")).toHaveTextContent("quote");
    expect(container.querySelector("ol")).toHaveTextContent("ordered");
    expect(container.querySelector("ul")).toHaveTextContent("unordered");
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.querySelector("br")).not.toBeNull();
    expect(container.querySelector("pre")).toHaveTextContent("const x = 1;");
    expect(container.querySelector("img, a")).toBeNull();
  });
  it("renders GFM tables with selectable text", () => {
    render(<TranscriptMarkdown text={"| Name | Value |\n| --- | --- |\n| 中文 | 42 |"} />);
    expect(screen.getByRole("table")).toHaveTextContent("中文");
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
  });
  it("does not activate raw HTML, external images or javascript links", () => {
    const { container } = render(<TranscriptMarkdown text={'<script>alert(1)</script>\n\n![image](https://example.com/i.png)\n\n[link](javascript:alert(1))'} />);
    expect(container.querySelector("script, img, a")).toBeNull();
  });
  it("keeps invalid Mermaid readable", async () => {
    render(<TranscriptMarkdown text={'```mermaid\ninvalid diagram\n```'} />);
    expect(await screen.findByText("invalid diagram")).toBeInTheDocument();
  });
});
