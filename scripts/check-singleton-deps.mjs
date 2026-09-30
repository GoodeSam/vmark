#!/usr/bin/env node
/**
 * check-singleton-deps.mjs — packages whose objects cross package boundaries
 * resolve to exactly ONE version.
 *
 * Purpose: a Dependabot minor/patch group left `@lezer/common` at 1.5.2 under
 * `@codemirror/language` and 1.5.3 under `@lezer/highlight`, `@lezer/lr` and
 * every `@lezer/*` grammar. Each copy numbers its NodeProps from its own
 * counter, so a prop id minted by one collides with a prop id minted by the
 * other: the highlighter read the wrong prop as its style rule and threw
 * "tags is not iterable". CodeMirror catches a plugin's throw and logs it, so
 * every Source pane — markdown included — lost its syntax colours while every
 * test, typecheck and build stayed green. Two copies of a package like this
 * are never a style issue; they are two type systems that believe they are one.
 *
 * Reads `pnpm-lock.yaml`'s `packages:` section (what `pnpm install` actually
 * resolves) and fails when a listed package has more than one version. A
 * listed package absent from the lockfile also fails — a rename or a parser
 * slip must not turn the gate into a silent pass.
 *
 * Fix a finding by deduplicating, not by removing the package from the list:
 * `pnpm dedupe` when its churn is acceptable, otherwise a `pnpm.overrides`
 * floor (`">=x.y.z <next-major"`) in package.json.
 *
 * @coordinates-with package.json — `lint:singleton-deps`, in `check:static`
 * @coordinates-with src/plugins/codemirror/theme.highlight.test.ts — the runtime symptom
 */
import { readFileSync } from "node:fs";
import { isMainModule } from "./lib/isMainModule.mjs";

/**
 * Shared-identity cores: their classes, props, facets or keys are created in
 * one package and read in another, so two copies silently disagree. Leaf
 * packages (a grammar, a private zustand inside a dependency) may duplicate.
 */
export const SINGLETONS = [
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/language",
  "prosemirror-model",
  "prosemirror-state",
  "prosemirror-view",
  "prosemirror-transform",
  "@tiptap/core",
  "@tiptap/pm",
  "react",
  "react-dom",
];

/** name -> Set of versions resolved in the lockfile's `packages:` section. */
export function lockedVersions(lockText) {
  const start = lockText.search(/^packages:\n/m);
  if (start === -1) throw new Error("pnpm-lock.yaml has no packages: section");
  const end = lockText.indexOf("\nsnapshots:\n", start);
  const section = lockText.slice(start, end === -1 ? undefined : end);
  const versions = new Map();
  for (const m of section.matchAll(/^ {2}'?((?:@[^@\s'/]+\/)?[^@\s'/]+)@([^('\s:]+)/gm)) {
    if (!versions.has(m[1])) versions.set(m[1], new Set());
    versions.get(m[1]).add(m[2]);
  }
  return versions;
}

/** One message per listed package that is missing or resolved more than once. */
export function singletonFindings(versions, singletons = SINGLETONS) {
  const out = [];
  for (const name of singletons) {
    const found = versions.get(name);
    if (!found) {
      out.push(`${name} is not in the lockfile — remove it from SINGLETONS or fix the parser`);
    } else if (found.size > 1) {
      out.push(`${name} resolves to ${found.size} versions: ${[...found].sort().join(", ")}`);
    }
  }
  return out;
}

if (isMainModule(import.meta.url)) {
  const findings = singletonFindings(lockedVersions(readFileSync("pnpm-lock.yaml", "utf8")));
  if (findings.length > 0) {
    console.error("❌ Shared-identity packages must resolve to ONE version (scripts/check-singleton-deps.mjs):\n");
    for (const f of findings) console.error(`  • ${f}`);
    console.error("\n  Deduplicate: `pnpm dedupe`, or a pnpm.overrides floor in package.json.");
    process.exit(1);
  }
  console.log(`✅ Singleton deps: ${SINGLETONS.length} shared-identity packages, one version each.`);
}
