// WI-TP2.1 / WI-TP3.3: the rendered transcript region; its toggle lives in the tab bar.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalTranscript } from "./TerminalTranscript";
vi.mock("@/plugins/mermaid", () => ({ renderMermaid: vi.fn().mockResolvedValue(null) }));
const TABLE = { id: "t", text: "| A | B |\n| --- | --- |\n| X | Y |" };
describe("TerminalTranscript", () => {
  it("is a named region the toggle can point at, rendering each reply", () => {
    render(<TerminalTranscript id="tx" messages={[TABLE]} failed={false} configuration="ready" />);
    const region = screen.getByRole("region", { name: "Rendered Transcript" });
    expect(region).toHaveAttribute("id", "tx");
    expect(screen.getByRole("table")).toHaveTextContent("X");
  });
  it("waits without an error while hook configuration is still pending", () => {
    render(<TerminalTranscript id="tx" messages={[]} failed={false} configuration="pending" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/Waiting for a Claude\/Codex session/)).toBeInTheDocument();
  });
  it.each([["configuration", { failed: false, configuration: "failed" as const }], ["reading", { failed: true, configuration: "ready" as const }]])("reports a %s failure", (_label, state) => {
    render(<TerminalTranscript id="tx" messages={[TABLE]} {...state} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Transcript unavailable");
  });
});
