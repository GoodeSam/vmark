// @vitest-environment node
// WI-RA1A.6, WI-RA1C.2 — architecture-fitness test: the document, selection,
// workflow, workspace and session handlers stay on the shared tab guard and
// the generated wire contract.
//
// Both were once written out per handler: a tab resolver, a revision check and
// a `structuredError` in each file, and a `typeof args.x === "string"` chain
// restating a contract that is declared once elsewhere. The copies drifted.
// This test keeps the handlers migrated: it fails if one of them grows its own
// resolver, revision check, checkpoint or error helper again, or reads a
// payload field straight off `args` — and it fails if a new handler module of
// this surface appears without being held to the rule.
//
// The browser handlers (`browser*.ts`) are a different surface with their own
// tab resolver and access gate (`browserHelpers.ts`, `browserAccess.ts`), and
// are not covered here.
//
// @coordinates-with services/mcpBridge/v2/tabGuard.ts — the shared guard
// @coordinates-with services/mcpBridge/v2/readOperationArgs.ts — the one payload parse
// @coordinates-with services/mcpBridge/v2/checkpoint.ts — the one checkpoint recorder

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const V2_ROOT = resolve(import.meta.dirname, "..");

/** Handlers that act on a DOCUMENT: each resolves it through the tab guard. */
const DOCUMENT_HANDLERS = [
  "document.ts",
  "selection.ts",
  "workflow.ts",
  "workspaceSave.ts",
  "workspaceSaveAs.ts",
];

/**
 * Handlers that act on tabs, windows or the session as a whole. They create,
 * close and activate tabs, so they use the tab store — to do that, not to
 * guard a document.
 */
const LIFECYCLE_HANDLERS = [
  "session.ts",
  "workspace.ts",
  "workspaceOpen.ts",
  "workspaceOpenFolder.ts",
];

const ALL_HANDLERS = [...DOCUMENT_HANDLERS, ...LIFECYCLE_HANDLERS];

/** Comments describe the old patterns to explain the rule; only code counts. */
function code(file: string): string {
  return readFileSync(resolve(V2_ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const DEFINES_HANDLER = /export async function handle\w+/;

describe("the handler modules of this surface", () => {
  it("are all held to the rule: none is missing from the lists above", () => {
    const handlerModules = readdirSync(V2_ROOT)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .filter((name) => !name.startsWith("browser"))
      .filter((name) => DEFINES_HANDLER.test(code(name)))
      .sort();

    expect(handlerModules).toEqual([...ALL_HANDLERS].sort());
  });
});

describe.each(ALL_HANDLERS)("%s stays on the shared contract", (file) => {
  const source = code(file);

  it("is a handler module with something to check", () => {
    expect(source).toMatch(DEFINES_HANDLER);
  });

  it("does not define its own structuredError", () => {
    expect(source).not.toMatch(/function structuredError\b/);
  });

  it("reads its payload with readOperationArgs, never straight off args", () => {
    expect(source).toContain("readOperationArgs(");
    // `args` may only be handed on whole; `args.field`, `args?.field` and
    // `args[field]` are hand-written reads.
    expect(source).not.toMatch(/\bargs\s*(\?\.|\.|\[)/);
    expect(source).not.toMatch(/typeof\s+args\b/);
  });

  it("does not check a revision or record a checkpoint by hand", () => {
    expect(source).not.toContain("isCurrentRevision");
    expect(source).not.toContain("checkpointPush");
    expect(source).not.toContain("appendCheckpoint");
  });
});

describe.each(DOCUMENT_HANDLERS)("%s resolves its document through the guard", (file) => {
  const source = code(file);

  it("resolves its tab through tabGuard", () => {
    expect(source).toMatch(/from "\.\/tabGuard"/);
    expect(source).toContain("requireTab(");
  });

  it("does not reach into the tab store to guard a request itself", () => {
    // Its own resolver would read these; the guard is the one place that does.
    expect(source).not.toContain("activeTabId");
    expect(source).not.toContain("useTabStore");
  });

  it("does not render a structured error itself", () => {
    expect(source).not.toContain("v2ErrorString");
  });
});
