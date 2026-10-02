/**
 * Purpose: read, compare and report the mock-boundary identity baseline — two
 * lists of (test file, mocking API, resolved target) triples: `entries` for
 * store mocks and `siblingEntries` for same-feature mocks of the app's own
 * logic. Identity, never counts: a count permits a like-for-like swap.
 *
 * Both lists ratchet two ways: an unlisted mock fails, and a listed mock that
 * no longer exists fails until its entry is deleted. Malformed data fails
 * closed — a half-read baseline must never read as "no entries".
 *
 * @coordinates-with scripts/check-mock-boundaries.mjs — the gate's CLI
 * @coordinates-with scripts/mock-boundaries-baseline.json — the data
 * @coordinates-with scripts/baselineRatchetManifest.mjs — both lists are merge-base ratcheted
 * @module scripts/lib/mockBoundaries/baseline
 */

function assertTriples(list, label, field) {
  for (const e of list) {
    if (typeof e?.file !== "string" || typeof e?.api !== "string" || typeof e?.target !== "string") {
      throw new Error(`${label}: malformed ${field} entry ${JSON.stringify(e)}`);
    }
  }
}

/** The store-mock list. Fail loudly on malformed data (fail closed). */
export function validateBaseline(raw, label) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${label}: expected a JSON object with an "entries" array`);
  }
  if (!Array.isArray(raw.entries)) {
    throw new Error(`${label}: "entries" must be an array of {file, api, target}`);
  }
  assertTriples(raw.entries, label, "entries");
  return raw.entries;
}

/**
 * The sibling-mock list. Absent reads as empty — the strict direction: every
 * sibling mock then fails as unlisted, so absence can hide nothing. Present
 * but malformed fails closed.
 */
export function validateSiblingEntries(raw, label) {
  if (raw.siblingEntries === undefined) return [];
  if (!Array.isArray(raw.siblingEntries)) {
    throw new Error(`${label}: "siblingEntries" must be an array of {file, api, target}`);
  }
  assertTriples(raw.siblingEntries, label, "siblingEntries");
  return raw.siblingEntries;
}

const key = (e) => `${e.file} :: ${e.api} :: ${e.target}`;

/** Sort and de-duplicate triples by identity. */
export function sortTriples(triples) {
  const seen = new Map(triples.map((e) => [key(e), e]));
  return [...seen.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

/** Identity comparison — set difference in both directions. */
export function compareIdentities(actual, baseline) {
  const actualKeys = new Set(actual.map(key));
  const baseKeys = new Set(baseline.map(key));
  return {
    added: actual.filter((e) => !baseKeys.has(key(e))),
    removed: baseline.filter((e) => !actualKeys.has(key(e))),
  };
}

const STORE_ADVICE =
  "   Tests mock boundaries, not app state. Use the real store (setState/reset\n" +
  "   in beforeEach) or an explicit store-factory seam with a recorded reason.\n" +
  "   The baseline ratchets DOWN only — never add an entry to pass.";
const SIBLING_ADVICE =
  "   A relative mock of a module that is the app's own logic tests a fake, not\n" +
  "   the code. Import the real sibling. Mock a module only when it wraps a real\n" +
  "   boundary (it imports @tauri-apps/* or a Node builtin itself) — or mock that\n" +
  "   boundary directly. The list ratchets DOWN only — never add an entry to pass.";

/**
 * Print one list's differences to stderr. `noun` names the kind ("store mock",
 * "sibling logic mock"), `field` the baseline key. Returns whether it failed.
 */
export function reportDiff({ added, removed }, noun, field) {
  if (added.length > 0) {
    console.error(`\n❌ ${added.length} test-side ${noun}(s) NOT in the identity baseline (${field}):\n`);
    for (const e of added) console.error(`   ${e.file} — ${e.api} → ${e.target}`);
    console.error(`\n${field === "entries" ? STORE_ADVICE : SIBLING_ADVICE}`);
  }
  if (removed.length > 0) {
    console.error(`\n❌ ${removed.length} baselined ${noun}(s) no longer exist — record the win:\n`);
    for (const e of removed) console.error(`   ${e.file} — ${e.api} → ${e.target}`);
    console.error(
      `\n   Delete these entries from "${field}" in scripts/mock-boundaries-baseline.json so the\n` +
        "   improvement cannot silently become headroom for the next regression.",
    );
  }
  return added.length > 0 || removed.length > 0;
}
