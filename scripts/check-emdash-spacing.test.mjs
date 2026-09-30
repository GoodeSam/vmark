/**
 * Em-dash spacing gate — which files it reads.
 *
 * The gate walked the filesystem, so a gitignored local file (a
 * `.cc-suite/audits/` findings file, a scratch note) failed a check that is
 * about the repository. It now enumerates what git would publish: tracked
 * files plus untracked-but-not-ignored ones, the same population
 * `check-no-nul-bytes.mjs` reads.
 */
import { describe, it, expect } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-emdash-spacing.mjs");
const BAD = "A word—word join.\n";
const GOOD = "A word — word join.\n";

function repo(tracked, { untracked = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "emdash-"));
  const put = (rel, body) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  };
  for (const [rel, body] of Object.entries(tracked)) put(rel, body);
  const git = (...a) => execFileSync("git", ["-c", "user.email=g@example.test", "-c", "user.name=G", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "base");
  for (const [rel, body] of Object.entries(untracked)) put(rel, body);
  return dir;
}
const run = (dir) => spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });

describe("check-emdash-spacing — the files it reads", () => {
  it("fails on a tracked markdown file with an unspaced em-dash", () => {
    const res = run(repo({ "docs/a.md": BAD }));
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/docs\/a\.md:1/);
  });

  it("fails on an untracked, not-ignored file — it is about to be committed", () => {
    const res = run(repo({ "a.md": GOOD }, { untracked: { "new.md": BAD } }));
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/new\.md:1/);
  });

  it("does not read a gitignored file — it is not part of the repository", () => {
    const dir = repo({ ".gitignore": ".cc-suite/\n", "a.md": GOOD }, { untracked: { ".cc-suite/audits/x.md": BAD } });
    const res = run(dir);
    expect(res.stdout + res.stderr).not.toMatch(/\.cc-suite/);
    expect(res.status).toBe(0);
  });

  it("still skips the directories it always skipped, even when tracked", () => {
    const res = run(repo({ "website/.vitepress/cache/x.md": BAD, "dev-docs/y.md": BAD, "CHANGELOG.md": BAD, "a.md": GOOD }));
    expect(res.status).toBe(0);
  });
});
