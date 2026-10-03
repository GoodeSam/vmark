#!/usr/bin/env node
/**
 * Provenance-id gate — a production comment that cites a work item or an
 * audit must cite one a fresh clone can find.
 *
 * Comments in `src/`, `src-tauri/src/`, `server/` and `e2e/` used to carry
 * about two thousand `WI-x.y` ids and several hundred audit citations, most of
 * them pointing into maintainer-local plans that no clone has — and some of
 * them, read against the tracked plans, pointing at an unrelated item that
 * shares the number. The reason a line exists has to be readable without a
 * lookup that may fail, so the comment states the behavioural reason and the
 * id goes, unless it resolves (the rules are in `scripts/lib/provenanceIds.mjs`).
 *
 * Offline and deterministic: the verdict depends on the checkout alone (tracked
 * plans under `.claude/tdd-guardian/` and `.claude/adr/plans/`, audit records
 * under `.cc-suite/audits/` and `.claude/tdd-guardian/`), never on the network
 * or on how much history was cloned. Issue numbers are not checked. There is
 * no baseline: the tree carries zero findings.
 *
 * Usage: node scripts/check-provenance-ids.mjs [--report] [--root=<dir>]
 *   exit 0  every WI and audit token in a production comment resolves
 *   exit 1  at least one does not (each is listed with its reason)
 *   exit 64 bad invocation
 *
 * @coordinates-with scripts/lib/provenanceIds.mjs — the token grammar and resolution rules
 * @coordinates-with scripts/lib/sourceComments.mjs — reads every comment of a file
 * @coordinates-with scripts/check-provenance-ids.test.mjs — the self-test
 * @coordinates-with .claude/rules/22-comment-maintenance.md — the rule this enforces
 * @module scripts/check-provenance-ids
 */
import { statSync } from "node:fs";
import path from "node:path";

import { isMainModule } from "./lib/isMainModule.mjs";
import { scanTree } from "./lib/provenanceIds.mjs";

const USAGE = "Usage: node scripts/check-provenance-ids.mjs [--report] [--root=<dir>]";

/** Parse argv; throws on an unknown flag or a `--root` that is not a directory. */
export function parseArgs(argv, defaultRoot) {
  const opts = { report: false, root: defaultRoot };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let raw = null;
    if (a === "--report") opts.report = true;
    else if (a.startsWith("--root=")) raw = a.slice("--root=".length);
    else if (a === "--root" && i + 1 < argv.length) raw = argv[++i];
    else throw new Error(`unknown argument ${JSON.stringify(a)}\n${USAGE}`);
    if (raw !== null) {
      // An empty --root would resolve to the CWD and silently scan the wrong tree.
      if (raw.trim() === "") throw new Error(`--root needs a directory path\n${USAGE}`);
      opts.root = path.resolve(raw);
    }
  }
  if (!statSync(opts.root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--root is not a directory: ${opts.root}\n${USAGE}`);
  }
  return opts;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2), path.resolve(import.meta.dirname, ".."));
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(64);
  }
  let tokens;
  try {
    tokens = scanTree(opts.root);
  } catch (error) {
    console.error(`❌ Cannot scan production comments under ${opts.root}: ${error.message}`);
    process.exit(1);
  }
  const checked = tokens.filter((t) => t.kind !== "issue");
  const findings = checked.filter((t) => t.reason);
  if (opts.report) {
    for (const t of tokens) console.log(`${t.reason ? "DANGLING" : "resolves"}  ${t.kind.padEnd(5)}  ${t.file}:${t.line}  ${t.token}${t.reason ? ` — ${t.reason}` : ""}`);
  }
  const files = new Set(checked.map((t) => t.file)).size;
  if (findings.length === 0) {
    console.log(`✅ Provenance ids: ${checked.length} WI/audit token(s) in ${files} production file(s), all resolve.`);
    return;
  }
  console.error(`\n❌ ${findings.length} provenance id(s) in production comments do not resolve:\n`);
  for (const f of findings) console.error(`   ${f.file}:${f.line}  ${f.token}\n       ${f.reason}`);
  console.error(
    "\n   State the behavioural reason in the comment and drop the id (rule 22). A WI id\n" +
      "   may stay only when a tracked plan defines it; an audit citation only with the\n" +
      "   date of a tracked audit record. Plans in dev-docs/ do not count: a clone cannot read them.\n",
  );
  process.exit(1);
}

if (isMainModule(import.meta.url)) main();
