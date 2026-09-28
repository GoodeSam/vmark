/**
 * The qualitative feature ledger (`.claude/feature-ledger.md`) as data.
 *
 * Purpose: the ledger is hand-written, and a hand-written inventory rots the
 * way every unchecked document does — a block keeps citing a file that was
 * deleted, a feature ships that no block describes, a status tag drifts into a
 * word nobody defined. The first edition was accurate on the day it was built
 * and stale nineteen releases later, with nothing to say so. This module turns
 * the document into blocks so the gate can join them to the spine and to the
 * tree.
 *
 * Document grammar (the only structure it relies on):
 *   `## Area <n> — <title>` opens an area; the area must carry a line
 *   `Verified: \`<commit>\`` naming the commit its blocks were checked against.
 *   Every `### <title>` inside an area is a block: a list of `- <field>: <value>`
 *   lines. Prose before the first area (intro, method, findings) is free-form.
 *   Area numbers are unique; a field appears once per block.
 *
 * Cited paths (`code`, `rust`, `docs`, `tests`) are checked against the tree:
 * a plain path must exist, a glob must match a file, and neither may climb
 * with `..` — `src/../package.json` names a file, but not the one it reads as.
 *
 * @coordinates-with scripts/check-feature-map.mjs — the gate over this module
 * @coordinates-with scripts/gen-feature-ledger.mjs — renders the at-a-glance table from these blocks
 * @module scripts/lib/featureLedgerDoc
 */
import { INFRASTRUCTURE } from "./featureOwnership.mjs";

export const LEDGER_REL = ".claude/feature-ledger.md";
const REQUIRED_FIELDS = ["id", "feature", "summary", "capabilities", "status", "gate", "surfaces", "code", "rust", "docs", "tests", "notes"];
export const STATUS_TAGS = ["shipped-on", "shipped-off", "partial", "unwired", "dev-only", "macos-only", "windows-linux-gap", "deprecated"];
/** Fields whose backticked repo paths must exist. Prose fields may mention history. */
const CITING_FIELDS = ["code", "rust", "docs", "tests"];
const PATH_ROOT_RE = /^(?:src|src-tauri|server|website|e2e|scripts|\.github|\.claude|patches)\//;
/**
 * A file at the repository ROOT, recognised by its shape. A bare `defaults.ts`
 * in a block is a module named in passing, not a root citation, so a root file
 * is admitted only in the forms the root actually holds — which kept
 * `README.md`, `vitest.gates.config.ts` and `vitest.browser.config.ts` from
 * being skipped unchecked while leaving the 78 bare basenames alone.
 */
const ROOT_FILE_RE = /^(?:[A-Z][A-Z0-9_-]*\.md|LICENSE|package\.json|pnpm-(?:lock|workspace)\.yaml|tsconfig(?:\.[\w-]+)?\.json|(?:vite|vitest|eslint|knip|stryker)(?:\.[\w-]+)*\.(?:ts|js|mjs|cjs|json)|index\.html)$/;
const GLOB_RE = /[*?[]/;

/** The status field as tags — ONE rule, shared by validation and rendering. */
export const statusTags = (value) => (value ?? "").split(",").map((t) => t.trim()).filter(Boolean);

export function parseLedger(text) {
  const areas = [];
  const blocks = [];
  const areaOf = new Map();
  let area = null;
  let block = null;
  text.split("\n").forEach((line, i) => {
    const lineNo = i + 1;
    const a = /^## Area (\d+)\b(.*)$/.exec(line);
    if (a) {
      area = { number: Number(a[1]), title: a[2].replace(/^\s*[—-]\s*/, "").trim(), verified: null, line: lineNo };
      areas.push(area);
      block = null;
      return;
    }
    if (/^## /.test(line)) { area = null; block = null; return; }
    if (!area) return;
    const v = /^Verified: `([0-9a-f]{7,40})`/.exec(line);
    if (v && !block) { area.verified = v[1]; return; }
    const h = /^### (.+)$/.exec(line);
    if (h) {
      block = { title: h[1].trim(), area: area.number, line: lineNo, fields: {}, duplicates: [] };
      blocks.push(block);
      areaOf.set(block, area);
      return;
    }
    if (/^#### /.test(line)) { block = null; return; }
    const f = block && /^- ([a-z]+): ?(.*)$/.exec(line);
    if (!f) return;
    // A second `- feature:` used to overwrite the first in silence, changing
    // the join with no finding. Kept first, and recorded for `ledgerErrors`.
    if (f[1] in block.fields) block.duplicates.push(f[1]);
    else block.fields[f[1]] = f[2].trim();
  });
  // Each block carries the commit of ITS area object — not a lookup by area
  // number, which gave two areas sharing a number one of their two commits.
  for (const b of blocks) b.verified = areaOf.get(b).verified;
  return { areas, blocks };
}

const isRepoCitation = (p) => PATH_ROOT_RE.test(p) || ROOT_FILE_RE.test(p);
/**
 * An absolute or home-relative token that names a REPOSITORY location — some
 * trailing run of its segments is a repo citation (`/src/a.ts`,
 * `/Users/me/vmark/src/a.ts`, `~/vmark/README.md`). Such a citation resolves on
 * one machine at most, and used to be dropped without a finding. A system path
 * stated as a fact (`/bin/sleep`, `/Volumes/**`) is not a repo citation and is
 * left alone.
 */
function isAbsoluteRepoCitation(p) {
  if (!/^(?:\/|~\/)/.test(p)) return false;
  const segs = p.split("/");
  return segs.some((_, i) => i > 0 && isRepoCitation(segs.slice(i).join("/")));
}

/** `{a,b}` → two strings; nested groups expand left to right. */
function expandBraces(s) {
  const m = /\{([^{}]*)\}/.exec(s);
  if (!m) return [s];
  return m[1].split(",").flatMap((alt) => expandBraces(s.slice(0, m.index) + alt + s.slice(m.index + m[0].length)));
}

/**
 * Repo paths cited in backticks, braces expanded. A glob stays WHOLE: cutting
 * it back to its literal prefix let `src/foo/*.ts` pass whenever `src/foo`
 * existed, matching or not.
 */
export function citedPaths(value) {
  const out = [];
  for (const m of value.matchAll(/`([^`\s]+)`/g)) {
    const raw = m[1].replace(/#.*$/, "").replace(/:\d+(?:[-–]\d+)?(?:,\d+(?:[-–]\d+)?)*$/, "").replace(/[:,.;)]+$/, "");
    if (!isRepoCitation(raw) && !isAbsoluteRepoCitation(raw)) continue;
    for (const p of expandBraces(raw)) {
      const clean = GLOB_RE.test(p) ? p : p.replace(/\/+$/, "");
      if (clean && !out.includes(clean)) out.push(clean);
    }
  }
  return out;
}

/** A repo-relative glob as an anchored RegExp: `*` and `?` stay in one segment, `**` crosses them. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end === -1) re += "\\[";
      else { re += `[${glob.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`; i = end; }
    } else re += c.replace(/[.+^${}()|\\/]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** A path that names ONE place in the tree: no `.`/`..`/empty segment, not absolute. */
const isCanonical = (p) => !p.startsWith("/") && p.split("/").every((seg, i, all) => seg !== "." && seg !== ".." && (seg !== "" || (i === all.length - 1 && GLOB_RE.test(p))));

/**
 * Areas: at least one, numbers unique, each verified at a commit that exists
 * AND is an ancestor of HEAD. A commit that exists but was rebased away is not
 * a point on this history, so "commits since verified" would be measured from
 * nowhere. Each distinct commit is asked about once.
 */
function areaErrors(doc, { shaExists, isAncestor }) {
  const errors = [];
  if (doc.areas.length === 0) errors.push(`${LEDGER_REL}: no \`## Area <n>\` sections — nothing to check`);
  const firstLine = new Map();
  const verdict = new Map();
  for (const a of doc.areas) {
    if (firstLine.has(a.number)) errors.push(`Area ${a.number} is declared twice (lines ${firstLine.get(a.number)} and ${a.line}) — area numbers identify areas`);
    else firstLine.set(a.number, a.line);
    if (!a.verified) {
      errors.push(`Area ${a.number} (line ${a.line}): no \`Verified: \`<commit>\`\` line — a block with no verification point cannot be known to be current`);
      continue;
    }
    if (!verdict.has(a.verified)) verdict.set(a.verified, !shaExists(a.verified) ? "missing" : !isAncestor(a.verified) ? "unrelated" : "ok");
    const v = verdict.get(a.verified);
    if (v === "missing") errors.push(`Area ${a.number}: verified commit ${a.verified} does not resolve in this repository`);
    if (v === "unrelated") errors.push(`Area ${a.number}: verified commit ${a.verified} is not an ancestor of HEAD — a rebased or abandoned commit is no point on this history to count changes from`);
  }
  return errors;
}

const whereOf = (b) => `block "${b.fields.id || `(untitled: ${b.title})`}" (line ${b.line})`;

/** Each block's own shape: required fields, no field twice, a unique id, a spine feature, known status tags. */
function blockErrors(doc, names) {
  const errors = [];
  const seen = new Map();
  for (const b of doc.blocks) {
    const where = whereOf(b);
    for (const field of REQUIRED_FIELDS) if (!(field in b.fields) || b.fields[field] === "") errors.push(`${where}: missing field "${field}"`);
    for (const field of new Set(b.duplicates ?? [])) errors.push(`${where}: field "${field}" appears more than once — the first is used, so the second is silently ignored`);
    if (b.fields.id) {
      if (seen.has(b.fields.id)) errors.push(`duplicate block id "${b.fields.id}" (lines ${seen.get(b.fields.id)} and ${b.line}) — ids are global`);
      else seen.set(b.fields.id, b.line);
    }
    const feature = b.fields.feature;
    if (feature && feature !== INFRASTRUCTURE && !names.has(feature)) errors.push(`${where}: feature "${feature}" is not a spine feature (scripts/feature-map.json)`);
    for (const tag of statusTags(b.fields.status)) {
      if (!STATUS_TAGS.includes(tag)) errors.push(`${where}: unknown status tag "${tag}" (vocabulary: ${STATUS_TAGS.join(", ")})`);
    }
  }
  return errors;
}

/** Every cited path names one real place: canonical, and existing — or, for a glob, matching at least one file. */
function citationErrors(doc, { exists, globMatches }) {
  const errors = [];
  for (const b of doc.blocks) {
    for (const field of CITING_FIELDS) {
      for (const p of citedPaths(b.fields[field] ?? "")) {
        if (/^(?:\/|~\/)/.test(p)) errors.push(`${whereOf(b)}: ${field} cites ${p}, which is an absolute path — cite it repository-relative`);
        else if (!isCanonical(p)) errors.push(`${whereOf(b)}: ${field} cites ${p}, which is not a canonical repository path (no \`.\`/\`..\` segments)`);
        else if (GLOB_RE.test(p)) { if (!globMatches(p)) errors.push(`${whereOf(b)}: ${field} cites ${p}, which matches no file`); }
        else if (!exists(p)) errors.push(`${whereOf(b)}: ${field} cites ${p}, which does not exist`);
      }
    }
  }
  return errors;
}

/**
 * Every way the ledger disagrees with the spine or the tree. The four probes
 * are injected so the rules are testable without a repository:
 * `exists(relPath)`, `globMatches(glob)`, `shaExists(sha)`, `isAncestor(sha)`.
 */
export function ledgerErrors(doc, spine, probes) {
  const names = new Set((spine.features ?? []).map((f) => f.name));
  const described = new Set(doc.blocks.map((b) => b.fields.feature).filter(Boolean));
  return [
    ...areaErrors(doc, probes),
    ...blockErrors(doc, names),
    ...citationErrors(doc, probes),
    ...[...names].filter((n) => !described.has(n)).map((n) => `spine feature "${n}" has no ledger block — inspect it, or retire the row`),
  ];
}
