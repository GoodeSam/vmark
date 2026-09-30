// WI-TP3.2: the transcript takes the panel's long axis; terminal overlays stay over the CLI.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TerminalSessionsArea, transcriptAxis } from "./TerminalSessionsArea";
describe("transcriptAxis", () => {
  it.each([["bottom", "row"], ["top", "row"], ["left", "column"], ["right", "column"]] as const)("%s panel → %s", (position, axis) => {
    expect(transcriptAxis(position)).toBe(axis);
  });
});
describe("TerminalSessionsArea", () => {
  it("keeps the CLI and its overlays in their own area beside the transcript", () => {
    const { container } = render(<TerminalSessionsArea position="bottom" transcript={<aside data-testid="t" />}><div className="terminal-container" /><div className="overlay" /></TerminalSessionsArea>);
    const area = container.querySelector(".terminal-sessions-container");
    expect(area).toHaveClass("terminal-sessions-container--row");
    const grid = area?.querySelector(":scope > .terminal-grid-area");
    expect(grid?.querySelector(".terminal-container")).not.toBeNull();
    expect(grid?.querySelector(".overlay")).not.toBeNull();
    expect(grid?.nextElementSibling).toHaveAttribute("data-testid", "t");
  });
  it("adds no split modifier without a transcript", () => {
    const { container } = render(<TerminalSessionsArea position="right" transcript={null}><div /></TerminalSessionsArea>);
    expect(container.querySelector(".terminal-sessions-container")?.className).toBe("terminal-sessions-container");
  });
});
