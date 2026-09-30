/** Reflect the persisted setting into the additive CLI hook configuration.
 * @module components/Terminal/useTranscriptConfiguration */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { terminalLog } from "@/utils/debug";
/** "pending" until the backend confirms the current setting; never mistaken for failure. */
export type TranscriptConfigStatus = "pending" | "ready" | "failed";
export function useTranscriptConfiguration(enabled: boolean): TranscriptConfigStatus {
  const [settled, setSettled] = useState<{ enabled: boolean; status: TranscriptConfigStatus } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void invoke("terminal_transcript_configure", { enabled }).then(() => {
      if (!cancelled) setSettled({ enabled, status: "ready" });
    }).catch((error: unknown) => {
      terminalLog("Transcript configuration failed:", error);
      if (!cancelled) setSettled({ enabled, status: "failed" });
    });
    return () => { cancelled = true; };
  }, [enabled]);
  return settled?.enabled === enabled ? settled.status : "pending";
}
