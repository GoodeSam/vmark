// WI-TP2.1: diagram isolation and intrinsic sizing within the terminal.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TranscriptMermaid } from "./TranscriptMermaid";
vi.mock("@/plugins/mermaid", () => ({ renderMermaid: vi.fn().mockResolvedValue('<svg viewBox="0 0 600 100"><script>alert(1)</script><text>Diagram</text></svg>') }));
describe("TranscriptMermaid", () => {
  it("uses intrinsic aspect ratio and a scriptless sandbox", async () => {
    render(<TranscriptMermaid source="graph TD; A-->B" />);
    const frame = await screen.findByTitle("Mermaid diagram");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveStyle({ aspectRatio: "6" });
    expect(frame.getAttribute("srcdoc")).not.toContain("<script");
    expect(frame.getAttribute("srcdoc")).toContain("default-src");
  });
});
