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
 *   - A claim over a whole source root is refused, and the name
 *     `infrastructure` is reserved: either one makes single ownership true by
 *     construction rather than by inspection.
 *   - A malformed spine is reported as findings, never thrown — the gate's
 *     output is the list of what to fix, not a stack trace.
 *
 * @coordinates-with scripts/check-feature-map.mjs — the gate over this module
 * @coordinates-with scripts/gen-feature-ledger.mjs — measures each feature over the files it owns
 * @module scripts/lib/featureOwnership
 */
import path from "node:path";

export const INFRASTRUCTURE = "infrastructure";
/**
 * Every extension that is CODE — the one list. `scripts/gen-feature-ledger.mjs`
 * enumerates and measures through it too; two copies of it had to agree for
 * the ownership and the inventory to describe one population, and nothing
 * checked that they did.
 */
export const CODE_EXTENSIONS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "rs"];
const CODE_RE = new RegExp(`\\.(?:${CODE_EXTENSIONS.join("|")})$`);
const ROOTS_RE = /^(?:src\/|src-tauri\/src\/|server\/[^/]+\/src\/)/;
/**
 * A claim that covers a whole source root (or the repository) owns every file
 * nobody else claims — including the next new module — so "every file has an
 * owner" holds by construction and the gate proves nothing. `server/<pkg>` is
 * NOT one: a sidecar package is a legitimate single feature, and a new package
 * lands as a new directory that no existing claim covers.
 */
const CATCH_ALL_RE = /^(?:\.?|src|src-tauri|src-tauri\/src|server)$/;

/**
 * Tests, test infrastructure and benchmarks — measured as tests, never owned as
 * production code. Rust names its test modules by convention rather than by a
 * `.test.` infix — `mod tests;` loads `tests.rs`, `#[path]` mounts
 * `migration_v5_tests.rs`, and `src-tauri/tests/` holds integration tests — and
 * six such files were counted as production until they were named here.
 */
export const isTestFile = (f) =>
  /\.test\.|\.spec\.|__tests__|\/test\/|\.bench\.|^src\/bench\//.test(f) || /(?:^|\/)tests?\.rs$|_tests?\.rs$|(?:^|\/)tests\/[^/]+\.rs$/.test(f);
export const isCodeFile = (f) => CODE_RE.test(f);

/** The files that must each have an owner: production code under the app, Rust and server source roots. */
export function ownershipUniverse(files) {
  return files.filter((f) => ROOTS_RE.test(f) && isCodeFile(f) && !isTestFile(f));
}

const norm = (p) => path.posix.normalize(p).replace(/^(\.\/)+/, "").replace(/\/+$/, "");
const inside = (file, claim) => file === claim || file.startsWith(`${claim}/`);
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? v.filter((p) => typeof p === "string") : []);

/** Every (path, owner) claim in the spine, normalised. Malformed parts contribute nothing; `claimErrors` names them. */
function claims(spine) {
  const out = [];
  if (!isObject(spine)) return out;
  for (const f of Array.isArray(spine.features) ? spine.features : []) {
    if (isObject(f)) for (const p of strings(f.paths)) out.push({ path: norm(p), owner: f.name });
  }
  for (const p of strings(spine.infrastructure?.paths)) out.push({ path: norm(p), owner: INFRASTRUCTURE });
  return out;
}

/**
 * Owner of each file by longest matching claim; files no claim covers are
 * `unowned`. `claim` maps each owned file to the claim path that won it, so no
 * caller has to repeat the matching to learn which claim that was.
 */
export function resolveOwners(spine, files) {
  const all = claims(spine).sort((a, b) => b.path.length - a.path.length);
  const owner = new Map();
  const claim = new Map();
  const unowned = [];
  for (const f of files) {
    const hit = all.find((c) => inside(f, c.path));
    if (hit) { owner.set(f, hit.owner); claim.set(f, hit.path); }
    else unowned.push(f);
  }
  return { owner, claim, unowned };
}

/**
 * Structural problems: a spine in which some claim cannot even be READ. These
 * are returned before anything is resolved, because every later rule would be
 * reasoning about a guess (and used to throw a TypeError instead).
 */
function shapeErrors(spine) {
  if (!isObject(spine)) return ["feature-map.json: expected an object with `features` and `infrastructure`"];
  if (!Array.isArray(spine.features)) return ["feature-map.json: expected a `features` array"];
  const errors = [];
  if (strings(spine.infrastructure?.paths).length !== (spine.infrastructure?.paths?.length ?? 0)) {
    errors.push("feature-map.json: every `infrastructure.paths` entry must be a string");
  }
  spine.features.forEach((f, i) => {
    if (!isObject(f)) return errors.push(`feature-map.json: features[${i}] is not an object`);
    const who = typeof f.name === "string" ? `"${f.name}"` : `features[${i}]`;
    if (!Array.isArray(f.paths) || f.paths.some((p) => typeof p !== "string")) errors.push(`${who}: \`paths\` must be an array of strings`);
    if (f.dataOnly !== undefined && (!Array.isArray(f.dataOnly) || f.dataOnly.some((p) => typeof p !== "string"))) errors.push(`${who}: \`dataOnly\` must be an array of strings`);
  });
  return errors;
}

/**
 * Problems with the claims themselves, independent of coverage.
 * `codeFiles` is every code file in the tree, tests included, so a claim over
 * a test directory still counts as owning something.
 */
export function claimErrors(spine, codeFiles) {
  const shape = shapeErrors(spine);
  if (shape.length) return shape;
  const errors = [];
  const infra = spine.infrastructure;
  if (!isObject(infra) || !Array.isArray(infra.paths) || infra.paths.length === 0) {
    errors.push("feature-map.json: `infrastructure.paths` must be a non-empty array — shared plumbing is declared, not inferred from absence");
  }
  for (const f of spine.features) {
    if (f.name === INFRASTRUCTURE) errors.push(`"${f.name}": the name "${INFRASTRUCTURE}" is reserved for infrastructure.paths — a feature under it would share that owner's identity`);
  }
  const byPath = new Map();
  for (const c of claims(spine)) {
    const prev = byPath.get(c.path);
    if (prev && prev !== c.owner) errors.push(`${c.path} is claimed by both "${prev}" and "${c.owner}" — give it one owner`);
    byPath.set(c.path, prev ?? c.owner);
    if (CATCH_ALL_RE.test(c.path)) errors.push(`"${c.owner}": claims a whole source root -> ${c.path || "."} — it would own every file nobody else claims, including the next new module, so ownership would hold by construction`);
  }
  const { owner, claim } = resolveOwners(spine, codeFiles);
  const winners = new Set([...claim].map(([f, p]) => `${owner.get(f)}\u0000${p}`));
  for (const f of spine.features) {
    const dataOnly = new Set((f.dataOnly ?? []).map(norm));
    for (const p of f.paths.map(norm)) {
      if (dataOnly.has(p)) continue;
      if (!winners.has(`${f.name}\u0000${p}`)) errors.push(`"${f.name}": claim ${p} owns no code file — its files moved, or more specific claims took all of them`);
    }
  }
  for (const p of strings(infra?.paths).map(norm)) {
    if (!winners.has(`${INFRASTRUCTURE}\u0000${p}`)) errors.push(`"${INFRASTRUCTURE}": claim ${p} owns no code file`);
  }
  return errors;
}
