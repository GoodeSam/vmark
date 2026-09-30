/** The one owner of the rendered transcript's following and open state, shared by
 * the tab-bar toggle (TerminalTabBar) and the region (TerminalTranscript). It keeps
 * following while collapsed so a new reply with a table or diagram can open it.
 * @module components/Terminal/useRenderedTranscript */
import { useCallback } from "react";
import { useTerminalTranscript } from "./useTerminalTranscript";
import { useTranscriptAutoOpen } from "./useTranscriptAutoOpen";
import type { TranscriptConfigStatus } from "./useTranscriptConfiguration";
export function useRenderedTranscript(sessionId: string | null, enabled: boolean, visible: boolean, configuration: TranscriptConfigStatus) {
  const { messages, failed, loaded } = useTerminalTranscript(sessionId, enabled && visible && configuration === "ready");
  const [open, setOpen] = useTranscriptAutoOpen(sessionId, messages, loaded);
  const expanded = enabled && open;
  const toggle = useCallback(() => setOpen(!expanded), [setOpen, expanded]);
  return { messages, failed, expanded, toggle };
}
