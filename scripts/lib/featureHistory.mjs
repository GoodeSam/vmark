/**
 * Per-feature history — which commits touched which feature, read from ONE
 * `git log` of the whole repository.
 *
 * Purpose: churn, last touch and ledger freshness used to ask git about the
 * files a feature holds TODAY (`git log -- <current files>`). A file the
 * feature deleted, and everything a file did before it was renamed into the
 * feature, were invisible to all three, so a feature that shed code looked
 * quieter than it was. Here every path a commit touched is read under the
 * name it has now — walking newest-first, a rename maps its old path to the
 * new one's current name — and then owned by the spine's claims. A deleted
 * path keeps its own name, which the claims still cover.
 *
 * Merge commits list no paths and count for nothing, as `git log -- <paths>`
 * history simplification already made them.
 *
 * @coordinates-with scripts/gen-feature-ledger.mjs — the Commits, Last touch and freshness columns
 * @coordinates-with scripts/lib/featureOwnership.mjs — claims decide which feature a path belongs to
 * @module scripts/lib/featureHistory
 */
import { resolveOwners } from "./featureOwnership.mjs";

const RS = "\u001e";
const US = "\u001f";
/** A `--name-status` status letter, with the similarity score renames and copies carry. */
const STATUS_RE = /^[ACDMRTUXB]\d*$/;

/** The `git log` arguments `parseNameStatusLog` reads: NUL-delimited, so any filename survives. */
export const LOG_ARGS = ["log", "-z", "--name-status", `--format=${RS}%H${US}%ad`, "--date=short"];

/**
 * `git log …LOG_ARGS` output → `[{ hash, date, changes: [{ status, paths }] }]`,
 * newest first. A rename or copy carries `[from, to]`. An unrecognised status
 * THROWS: guessing where one record ends would misattribute every path after it.
 */
export function parseNameStatusLog(out) {
  const commits = [];
  for (const chunk of out.split(RS)) {
    if (chunk === "") continue;
    const nul = chunk.indexOf("\0");
    const [hash, date] = (nul === -1 ? chunk : chunk.slice(0, nul)).split(US);
    const tokens = (nul === -1 ? "" : chunk.slice(nul + 1).replace(/^\n/, "")).split("\0");
    if (tokens.at(-1) === "") tokens.pop();
    const changes = [];
    for (let i = 0; i < tokens.length;) {
      const status = tokens[i];
      if (!STATUS_RE.test(status)) throw new Error(`git log: commit ${hash}: expected a name-status letter, got ${JSON.stringify(status)}`);
      const n = /^[RC]/.test(status) ? 2 : 1;
      changes.push({ status, paths: tokens.slice(i + 1, i + 1 + n) });
      i += 1 + n;
    }
    commits.push({ hash, date: date.trim(), changes });
  }
  return commits;
}

/**
 * Each commit's touched paths under their CURRENT names. A rename touches its
 * file (both names are one file); a copy touches only its destination.
 */
function currentNames(commits) {
  const renamedTo = new Map();
  const now = (p) => renamedTo.get(p) ?? p;
  return commits.map((c) => {
    const names = new Set();
    for (const { status, paths } of c.changes) {
      if (status.startsWith("R")) {
        const [from, to] = paths;
        names.add(now(to));
        renamedTo.set(from, now(to));
      } else {
        names.add(now(paths.at(-1)));
      }
    }
    return { hash: c.hash, date: c.date, names };
  });
}

/**
 * `feature name → [{ hash, date }]`, newest first: every commit that touched a
 * path the spine gives that feature. Infrastructure and unowned paths belong
 * to no feature.
 */
export function touchesByFeature(commits, spine) {
  const named = currentNames(commits);
  const { owner } = resolveOwners(spine, [...new Set(named.flatMap((c) => [...c.names]))]);
  const features = new Set(spine.features.map((f) => f.name));
  const out = new Map();
  for (const c of named) {
    const touched = new Set([...c.names].map((p) => owner.get(p)).filter((o) => features.has(o)));
    for (const name of touched) {
      if (!out.has(name)) out.set(name, []);
      out.get(name).push({ hash: c.hash, date: c.date });
    }
  }
  return out;
}
