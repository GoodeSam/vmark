/**
 * Capture-on-save policy (WI-LX1.4)
 *
 * Purpose: map `general.coherenceCaptureOnSave` onto the kernel's
 * `CapturePolicy` wire value. Every write-driven coherence IPC
 * (`coherence_capture`, the watcher's `coherence_scan`) carries it, and the
 * Rust kernel enforces it — so one setting governs every write path: human
 * save, MCP `document.write` / `workspace.save`, genie apply, accepted AI
 * suggestions, history restore and explorer new-file.
 *
 * Key decisions:
 *   - Read at the moment of each write, not pushed at startup: there is no
 *     second copy of the setting that could lag the store.
 *   - `tracked-only` (setting OFF) never creates `.vmark/` and never stamps a
 *     `vmark:` block into any file; in a workspace whose ledger already exists
 *     it keeps recording writes to documents that ledger already tracks.
 *     `adopt` (setting ON) may do both.
 *
 * @coordinates-with src-tauri/src/coherence/capture_policy.rs — the enforcement
 * @module services/coherence/capturePolicy
 */
import { useSettingsStore } from "@/stores/settingsStore";

/** Wire names of `coherence::capture_policy::CapturePolicy`. */
export type CapturePolicy = "adopt" | "tracked-only";

/** The policy for a write happening now. */
export function currentCapturePolicy(): CapturePolicy {
  return useSettingsStore.getState().general.coherenceCaptureOnSave ? "adopt" : "tracked-only";
}
