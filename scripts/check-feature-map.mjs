#!/usr/bin/env node
/**
 * Feature-map gate — the feature ledger cannot silently fall behind the code.
 *
 * Three checks, strongest first:
 *   1. SPINE: `scripts/feature-map.json` is valid — every path exists and holds
 *      code (or is declared data), every doc page exists, every flag default
 *      matches `defaults.ts`. This is the generator's own validation
 *      (`spineErrors`), which used to run only when someone regenerated the
 *      metrics by hand, so the spine could be stale for weeks.
 *   2. OWNERSHIP: every production source file (`src/`, `src-tauri/src/`,
 *      `server/<pkg>/src/`, tests excluded) has exactly one owner — a feature or
 *      the declared infrastructure bucket — resolved by most specific claim. A
 *      new module that joins no feature fails here, at PR time. Zero-tolerance,
 *      no baseline: on adoption every file was assigned.
 *   3. LEDGER (`.claude/feature-ledger.md`, tracked, REQUIRED): every block
 *      names a spine feature, every spine feature has a block, every path a
 *      block cites in `code`/`docs`/`tests` exists, and every area records the
 *      commit it was verified against. It lived in the gitignored `dev-docs/`
 *      until 2026-09-27, where CI could not see it; a missing ledger now fails. The first ledger was accurate on 2026-09-07 and
 *      nineteen releases stale by 2026-09-27, with no signal.
 *
 * Usage: node scripts/check-feature-map.mjs [--root=<dir>]
 *   exit 0 clean, 1 findings, 64 bad invocation, 66 unreadable input.
 *
 * @coordinates-with scripts/lib/featureOwnership.mjs — ownership resolution
 * @coordinates-with scripts/lib/featureLedgerDoc.mjs — ledger parsing and joins
 * @coordinates-with scripts/gen-feature-ledger.mjs — the spine validation reused here
 * @coordinates-with scripts/check-feature-map.test.mjs — the self-test
 * @module scripts/check-feature-map
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { spineErrors } from "./gen-feature-ledger.mjs";
import { claimErrors, isCodeFile, ownershipUniverse, resolveOwners } from "./lib/featureOwnership.mjs";
import { LEDGER_REL, ledgerErrors, parseLedger } from "./lib/featureLedgerDoc.mjs";

const SPINE_REL = "scripts/feature-map.json";
const DEFAULTS_REL = "src/stores/settingsStore/defaults.ts";

function parseArgs(argv) {
  let root = process.cwd();
  for (const a of argv) {
    if (a.startsWith("--root=")) root = path.resolve(a.slice("--root=".length));
    else {
      console.error(`unknown argument: ${a}\nusage: node scripts/check-feature-map.mjs [--root=<dir>]`);
      process.exit(64);
    }
  }
  return { root };
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  let spine;
  try {
    spine = JSON.parse(readFileSync(path.join(root, SPINE_REL), "utf8"));
  } catch (err) {
    console.error(`${SPINE_REL}: unreadable — ${err.message}`);
    process.exit(66);
  }
  // Tracked plus untracked-not-ignored: a new file must fail before it is committed.
  const files = git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
    .split("\0").filter((f) => f !== "" && existsSync(path.join(root, f)));
  const codeFiles = files.filter(isCodeFile);

  const defaultsPath = path.join(root, DEFAULTS_REL);
  const errors = [
    ...spineErrors(root, spine, existsSync(defaultsPath) ? readFileSync(defaultsPath, "utf8") : null),
    ...claimErrors(spine, codeFiles),
  ];
  const universe = ownershipUniverse(files);
  const { unowned } = resolveOwners(spine, universe);
  for (const f of unowned) errors.push(`${f} is owned by no feature — add it to a feature's paths in ${SPINE_REL}, or to infrastructure.paths`);

  const ledgerPath = path.join(root, LEDGER_REL);
  let ledgerNote = "";
  if (!existsSync(ledgerPath)) {
    errors.push(`${LEDGER_REL} is missing — the ledger is tracked and required`);
  } else {
    const doc = parseLedger(readFileSync(ledgerPath, "utf8"));
    const shaExists = (sha) => {
      try { git("cat-file", "-e", `${sha}^{commit}`); return true; } catch { return false; }
    };
    errors.push(...ledgerErrors(doc, spine, { exists: (p) => existsSync(path.join(root, p)), shaExists }));
    ledgerNote = `ledger: ${doc.blocks.length} blocks in ${doc.areas.length} areas joined to ${spine.features.length} features`;
  }

  if (errors.length) {
    console.error(`Feature map: ${errors.length} finding${errors.length === 1 ? "" : "s"}\n`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`✓ feature map: ${universe.length} production files, each with one owner`);
  console.log(`  ${ledgerNote}`);
}

main();
