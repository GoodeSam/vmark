/** Window-local shell binding registry; tokens never derive from working directories.
 * A token that stops identifying a live shell is released, so its binding file is deleted.
 * @module services/terminal/transcriptBinding */
import { invoke } from "@tauri-apps/api/core";
import { terminalLog } from "@/utils/debug";
const tokens = new Map<string, string>();
const pending = new Map<string, object>();
function release(token: string): void {
  void invoke("terminal_transcript_forget", { token }).catch((error: unknown) => terminalLog("Transcript binding cleanup failed:", error));
}
export async function prepareTranscriptBinding(sessionId: string): Promise<string> {
  const request = {};
  pending.set(sessionId, request);
  const token = await invoke<string>("terminal_transcript_prepare");
  // A closed or restarted shell must not carry a token whose binding is released.
  if (pending.get(sessionId) !== request) {
    release(token);
    throw new Error("Transcript binding superseded");
  }
  const previous = tokens.get(sessionId);
  tokens.set(sessionId, token);
  if (previous) release(previous);
  return token;
}
export function transcriptToken(sessionId: string): string | undefined { return tokens.get(sessionId); }
export function forgetTranscriptBinding(sessionId: string): void {
  const token = tokens.get(sessionId);
  tokens.delete(sessionId);
  pending.delete(sessionId);
  if (token) release(token);
}
