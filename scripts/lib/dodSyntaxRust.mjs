/**
 * Purpose: the Rust probes behind `scripts/dod-syntax.mjs` — whether a module
 *   ACTIVELY includes a test file through `#[path]`, and whether a file's CODE
 *   (comments always, literals optionally, blanked) matches a pattern.
 *
 * Rust has no parser in this toolchain, so these run over
 * scripts/lib/rustSource.mjs's blanked source: what a regex sees there is code.
 *
 * @coordinates-with scripts/dod-syntax.mjs — the CLI these answer for
 * @coordinates-with scripts/lib/rustSource.mjs — the Rust comment/literal lexer
 * @module scripts/lib/dodSyntaxRust
 */
import { rustCode } from "./rustSource.mjs";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A `cfg` gate this probe cannot evaluate. `cfg(test)` is the one it can:
 * `cargo test` sets it, and a test module needs to compile in no other build.
 * Anything else — `cfg(any())` (the canonical "disable this"), a feature, a
 * target — makes the include CONDITIONAL, and a conditional include is not a
 * discovered test. Measured across all 222 `#[path = "*.test.rs"]` sites in
 * `src-tauri/src`: 221 carry exactly `#[cfg(test)]`, one carries no attribute
 * at all, and none carries any other `cfg` — so this refuses nothing that
 * ships today (audit 20260907 #26).
 */
function unevaluatableCfg(attrRun) {
  for (const m of attrRun.matchAll(/#\[([^\]]*)\]/g)) {
    const body = m[1].trim();
    if (!/^cfg(_attr)?\b/.test(body)) continue;
    if (body.replace(/\s+/g, "") !== "cfg(test)") return true;
  }
  return false;
}

/** The contiguous attribute run immediately before `index` — in Rust, attributes attached to the same item. */
const attrRunBefore = (code, index) => /(?:#\[[^\]]*\]\s*)*$/.exec(code.slice(0, index))[0];

/**
 * Does `moduleSource` include the test file `base` the way cargo compiles it:
 * an ACTIVE `#[path = "<base>"]` attribute, followed — other attributes only —
 * by the `mod x;` it decorates, with no `cfg` gate on the item this probe
 * cannot evaluate? The same grammar headerReferences.mjs reads for `@module`.
 * A commented-out attribute, or one with anything but another attribute
 * between it and a `mod`, includes nothing.
 *
 * The attribute must also be CODE. `keepStrings` is required here — the path
 * IS a string literal — which leaves a whole `#[path = "x.test.rs"] mod t;`
 * quoted inside a RAW string intact, and it matched (audit 20260907 #26; the
 * ordinary-string case only failed because `\"` breaks the regex, which is
 * luck, not a check). The fully-blanked source tells the two apart: a `#` that
 * survives literal blanking is code, one that does not was inside a literal.
 */
export function rustModIncludes(moduleSource, base) {
  const code = rustCode(moduleSource, { keepStrings: true });
  const bare = rustCode(moduleSource);
  const re = new RegExp(
    String.raw`#\[\s*path\s*=\s*"${escapeRe(base)}"\s*\]\s*((?:#\[[^\]]*\]\s*)*)(?:pub(?:\([^)]*\))?\s+)?mod\s+[A-Za-z_]\w*\s*;`,
    "g",
  );
  for (const m of code.matchAll(re)) {
    if (bare[m.index] !== "#") continue;
    if (unevaluatableCfg(attrRunBefore(code, m.index)) || unevaluatableCfg(m[1])) continue;
    return true;
  }
  return false;
}

/**
 * `re` without its STATEFUL flags (`g`, `y`).
 *
 * `RegExp.prototype.test` on a global or sticky regex advances `lastIndex` and
 * resumes from it on the next call, so ONE regex reused across a list of files
 * gives an answer that depends on where the previous file happened to match:
 * file 2 is tested from an offset file 1 left behind, and a real match is
 * missed. That is a silent FALSE NEGATIVE in a probe whose whole job is to
 * report a match, and both `rustCodeMatches` and the `ts-code-grep` filter did
 * it. Cloning is preferred to resetting `lastIndex` because the
 * caller's regex is not this function's to mutate.
 */
export function statelessRe(re) {
  const flags = re.flags.replace(/[gy]/g, "");
  return flags === re.flags ? re : new RegExp(re.source, flags);
}

/**
 * Does the CODE of `source` match `re`? Comments are always blanked; string
 * literals are blanked too unless `keepStrings`, which a probe whose SUBJECT
 * is a literal needs (`accel("save", …)`, `var("DBUS_SESSION_BUS_ADDRESS")`).
 */
export function rustCodeMatches(source, re, { keepStrings = false } = {}) {
  return statelessRe(re).test(rustCode(source, { keepStrings }));
}
