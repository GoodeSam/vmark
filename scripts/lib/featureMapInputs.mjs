/**
 * The repository inputs the feature-map gate and the metrics generator both
 * read: the file list and the probes the ledger rules are answered with.
 *
 * Purpose: the two scripts used to enumerate the tree and ask git about the
 * ledger's commits each in their own way, so the generator rendered a ledger
 * the gate would have refused. One definition means they judge the same tree
 * by the same rules.
 *
 * @coordinates-with scripts/check-feature-map.mjs — the gate
 * @coordinates-with scripts/gen-feature-ledger.mjs — the generator
 * @coordinates-with scripts/lib/featureLedgerDoc.mjs — `ledgerErrors`, which takes these probes
 * @module scripts/lib/featureMapInputs
 */
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { globToRegExp } from "./featureLedgerDoc.mjs";

/** `git` in `root`; a failure THROWS (stderr captured, never echoed over the caller's report). */
export const gitIn = (root) => (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

/** Tracked plus untracked-not-ignored files that exist on disk: a new file must be seen before it is committed. */
export function repoFiles(root, git) {
  return git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
    .split("\0").filter((f) => f !== "" && existsSync(path.join(root, f)));
}

/** The probes `ledgerErrors` takes, answered against one tree (`files`) and its history. */
export function ledgerProbes(root, git, files) {
  const succeeds = (...args) => {
    try {
      git(...args);
      return true;
    } catch {
      return false;
    }
  };
  return {
    exists: (p) => existsSync(path.join(root, p)),
    globMatches: (glob) => {
      const re = globToRegExp(glob);
      return files.some((f) => re.test(f));
    },
    shaExists: (sha) => succeeds("cat-file", "-e", `${sha}^{commit}`),
    isAncestor: (sha) => succeeds("merge-base", "--is-ancestor", sha, "HEAD"),
  };
}
