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
const CITING_FIELDS = ["code", "docs", "tests"];
const PATH_ROOT_RE = /^(?:src|src-tauri|server|website|e2e|scripts|\.github|\.claude|patches)\//;

export function parseLedger(text) {
  const areas = [];
  const blocks = [];
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
      block = { title: h[1].trim(), area: area.number, line: lineNo, fields: {} };
      blocks.push(block);
      return;
    }
    if (/^#### /.test(line)) { block = null; return; }
    const f = block && /^- ([a-z]+): ?(.*)$/.exec(line);
    if (f) block.fields[f[1]] = f[2].trim();
  });
  return { areas, blocks };
}

/** `{a,b}` → two strings; nested groups expand left to right. */
function expandBraces(s) {
  const m = /\{([^{}]*)\}/.exec(s);
  if (!m) return [s];
  return m[1].split(",").flatMap((alt) => expandBraces(s.slice(0, m.index) + alt + s.slice(m.index + m[0].length)));
}

/** Repo paths cited in backticks, braces expanded, globs cut back to their literal prefix. */
export function citedPaths(value) {
  const out = [];
  for (const m of value.matchAll(/`([^`\s]+)`/g)) {
    const raw = m[1].replace(/#.*$/, "").replace(/:\d+(?:[-–]\d+)?(?:,\d+(?:[-–]\d+)?)*$/, "").replace(/[:,.;)]+$/, "");
    if (!PATH_ROOT_RE.test(raw)) continue;
    for (const p of expandBraces(raw)) {
      const star = p.search(/[*?[]/);
      const literal = (star === -1 ? p : p.slice(0, star)).replace(/\/+$/, "");
      if (literal && !out.includes(literal)) out.push(literal);
    }
  }
  return out;
}

/**
 * Every way the ledger disagrees with the spine or the tree.
 * `exists(relPath)` and `shaExists(sha)` are injected so the rules are testable
 * without a repository.
 */
export function ledgerErrors(doc, spine, { exists, shaExists }) {
  const errors = [];
  const names = new Set((spine.features ?? []).map((f) => f.name));
  if (doc.areas.length === 0) errors.push(`${LEDGER_REL}: no \`## Area <n>\` sections — nothing to check`);
  for (const a of doc.areas) {
    if (!a.verified) errors.push(`Area ${a.number} (line ${a.line}): no \`Verified: \`<commit>\`\` line — a block with no verification point cannot be known to be current`);
    else if (!shaExists(a.verified)) errors.push(`Area ${a.number}: verified commit ${a.verified} does not resolve in this repository`);
  }
  const seen = new Map();
  const described = new Set();
  for (const b of doc.blocks) {
    const id = b.fields.id || `(untitled: ${b.title})`;
    const where = `block "${id}" (line ${b.line})`;
    for (const field of REQUIRED_FIELDS) if (!(field in b.fields) || b.fields[field] === "") errors.push(`${where}: missing field "${field}"`);
    if (b.fields.id) {
      if (seen.has(b.fields.id)) errors.push(`duplicate block id "${b.fields.id}" (lines ${seen.get(b.fields.id)} and ${b.line}) — ids are global`);
      else seen.set(b.fields.id, b.line);
    }
    const feature = b.fields.feature;
    if (feature) {
      if (feature !== INFRASTRUCTURE && !names.has(feature)) errors.push(`${where}: feature "${feature}" is not a spine feature (scripts/feature-map.json)`);
      described.add(feature);
    }
    for (const tag of (b.fields.status ?? "").split(",").map((t) => t.trim()).filter(Boolean)) {
      if (!STATUS_TAGS.includes(tag)) errors.push(`${where}: unknown status tag "${tag}" (vocabulary: ${STATUS_TAGS.join(", ")})`);
    }
    for (const field of CITING_FIELDS) {
      for (const p of citedPaths(b.fields[field] ?? "")) {
        if (!exists(p)) errors.push(`${where}: ${field} cites ${p}, which does not exist`);
      }
    }
  }
  for (const name of names) if (!described.has(name)) errors.push(`spine feature "${name}" has no ledger block — inspect it, or retire the row`);
  return errors;
}
