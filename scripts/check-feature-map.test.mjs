/**
 * Feature-map gate — every production source file has exactly one owner, and
 * the maintainer-local ledger joins the spine it describes.
 *
 * The failure this exists to stop is silence: a new module that joins no
 * feature, a ledger block citing a file that was deleted, a feature nobody
 * inspected. Each looks identical to a healthy tree unless something asks, so
 * each case asserts the finding text, not just the exit code.
 */
import { describe, it, expect } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOwners, ownershipUniverse, claimErrors } from "./lib/featureOwnership.mjs";
import { parseLedger, ledgerErrors, citedPaths } from "./lib/featureLedgerDoc.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-feature-map.mjs");

const spine = (features, infrastructure = { paths: [] }) => ({ features, infrastructure });
const feat = (name, paths, extra = {}) => ({ name, paths, flag: null, flagDefault: null, doc: null, ...extra });

describe("ownershipUniverse", () => {
  it("keeps production code under the three roots and drops tests, benches and non-code", () => {
    const files = [
      "src/a.ts", "src/a.test.ts", "src/x/__tests__/b.ts", "src/test/setup.ts", "src/bench/e.bench.ts",
      "src/c.css", "src-tauri/src/lib.rs", "src-tauri/src/lib.test.rs", "src-tauri/build.rs",
      "server/mcp/src/cli.ts", "server/mcp/vitest.config.ts", "scripts/x.mjs", "src/foo.webkit.test.ts",
    ];
    expect(ownershipUniverse(files)).toEqual(["src/a.ts", "src-tauri/src/lib.rs", "server/mcp/src/cli.ts"]);
  });
});

describe("resolveOwners", () => {
  it("gives a file to the MOST SPECIFIC claim, so a folder claim never double-counts a file claimed inside it", () => {
    const s = spine([feat("Editor", ["src/editor"]), feat("Tables", ["src/editor/table.ts"])]);
    const { owner, unowned } = resolveOwners(s, ["src/editor/a.ts", "src/editor/table.ts"]);
    expect(owner.get("src/editor/a.ts")).toBe("Editor");
    expect(owner.get("src/editor/table.ts")).toBe("Tables");
    expect(unowned).toEqual([]);
  });

  it("does not treat a sibling with a shared prefix as inside the claim", () => {
    const s = spine([feat("Svg", ["src/plugins/svg"])]);
    const { unowned } = resolveOwners(s, ["src/plugins/svgExtra/a.ts"]);
    expect(unowned).toEqual(["src/plugins/svgExtra/a.ts"]);
  });

  it("assigns declared infrastructure paths to the infrastructure owner", () => {
    const s = spine([feat("Editor", ["src/editor"])], { paths: ["src/utils/debug.ts"] });
    expect(resolveOwners(s, ["src/utils/debug.ts"]).owner.get("src/utils/debug.ts")).toBe("infrastructure");
  });
});

describe("claimErrors", () => {
  it("refuses one path claimed by two owners — ownership would be a coin toss", () => {
    const s = spine([feat("A", ["src/x.ts"]), feat("B", ["./src/x.ts/"])]);
    expect(claimErrors(s, ["src/x.ts"]).join("\n")).toMatch(/src\/x\.ts.*claimed by both "A" and "B"/);
  });

  it("refuses a claim that owns nothing because more specific claims took every file", () => {
    const s = spine([feat("A", ["src/d"]), feat("B", ["src/d/one.ts"])]);
    expect(claimErrors(s, ["src/d/one.ts"]).join("\n")).toMatch(/"A".*src\/d.*owns no code file/);
  });

  it("refuses infrastructure without a non-empty paths array", () => {
    expect(claimErrors({ features: [feat("A", ["src/a.ts"])] }, ["src/a.ts"]).join("\n")).toMatch(/infrastructure/);
  });
});

const LEDGER = (areas) => `# VMark feature ledger

Intro prose.

${areas}`;
const block = (title, fields) =>
  `### ${title}\n${Object.entries({
    id: "x", feature: "Editor", summary: "s", capabilities: "c", status: "shipped-on", gate: "always on",
    surfaces: "toolbar", code: "`src/editor/a.ts`", rust: "none", docs: "none", tests: "`src/editor/a.test.ts`", notes: "none",
    ...fields,
  }).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n`;
const area = (n, body, sha = "abc1234") => `## Area ${n} — Things\n\nVerified: \`${sha}\`\n\n${body}\n`;

describe("parseLedger", () => {
  it("reads areas, their verified commit, and every block's fields", () => {
    const doc = parseLedger(LEDGER(area(1, block("Alpha", { id: "alpha" }) + "\n" + block("Beta", { id: "beta" }))));
    expect(doc.areas).toHaveLength(1);
    expect(doc.areas[0].verified).toBe("abc1234");
    expect(doc.blocks.map((b) => b.fields.id)).toEqual(["alpha", "beta"]);
    expect(doc.blocks[0].area).toBe(1);
  });

  it("expands brace groups and keeps glob prefixes when collecting cited paths", () => {
    expect(citedPaths("`src/{a,b}/x.ts`, `src/plugins/c/**` and prose `not/a/path`")).toEqual([
      "src/a/x.ts", "src/b/x.ts", "src/plugins/c",
    ]);
    expect(citedPaths("`src/d.ts:99`, `src/e.rs:10-20`, `src/f.ts#L3`, `src/g.md:38,162-170`")).toEqual(["src/d.ts", "src/e.rs", "src/f.ts", "src/g.md"]);
  });
});

describe("ledgerErrors", () => {
  const s = spine([feat("Editor", ["src/editor"]), feat("Tables", ["src/tables"])]);
  const exists = (p) => ["src/editor/a.ts", "src/editor/a.test.ts", "src/tables"].includes(p);
  const shaOk = () => true;
  const check = (text) => ledgerErrors(parseLedger(text), s, { exists, shaExists: shaOk }).join("\n");

  it("passes a ledger whose blocks join the spine and cite live files", () => {
    const text = LEDGER(area(1, block("A", { id: "a" }) + block("T", { id: "t", feature: "Tables", code: "`src/tables/**`", tests: "none" })));
    expect(check(text)).toBe("");
  });

  it("names a block whose feature is not on the spine", () => {
    expect(check(LEDGER(area(1, block("A", { id: "a", feature: "Nope" }))))).toMatch(/"a".*feature "Nope" is not a spine feature/);
  });

  it("names a spine feature no block describes", () => {
    expect(check(LEDGER(area(1, block("A", { id: "a" }))))).toMatch(/spine feature "Tables" has no ledger block/);
  });

  it("names a cited path that no longer exists — the stale-citation case", () => {
    expect(check(LEDGER(area(1, block("A", { id: "a", code: "`src/editor/gone.ts`" }) + block("T", { id: "t", feature: "Tables", code: "`src/tables/**`" })))))
      .toMatch(/"a".*code cites src\/editor\/gone\.ts, which does not exist/);
  });

  it("refuses duplicate ids, a missing field, an unknown status tag, and an area with no verified commit", () => {
    const text = LEDGER(
      area(1, block("A", { id: "a" }) + block("A2", { id: "a", status: "shipped-on, sparkly" })) +
      `## Area 2 — More\n\n${block("T", { id: "t", feature: "Tables", code: "`src/tables/**`" }).replace(/- notes: none\n/, "")}`,
    );
    const out = check(text);
    expect(out).toMatch(/duplicate block id "a"/);
    expect(out).toMatch(/"a".*unknown status tag "sparkly"/);
    expect(out).toMatch(/"t".*missing field "notes"/);
    expect(out).toMatch(/Area 2.*no `Verified: `<commit>`` line/);
  });

  it("refuses a verified commit git cannot resolve", () => {
    const out = ledgerErrors(parseLedger(LEDGER(area(1, block("A", { id: "a" }) + block("T", { id: "t", feature: "Tables", code: "`src/tables/**`" })))),
      s, { exists, shaExists: () => false }).join("\n");
    expect(out).toMatch(/Area 1.*commit abc1234 does not resolve/);
  });
});

/** A committed scratch repo — the gate enumerates with `git ls-files`. */
function scratch(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "feature-map-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("-c", "user.email=g@example.test", "-c", "user.name=G", "-c", "commit.gpgsign=false", "add", "-A");
  git("-c", "user.email=g@example.test", "-c", "user.name=G", "-c", "commit.gpgsign=false", "commit", "-qm", "base");
  return { dir, head: git("rev-parse", "--short", "HEAD").trim() };
}
const runGate = (dir) => spawnSync(process.execPath, [SCRIPT, `--root=${dir}`], { encoding: "utf8" });
const DEFAULTS = "src/stores/settingsStore/defaults.ts";
const map = (s) => JSON.stringify(s);

describe("check-feature-map CLI", () => {
  const base = {
    [DEFAULTS]: "export const defaultSettings = {};\n",
    "src/editor/a.ts": "export const a = 1;\n",
    "src/utils/debug.ts": "export const d = 1;\n",
  };
  const goodSpine = spine([feat("Editor", ["src/editor"])], { paths: ["src/utils/debug.ts", "src/stores"] });

  /** A valid ledger for `goodSpine`, verified at the fixture's own commit. */
  const writeLedger = (dir, head, body = block("E", { id: "e", code: "`src/editor/a.ts`", tests: "none" })) => {
    mkdirSync(path.join(dir, ".claude"), { recursive: true });
    writeFileSync(path.join(dir, ".claude/feature-ledger.md"), LEDGER(area(1, body, head)));
  };

  it("passes when every file has one owner and the ledger joins the spine", () => {
    const { dir, head } = scratch({ ...base, "scripts/feature-map.json": map(goodSpine) });
    writeLedger(dir, head);
    const res = runGate(dir);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/3 production files, each with one owner/);
    expect(res.stdout).toMatch(/ledger: 1 blocks in 1 areas joined to 1 features/);
  });

  it("fails when the tracked ledger is missing", () => {
    const res = runGate(scratch({ ...base, "scripts/feature-map.json": map(goodSpine) }).dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/\.claude\/feature-ledger\.md is missing — the ledger is tracked and required/);
  });

  it("fails on a production file no feature owns, naming it", () => {
    const { dir, head } = scratch({ ...base, "src/newThing.ts": "export {};\n", "scripts/feature-map.json": map(goodSpine) });
    writeLedger(dir, head);
    const res = runGate(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/src\/newThing\.ts is owned by no feature/);
  });

  it("fails on a stale spine path, reusing the generator's spine validation", () => {
    const stale = spine([feat("Editor", ["src/editor", "src/moved"])], { paths: ["src/utils/debug.ts", "src/stores"] });
    const res = runGate(scratch({ ...base, "scripts/feature-map.json": map(stale) }).dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/path does not exist -> src\/moved/);
  });

  it("names a stale citation and an unresolvable verified commit in the ledger", () => {
    const { dir } = scratch({ ...base, "scripts/feature-map.json": map(goodSpine) });
    writeLedger(dir, "0000000", block("A", { id: "a", code: "`src/editor/gone.ts`", tests: "none" }));
    const res = runGate(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/gone\.ts, which does not exist/);
    expect(res.stderr).toMatch(/commit 0000000 does not resolve/);
  });

  it("rejects an unknown flag with exit 64", () => {
    expect(spawnSync(process.execPath, [SCRIPT, "--nope"], { encoding: "utf8" }).status).toBe(64);
  });
});
