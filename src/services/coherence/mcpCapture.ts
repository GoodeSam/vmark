/**
 * MCP write capture (WI-1.6, split from captureFunnel.ts)
 *
 * Purpose: documents an external MCP client read since its last write become
 * the (inferred) input set of that write (spec §7 example 2). `recordMcpRead`
 * notes each read and pins the revision served at read time via
 * `coherence_head`; `captureMcpWrite` consumes the set and funnels the write
 * through `captureWrite`, so it carries the capture-on-save policy like every
 * other write path (WI-LX1.4).
 *
 * Key decisions:
 *   - Session reads are bounded (256, FIFO) and consumed per write; in-flight
 *     revision pins are awaited (bounded 500 ms) first.
 *
 * @coordinates-with captureFunnel.ts — `captureWrite`, the one IPC seam
 * @coordinates-with src-tauri/src/coherence/commands_ipc.rs — coherence_head
 * @module services/coherence/mcpCapture
 */
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { coherenceLog } from "@/utils/debug";
import {
  captureWrite,
  workspaceRelativePath,
  type CoherenceCaptureInput,
  type CoherenceCaptureReceipt,
} from "./captureFunnel";

// ── MCP session-read tracking (WI-1.6, spec §7 example 2) ───────────────
// Documents an external MCP client read since its last write become the
// (inferred) input set of that write. Module-level state is correct here:
// one webview = one bridge session. Bounded (audit T7): a read-only
// client cannot grow this without limit.
const MAX_SESSION_READS = 256;
const sessionReads = new Map<string, string | undefined>();
// In-flight revision pins (audit B5): a write consuming the read set
// awaits these (bounded) so read-time revisions actually arrive.
const pendingPins = new Set<Promise<void>>();

/** Record a document read served to the MCP client (absolute path).
 *  Pins the coherence revision served at READ time (audit T5) so a later
 *  upstream edit is never misattributed as this write's input. */
export function recordMcpRead(absolutePath: string): void {
  if (sessionReads.size >= MAX_SESSION_READS && !sessionReads.has(absolutePath)) {
    const oldest = sessionReads.keys().next().value;
    if (oldest !== undefined) sessionReads.delete(oldest);
  }
  sessionReads.set(absolutePath, undefined);
  const root = useWorkspaceStore.getState().rootPath;
  if (!root) return;
  const rel = workspaceRelativePath(root, absolutePath);
  if (!rel) return;
  const pin = invoke<{ object: string; revision: string } | null>("coherence_head", {
    workspaceRoot: root,
    path: rel,
  })
    .then((head) => {
      if (head && sessionReads.has(absolutePath)) {
        sessionReads.set(absolutePath, head.revision);
      }
    })
    .catch(() => {}); // pinning is best-effort; unpinned reads still count
  pendingPins.add(pin);
  void pin.finally(() => pendingPins.delete(pin));
}

/** Wait (bounded) for in-flight read pins — audit B5. */
async function awaitPendingPins(): Promise<void> {
  if (pendingPins.size === 0) return;
  await Promise.race([
    Promise.allSettled([...pendingPins]),
    new Promise((resolve) => setTimeout(resolve, 500)),
  ]);
}

/** Consume the session-read set as capture inputs for an MCP write. */
export function takeMcpReadInputs(root: string): CoherenceCaptureInput[] {
  const inputs: CoherenceCaptureInput[] = [];
  for (const [abs, revision] of sessionReads) {
    const rel = workspaceRelativePath(root, abs);
    if (rel) inputs.push({ path: rel, revision, role: "direct" });
  }
  sessionReads.clear();
  return inputs;
}

/**
 * Capture an MCP bridge write (document.write / workspace.save). Always
 * `inferred` — the external agent's true context is unobservable (G1
 * finding 2); the session-observed read set is an honest under-
 * approximation.
 */
export async function captureMcpWrite(args: {
  absolutePath: string;
  content: string;
  toolName: string;
}): Promise<CoherenceCaptureReceipt | null> {
  try {
    const root = useWorkspaceStore.getState().rootPath;
    if (!root) return null;
    await awaitPendingPins();
    const inputs = takeMcpReadInputs(root).filter((i) => {
      // The written doc itself is the transformation target, not an input.
      return i.path !== workspaceRelativePath(root, args.absolutePath);
    });
    return await captureWrite({
      absolutePath: args.absolutePath,
      content: args.content,
      inputs,
      agent: { type: "model", id: "mcp-client" },
      intent: { kind: "mcp-document-write", summary: args.toolName },
      confidence: "inferred",
    });
  } catch (error) {
    coherenceLog("MCP capture failed (write unaffected):", error);
    return null;
  }
}
