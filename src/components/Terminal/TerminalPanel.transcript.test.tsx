/**
 * TerminalPanel — rendered-transcript wiring (WI-TP3.3).
 *
 * The audit flagged the path from `terminal.transcriptPreview` through hook
 * configuration and following to the tab-bar toggle and the region as an
 * untested critical path: each piece is tested alone, so broken wiring here
 * would pass them all. The hooks are mocked at their boundary; the panel's
 * job is only to connect them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  rendered: vi.fn(),
  toggle: vi.fn(),
  state: { expanded: false, failed: false, messages: [] as { id: string; text: string }[] },
}));

vi.mock("./useTerminalSessions", () => ({
  useTerminalSessions: () => ({ fit: vi.fn(), getActiveTerminal: () => null, getActiveSearchAddon: () => null, restartActiveSession: vi.fn() }),
}));
vi.mock("./useTerminalResize", () => ({ useTerminalResize: () => ({ isResizing: false, handleResizeStart: vi.fn() }) }));
vi.mock("./TerminalSearchBar", () => ({ TerminalSearchBar: () => null }));
vi.mock("@/plugins/mermaid", () => ({ renderMermaid: vi.fn().mockResolvedValue(null) }));
vi.mock("./useTranscriptConfiguration", () => ({ useTranscriptConfiguration: (enabled: boolean) => (enabled ? "ready" : "pending") }));
vi.mock("./useRenderedTranscript", () => ({
  useRenderedTranscript: (...args: unknown[]) => {
    mocks.rendered(...args);
    return { ...mocks.state, toggle: mocks.toggle };
  },
}));
vi.mock("./TerminalTabBar", () => ({
  TerminalTabBar: (props: { transcript?: { expanded: boolean; controls: string; onToggle: () => void } }) =>
    props.transcript ? (
      <button data-testid="toggle" data-expanded={String(props.transcript.expanded)} data-controls={props.transcript.controls} onClick={props.transcript.onToggle} />
    ) : (
      <div data-testid="no-toggle" />
    ),
}));

import { TerminalPanel } from "./TerminalPanel";
import { useUIStore, resetTerminalSessionStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { expanded: false, failed: false, messages: [] };
  useUIStore.setState({ terminalVisible: true, terminalHeight: 200, terminalWidth: 300, effectiveTerminalPosition: "bottom" } as never);
  // A real, visible session: the panel realigns a stale active id to null.
  resetTerminalSessionStore();
  useUIStore.getState().terminalCreateSession();
  useSettingsStore.getState().updateTerminalSetting("transcriptPreview", false);
});

const activeId = () => {
  const id = useUIStore.getState().terminal.activeSessionId;
  expect(id).toEqual(expect.any(String));
  return id;
};

describe("TerminalPanel — rendered transcript wiring", () => {
  it("offers no toggle and no region while the setting is off, and follows nothing", () => {
    render(<TerminalPanel />);
    expect(screen.getByTestId("no-toggle")).toBeInTheDocument();
    expect(document.querySelector(".terminal-transcript")).toBeNull();
    expect(mocks.rendered).toHaveBeenLastCalledWith(activeId(), false, true, "pending");
  });

  it("follows the active session and offers a collapsed toggle once enabled", () => {
    useSettingsStore.getState().updateTerminalSetting("transcriptPreview", true);
    render(<TerminalPanel />);
    expect(mocks.rendered).toHaveBeenLastCalledWith(activeId(), true, true, "ready");
    expect(screen.getByTestId("toggle")).toHaveAttribute("data-expanded", "false");
    expect(document.querySelector(".terminal-transcript")).toBeNull();
    fireEvent.click(screen.getByTestId("toggle"));
    expect(mocks.toggle).toHaveBeenCalledOnce();
  });

  it("renders the region the toggle controls, with the followed messages, while expanded", () => {
    useSettingsStore.getState().updateTerminalSetting("transcriptPreview", true);
    mocks.state = { expanded: true, failed: false, messages: [{ id: "m", text: "| A |\n| - |\n| 1 |" }] };
    render(<TerminalPanel />);
    const toggle = screen.getByTestId("toggle");
    const region = document.querySelector(".terminal-transcript");
    expect(toggle).toHaveAttribute("data-expanded", "true");
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("id", toggle.getAttribute("data-controls"));
    expect(screen.getByRole("table")).toHaveTextContent("1");
    // Beside the CLI for a bottom panel.
    expect(document.querySelector(".terminal-sessions-container")).toHaveClass("terminal-sessions-container--row");
  });
});
