/** Automatic, non-overlapping transcript following. Hidden/disabled panels do no reads.
 * `loaded` turns true once a snapshot for the current binding has arrived (even an empty one).
 * @module components/Terminal/useTerminalTranscript */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { transcriptToken } from "@/services/terminal/transcriptBinding";
import { parseTerminalTranscript, type TranscriptMessage } from "@/utils/terminalTranscript";
import { terminalLog } from "@/utils/debug";
interface Snapshot { revision: string; data: string | null }
interface View { sessionId: string | null; messages: TranscriptMessage[]; failed: boolean; loaded: boolean }
export function useTerminalTranscript(sessionId: string | null, active: boolean) {
  const [view, setView] = useState<View>({ sessionId: null, messages: [], failed: false, loaded: false });
  useEffect(() => {
    if (!active || !sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision: string | null = null;
    let lastToken: string | undefined;
    let failing = false;
    const poll = async () => {
      try {
        const token = transcriptToken(sessionId);
        if (token !== lastToken) {
          lastToken = token;
          revision = null;
          if (!cancelled) setView({ sessionId, messages: [], failed: false, loaded: false });
        }
        if (!token) return;
        const snapshot = await invoke<Snapshot | null>("terminal_transcript_read", { token, revision });
        failing = false;
        if (cancelled || transcriptToken(sessionId) !== token) return;
        if (!snapshot) {
          revision = null;
          setView({ sessionId, messages: [], failed: false, loaded: true });
        } else {
          revision = snapshot.revision;
          if (snapshot.data !== null) setView({ sessionId, messages: parseTerminalTranscript(snapshot.data), failed: false, loaded: true });
        }
      } catch (error) {
        // Polling retries every second; log the transition, not every attempt.
        if (!failing) terminalLog("Transcript read failed:", error);
        failing = true;
        revision = null;
        if (!cancelled) setView({ sessionId, messages: [], failed: true, loaded: false });
      } finally {
        if (!cancelled) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [sessionId, active]);
  return view.sessionId === sessionId ? view : { sessionId, messages: [], failed: false, loaded: false };
}
