/**
 * Purpose: answer "was this module started as the entry script?" — the guard
 * every gate uses to run `main()` when invoked and stay inert when a test or
 * another script imports it.
 *
 * Usage: `if (isMainModule(import.meta.url)) main();`
 *
 * WHY ONE HELPER. Each gate used to compare `import.meta.url` with
 * `process.argv[1]` itself, five different ways, and each was silently false on
 * some path — so `main()` never ran and the gate exited 0 having checked
 * nothing (#1473). `file://${argv[1]}` never matched a percent-encoded path (a
 * space or CJK character in the checkout); the path-based forms never matched
 * through a symlink, because Node runs the module's REAL path while argv[1]
 * stays as typed (on macOS, `/tmp` and `/var/folders` are symlinks).
 *
 * Contract: our own scripts, invoked as `node <path>` or `tsx <path>` (every
 * invocation in package.json, CI and the git hooks names the file with its
 * extension). Both sides are compared as real paths; a missing argv[1], or one
 * that names no file, is not this module. Out of contract: `node -e` (argv[1]
 * is then just an argument), extensionless or `--entry-url` entries, query-
 * string imports and `--preserve-symlinks-main`.
 *
 * `import.meta.main` is the native answer, but it arrived in Node 22.18 and
 * `engines.node` is `>=22`; replace this helper with it once the floor passes.
 *
 * @coordinates-with scripts/lib/isMainModule.test.mjs — the path shapes, with real child processes
 * @coordinates-with scripts/check-main-module-guards.test.mjs — no script reads argv[1] for this itself
 * @module scripts/lib/isMainModule
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Whether the module at `moduleUrl` is the process's entry script.
 *
 * @param {string} moduleUrl the caller's own `import.meta.url`
 * @returns {boolean}
 */
export function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(path.resolve(entry));
  } catch {
    return false; // argv[1] names no file, so it is not this module
  }
}
