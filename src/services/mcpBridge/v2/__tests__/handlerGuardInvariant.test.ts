// @vitest-environment node
// WI-RA1A.6 — architecture-fitness test for the handlers that have been moved
// onto the shared tab guard and the generated wire contract.
//
// Both were once written out per handler: a tab resolver, a revision check and
// a `structuredError` in each file, and a `typeof args.x === "string"` chain
// restating a contract that is declared once elsewhere. The copies drifted.
// This test keeps a migrated handler migrated: it fails if one of them grows
// its own resolver, revision check or error helper again, or reads a payload
// field straight off `args`.
//
// The list below is the set of handlers that HAVE been migrated, not a list of
// exceptions: a file is added here when it is converted, and from then on it
// is held to the rule.
//
// @coordinates-with services/mcpBridge/v2/tabGuard.ts — the shared guard
// @coordinates-with services/mcpBridge/v2/readOperationArgs.ts — the one payload parse

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const V2_ROOT = resolve(import.meta.dirname, "..");

const MIGRATED_HANDLERS = ["document.ts", "selection.ts", "workspaceSave.ts", "workspaceSaveAs.ts"];

/** Comments describe the old patterns to explain the rule; only code counts. */
function code(file: string): string {
  return readFileSync(resolve(V2_ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe.each(MIGRATED_HANDLERS)("%s stays on the shared guard and contract", (file) => {
  const source = code(file);

  it("is a handler module with something to check", () => {
    expect(source).toMatch(/export async function handle\w+/);
  });

  it("resolves its tab through tabGuard", () => {
    expect(source).toMatch(/from "\.\/tabGuard"/);
    expect(source).toContain("requireTab(");
  });

  it("does not reach into the tab or revision stores to guard a request itself", () => {
    // Its own resolver would read these; the guard is the one place that does.
    expect(source).not.toContain("activeTabId");
    expect(source).not.toContain("useTabStore");
    expect(source).not.toContain("isCurrentRevision");
  });

  it("does not define its own structuredError", () => {
    expect(source).not.toMatch(/function structuredError\b/);
    expect(source).not.toContain("v2ErrorString");
  });

  it("reads its payload with readOperationArgs, never straight off args", () => {
    expect(source).toContain("readOperationArgs(");
    // `args` may only be handed on whole; `args.field` is a hand-written read.
    expect(source).not.toMatch(/\bargs\s*(\.|\[)/);
    expect(source).not.toMatch(/typeof\s+args\b/);
  });
});
