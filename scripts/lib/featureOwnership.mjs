/**
 * Feature ownership — which ONE spine entry owns each source file.
 *
 * Purpose: the feature map (`scripts/feature-map.json`) names features by the
 * paths they occupy. Two questions were never asked of it: does every
 * production file belong to something, and does any file belong to two
 * things? The first let new modules land outside every feature, so the ledger
 * could not see them. The second counted 90 files twice in the metrics.
 *
 * Key decisions:
 *   - The MOST SPECIFIC claim wins. A folder claim plus a file claim inside it
 *     is the normal way to carve a sub-feature out of a directory, so it must
 *     resolve, not fail. Only the SAME path claimed twice is ambiguous.
 *   - Infrastructure is DECLARED (`infrastructure.paths`), never inferred from
 *     absence. The granularity rule keeps shared plumbing out of the feature
 *     rows, but "not a feature" and "nobody looked" must stay distinguishable.
 *   - A claim that owns no code file at all is stale: either its files moved,
 *     or more specific claims took every one of them.
 *
 * @coordinates-with scripts/check-feature-map.mjs — the gate over this module
 * @coordinates-with scripts/gen-feature-ledger.mjs — measures each feature over the files it owns
 * @module scripts/lib/featureOwnership
 */
import path from "node:path";

export const INFRASTRUCTURE = "infrastructure";
const CODE_RE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|rs)$/;
const ROOTS_RE = /^(?:src\/|src-tauri\/src\/|server\/[^/]+\/src\/)/;

/** Tests, test infrastructure and benchmarks — measured as tests, never owned as production code. */
export const isTestFile = (f) => /\.test\.|\.spec\.|__tests__|\/test\/|\.bench\.|^src\/bench\//.test(f);
export const isCodeFile = (f) => CODE_RE.test(f);

/** The files that must each have an owner: production code under the app, Rust and server source roots. */
export function ownershipUniverse(files) {
  return files.filter((f) => ROOTS_RE.test(f) && isCodeFile(f) && !isTestFile(f));
}

const norm = (p) => path.posix.normalize(p).replace(/^(\.\/)+/, "").replace(/\/+$/, "");
const inside = (file, claim) => file === claim || file.startsWith(`${claim}/`);

/** Every (path, owner) claim in the spine, normalised. */
function claims(spine) {
  const out = [];
  for (const f of spine.features ?? []) for (const p of f.paths ?? []) if (typeof p === "string") out.push({ path: norm(p), owner: f.name });
  for (const p of spine.infrastructure?.paths ?? []) if (typeof p === "string") out.push({ path: norm(p), owner: INFRASTRUCTURE });
  return out;
}

/** Owner of each file by longest matching claim; files no claim covers are `unowned`. */
export function resolveOwners(spine, files) {
  const all = claims(spine).sort((a, b) => b.path.length - a.path.length);
  const owner = new Map();
  const unowned = [];
  for (const f of files) {
    const hit = all.find((c) => inside(f, c.path));
    if (hit) owner.set(f, hit.owner);
    else unowned.push(f);
  }
  return { owner, unowned };
}

/**
 * Problems with the claims themselves, independent of coverage.
 * `codeFiles` is every code file in the tree, tests included, so a claim over
 * a test directory still counts as owning something.
 */
export function claimErrors(spine, codeFiles) {
  const errors = [];
  const infra = spine.infrastructure;
  if (!infra || !Array.isArray(infra.paths) || infra.paths.length === 0) {
    errors.push("feature-map.json: `infrastructure.paths` must be a non-empty array — shared plumbing is declared, not inferred from absence");
  }
  const byPath = new Map();
  for (const c of claims(spine)) {
    const prev = byPath.get(c.path);
    if (prev && prev !== c.owner) errors.push(`${c.path} is claimed by both "${prev}" and "${c.owner}" — give it one owner`);
    byPath.set(c.path, prev ?? c.owner);
  }
  const { owner } = resolveOwners(spine, codeFiles);
  const winners = new Set();
  for (const f of codeFiles) {
    const o = owner.get(f);
    if (!o) continue;
    const best = claims(spine).filter((c) => c.owner === o && inside(f, c.path)).sort((a, b) => b.path.length - a.path.length)[0];
    winners.add(`${o}\u0000${best.path}`);
  }
  for (const f of spine.features ?? []) {
    const dataOnly = new Set((f.dataOnly ?? []).map(norm));
    for (const p of (f.paths ?? []).map(norm)) {
      if (dataOnly.has(p)) continue;
      if (!winners.has(`${f.name}\u0000${p}`)) errors.push(`"${f.name}": claim ${p} owns no code file — its files moved, or more specific claims took all of them`);
    }
  }
  for (const p of (infra?.paths ?? []).map(norm)) {
    if (!winners.has(`${INFRASTRUCTURE}\u0000${p}`)) errors.push(`"${INFRASTRUCTURE}": claim ${p} owns no code file`);
  }
  return errors;
}
