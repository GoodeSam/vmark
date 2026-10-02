// @vitest-environment node
// WI-RA10A.13 — the unqueued history steps have exactly one production caller.
/**
 * `historyStorage.ts` reads and writes a document's index with no ordering of
 * its own; it is safe only inside an operation the history queue has put in
 * line. `historyOperations.ts` is the module that does that. A second importer
 * would be a second writer of the index that nothing orders — the defect the
 * queue was added to remove, and one no behavioural test of the existing
 * operations could notice.
 *
 * So the importers are LISTED, and a new one fails here until it is routed
 * through a queued operation.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = join(import.meta.dirname, "../../..");

function productionSources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__" && name !== "__mocks__") productionSources(path, found);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      found.push(path);
    }
  }
  return found;
}

/** Repo-style relative paths of production files whose imports match. */
function importersOf(specifier: RegExp): string[] {
  return productionSources(SRC)
    .filter((path) => {
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].some(([, target]) =>
        specifier.test(target ?? ""),
      );
    })
    .map((path) => relative(SRC, path).split(sep).join("/"))
    .sort();
}

describe("the unqueued history steps", () => {
  it("are imported by the queued operations and nothing else", () => {
    expect(importersOf(/(?:^|\/)historyStorage(?:\.ts)?$/)).toEqual([
      "services/history/historyOperations.ts",
    ]);
  });

  it("finds an importer when there is one (the scan is not vacuous)", () => {
    expect(importersOf(/(?:^|\/)historyQueue(?:\.ts)?$/)).toEqual([
      "services/history/historyOperations.ts",
      "services/history/historyRecovery.ts",
    ]);
  });
});
