/** The terminal grid beside its optional rendered transcript. The transcript takes the
 * panel's long axis — to the right in a top/bottom panel, below in a left/right one —
 * and the grid's overlays (search bar, empty state) stay inside the grid's own area.
 * @module components/Terminal/TerminalSessionsArea */
import type { ReactNode } from "react";
import type { EffectiveTerminalPosition } from "@/stores/uiStore";
import { isHorizontalTerminalAxis } from "./useTerminalPosition";
export function transcriptAxis(position: EffectiveTerminalPosition): "row" | "column" {
  return isHorizontalTerminalAxis(position) ? "column" : "row";
}
export function TerminalSessionsArea({ position, transcript, children }: { position: EffectiveTerminalPosition; transcript: ReactNode; children: ReactNode }) {
  const className = transcript ? `terminal-sessions-container terminal-sessions-container--${transcriptAxis(position)}` : "terminal-sessions-container";
  return <div className={className}><div className="terminal-grid-area">{children}</div>{transcript}</div>;
}
