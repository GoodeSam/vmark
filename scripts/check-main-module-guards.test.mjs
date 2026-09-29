/**
 * No script decides "was I run directly?" by reading `process.argv[1]` itself:
 * they all go through `isMainModule(import.meta.url)` (scripts/lib/isMainModule.mjs).
 *
 * Every hand-written comparison of `import.meta.url` with argv[1] in this repo
 * had a path on which it was silently false — a space or CJK character in the
 * checkout path, a symlink — and then the gate's `main()` never ran and it
 * exited 0 having checked nothing (#1473). Thirty-eight scripts carried five
 * spellings of it. This keeps a thirty-ninth from being written.
 *
 * A plain text scan: these are our own build scripts, not an adversary, so the
 * idiom is what is caught, not every way to obfuscate it. Scanned: every JS/TS
 * file git lists under scripts/ and server/ (node_modules and build output are
 * ignored). Flagged: `argv[1]`, and `import.meta.main` — the native answer, but
 * `undefined` below Node 22.18 while `engines.node` allows 22.0, which is the
 * same silent skip. Exempt, each for a reason:
 *   - scripts/lib/isMainModule.mjs — the one place that reads argv[1] for this;
 *   - `*.test.*` / `*.spec.*` — vitest imports them, so they are never an entry
 *     script and cannot hold a main guard; several quote the old guards as
 *     fixtures, and some stub a CLI whose `node -e` reads its own argv[1].
 *
 * @coordinates-with scripts/lib/isMainModule.mjs — the helper every script uses
 * @module scripts/check-main-module-guards.test
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const HELPER = "scripts/lib/isMainModule.mjs";
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TEST_FILE = /\.(?:test|spec)\.[^/]+$/;
const FORBIDDEN = /argv\[1\]|import\.meta\.main\b/;

/** The files the scan covers in the git checkout at `root`: tracked, plus untracked and not ignored. */
function scannedFiles(root) {
  // `-z`: otherwise git quotes any path with a non-ASCII byte, and the quoted spelling names no file.
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "scripts", "server"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((f) => SOURCE.test(f) && !TEST_FILE.test(f) && f !== HELPER);
}

/** `file:line: text` for every forbidden line in the scanned files under `root`. */
function offenders(root) {
  return scannedFiles(root).flatMap((file) => {
    let source;
    try {
      source = readFileSync(path.join(root, file), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return []; // listed by git, deleted in the working tree
      throw error;
    }
    return source
      .split("\n")
      .flatMap((line, i) => (FORBIDDEN.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
  });
}

describe("entry-point checks go through isMainModule", () => {
  it("scans the scripts (guards against a silently empty sweep)", () => {
    const files = scannedFiles(REPO);
    expect(files.length).toBeGreaterThan(100);
    for (const f of ["scripts/check-no-nul-bytes.mjs", "scripts/check-theme-contrast.ts", "server/mcp/scripts/gen-mcp-contracts.ts"]) {
      expect(files).toContain(f);
    }
  });

  it("no script reads argv[1] or import.meta.main to decide it was run directly", () => {
    expect(offenders(REPO), "use `if (isMainModule(import.meta.url))` from scripts/lib/isMainModule.mjs").toEqual([]);
  });

  it("catches a guard seeded into a scanned file, and exempts only the helper and tests", () => {
    const root = mkdtempSync(path.join(tmpdir(), "main-guards-"));
    try {
      const guard = "if (import.meta.url === `file://${process.argv[1]}`) main();\n";
      for (const rel of ["scripts/check-x.mjs", "server/mcp/scripts/gen.ts", HELPER, "scripts/check-x.test.mjs"]) {
        mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        writeFileSync(path.join(root, rel), guard);
      }
      execFileSync("git", ["init", "-q"], { cwd: root });
      expect(offenders(root)).toEqual([
        "scripts/check-x.mjs:1: if (import.meta.url === `file://${process.argv[1]}`) main();",
        "server/mcp/scripts/gen.ts:1: if (import.meta.url === `file://${process.argv[1]}`) main();",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
