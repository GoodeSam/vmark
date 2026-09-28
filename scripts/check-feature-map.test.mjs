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
import { resolveOwners, ownershipUniverse, claimErrors, isTestFile } from "./lib/featureOwnership.mjs";
import { parseLedger, ledgerErrors, citedPaths, globToRegExp, statusTags } from "./lib/featureLedgerDoc.mjs";
import { gitIn, ledgerProbes } from "./lib/featureMapInputs.mjs";

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

  it("recognises Rust's conventional test-module names as tests, not production code", () => {
    // Every one of these is mounted as `mod tests;` or `#[path = "…_tests.rs"]`
    // in this crate; counting them as production corrupted ownership and the Code column.
    const rustTests = [
      "src-tauri/src/cli_install/tests.rs", "src-tauri/src/hot_exit/migration_v5_tests.rs",
      "src-tauri/src/hot_exit/path_containment_tests.rs", "src-tauri/src/x/util_test.rs", "src-tauri/tests/spike.rs",
    ];
    for (const f of rustTests) expect(isTestFile(f), f).toBe(true);
    // A word that merely ENDS in "tests" is not the convention.
    for (const f of ["src-tauri/src/contests.rs", "src-tauri/src/latest.rs", "src/tests.ts"]) expect(isTestFile(f), f).toBe(false);
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

  it("refuses a catch-all claim over a whole source root — it would silently own every new file", () => {
    for (const root of ["src", "./src/", "src-tauri", "src-tauri/src", "server", "."]) {
      const s = spine([feat("A", ["src/a.ts"])], { paths: [root] });
      expect(claimErrors(s, ["src/a.ts", "src/b.ts"]).join("\n"), root).toMatch(/claims a whole source root/);
    }
    // The same rule binds a feature: `src` as a feature path is the same bypass.
    expect(claimErrors(spine([feat("A", ["src"])], { paths: ["src/x.ts"] }), ["src/x.ts", "src/y.ts"]).join("\n")).toMatch(/"A".*claims a whole source root -> src/);
    // A real directory one level down is a claim, not a catch-all — and a whole
    // server PACKAGE is one feature (the MCP sidecar), not a source root.
    expect(claimErrors(spine([feat("A", ["src/editor"]), feat("M", ["server/mcp/src"])], { paths: ["src/utils"] }),
      ["src/editor/a.ts", "src/utils/b.ts", "server/mcp/src/cli.ts"])).toEqual([]);
  });

  it("reserves the infrastructure owner name — a feature called that would share its identity", () => {
    const s = spine([feat("infrastructure", ["src/a.ts"])], { paths: ["src/b.ts"] });
    expect(claimErrors(s, ["src/a.ts", "src/b.ts"]).join("\n")).toMatch(/"infrastructure" is reserved/);
  });

  it("reports a malformed spine as findings instead of throwing", () => {
    const shapes = [
      null,
      { features: [null], infrastructure: { paths: ["src/b.ts"] } },
      { features: [{ name: "A", paths: "src/a.ts" }], infrastructure: { paths: ["src/b.ts"] } },
      { features: [{ name: "A", paths: ["src/a.ts", 7] }], infrastructure: { paths: ["src/b.ts"] } },
      { features: [{ name: "A", paths: ["src/a.ts"], dataOnly: "src/a.ts" }], infrastructure: { paths: ["src/b.ts"] } },
      { features: [{ name: "A", paths: ["src/a.ts"] }], infrastructure: { paths: [null] } },
    ];
    for (const s of shapes) {
      let out;
      expect(() => { out = claimErrors(s, ["src/a.ts", "src/b.ts"]); }, JSON.stringify(s)).not.toThrow();
      expect(out.length, JSON.stringify(s)).toBeGreaterThan(0);
    }
  });

  it("resolves each file's winning claim once, and reports the same stale claims", () => {
    const s = spine([feat("A", ["src/d", "src/d/x"]), feat("B", ["src/d/one.ts"])], { paths: ["src/u"] });
    const { claim } = resolveOwners(s, ["src/d/one.ts", "src/d/x/y.ts", "src/u/k.ts"]);
    expect(claim.get("src/d/x/y.ts")).toBe("src/d/x");
    expect(claim.get("src/d/one.ts")).toBe("src/d/one.ts");
    expect(claimErrors(s, ["src/d/one.ts", "src/d/x/y.ts", "src/u/k.ts"])).toEqual(['"A": claim src/d owns no code file — its files moved, or more specific claims took all of them']);
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

  it("expands brace groups and keeps a glob WHOLE, so it can be matched rather than cut to a prefix", () => {
    expect(citedPaths("`src/{a,b}/x.ts`, `src/plugins/c/**` and prose `not/a/path`")).toEqual([
      "src/a/x.ts", "src/b/x.ts", "src/plugins/c/**",
    ]);
    expect(citedPaths("`src/d.ts:99`, `src/e.rs:10-20`, `src/f.ts#L3`, `src/g.md:38,162-170`")).toEqual(["src/d.ts", "src/e.rs", "src/f.ts", "src/g.md"]);
  });

  it("collects root-level files by their shape, and leaves a bare module basename alone", () => {
    expect(citedPaths("`README.md` Install section, `vitest.gates.config.ts`, `package.json`, `tsconfig.test.json`")).toEqual([
      "README.md", "vitest.gates.config.ts", "package.json", "tsconfig.test.json",
    ]);
    // A basename mentioned in passing is not a root citation.
    expect(citedPaths("`resolveDirtyBatch.ts`, `menu-ids.json`, `defaults.ts`")).toEqual([]);
  });

  it("records a repeated field instead of letting the second silently win", () => {
    const doc = parseLedger(LEDGER(area(1, block("A", { id: "a" }) + "- feature: Tables\n")));
    expect(doc.blocks[0].fields.feature).toBe("Editor");
    expect(doc.blocks[0].duplicates).toEqual(["feature"]);
  });

  it("carries each block's verified commit from ITS area, even when two areas share a number", () => {
    const doc = parseLedger(LEDGER(area(1, block("A", { id: "a" }), "aaaaaaa") + area(1, block("B", { id: "b" }), "bbbbbbb")));
    expect(doc.blocks.map((b) => b.verified)).toEqual(["aaaaaaa", "bbbbbbb"]);
  });

  it("parses a status field with one shared rule", () => {
    expect(statusTags(" shipped-on , macos-only,,")).toEqual(["shipped-on", "macos-only"]);
    expect(statusTags(undefined)).toEqual([]);
  });
});

describe("globToRegExp", () => {
  it.each([
    ["src/foo/*.ts", "src/foo/a.ts", true],
    ["src/foo/*.ts", "src/foo/sub/a.ts", false],
    ["src/foo/**", "src/foo/sub/a.ts", true],
    ["src/foo/**/*.test.ts", "src/foo/a.test.ts", true],
    ["src/foo/**/*.test.ts", "src/foo/x/y/a.test.ts", true],
    ["src/foo/bar*.ts", "src/foo/barBaz.ts", true],
    ["src/foo/a?.ts", "src/foo/ab.ts", true],
    ["src/foo/a.ts", "src/fooXa.ts", false],
  ])("%s against %s → %s", (glob, file, want) => {
    expect(globToRegExp(glob).test(file)).toBe(want);
  });
});

describe("ledgerErrors", () => {
  const s = spine([feat("Editor", ["src/editor"]), feat("Tables", ["src/tables"])]);
  const tree = ["src/editor/a.ts", "src/editor/a.test.ts", "src/tables/t.ts", "README.md", "src-tauri/src/lib.rs"];
  const exists = (p) => tree.includes(p) || tree.some((f) => f.startsWith(`${p}/`));
  const globMatches = (g) => tree.some((f) => globToRegExp(g).test(f));
  const ok = { exists, globMatches, shaExists: () => true, isAncestor: () => true };
  const check = (text, over = {}) => ledgerErrors(parseLedger(text), s, { ...ok, ...over }).join("\n");
  const T = block("T", { id: "t", feature: "Tables", code: "`src/tables/**`", tests: "none" });

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
    expect(check(LEDGER(area(1, block("A", { id: "a" }) + T)), { shaExists: () => false })).toMatch(/Area 1.*commit abc1234 does not resolve/);
  });

  it("refuses a verified commit that is not an ancestor of HEAD — a rebased-away commit measures nothing", () => {
    const out = check(LEDGER(area(1, block("A", { id: "a" }) + T)), { isAncestor: (sha) => sha !== "abc1234" });
    expect(out).toMatch(/Area 1: verified commit abc1234 is not an ancestor of HEAD/);
  });

  it("asks git about each distinct verified commit once, however many areas cite it", () => {
    let calls = 0;
    const shaExists = () => { calls++; return true; };
    check(LEDGER(area(1, block("A", { id: "a" })) + area(2, T) + area(3, "")), { shaExists });
    expect(calls).toBe(1);
  });

  it("refuses two areas with one number — blocks would be verified against the wrong commit", () => {
    expect(check(LEDGER(area(1, block("A", { id: "a" })) + area(1, T)))).toMatch(/Area 1 is declared twice \(lines \d+ and \d+\)/);
  });

  it("refuses a repeated field in one block", () => {
    const text = LEDGER(area(1, block("A", { id: "a" }) + "- status: deprecated\n" + T));
    expect(check(text)).toMatch(/block "a" \(line \d+\): field "status" appears more than once/);
  });

  it("checks Rust citations like every other citing field", () => {
    const text = LEDGER(area(1, block("A", { id: "a", rust: "`src-tauri/src/lib.rs`, `src-tauri/src/gone.rs`" }) + T));
    expect(check(text)).toMatch(/"a".*rust cites src-tauri\/src\/gone\.rs, which does not exist/);
    expect(check(text)).not.toMatch(/lib\.rs/);
  });

  it("checks a root-level file citation", () => {
    const text = LEDGER(area(1, block("A", { id: "a", docs: "`README.md` Install, `CONTRIBUTING.md`" }) + T));
    const out = check(text);
    expect(out).toMatch(/"a".*docs cites CONTRIBUTING\.md, which does not exist/);
    expect(out).not.toMatch(/README/);
  });

  it("requires a glob citation to match at least one file", () => {
    const out = check(LEDGER(area(1, block("A", { id: "a", code: "`src/editor/*.rs`, `src/editor/*.ts`" }) + T)));
    expect(out).toMatch(/"a".*code cites src\/editor\/\*\.rs, which matches no file/);
    expect(out).not.toMatch(/\*\.ts/);
  });

  it("refuses a citation that is not a canonical in-repository path", () => {
    const out = check(LEDGER(area(1, block("A", { id: "a", code: "`src/editor/../../package.json`, `src/./editor/a.ts`" }) + T)));
    expect(out).toMatch(/"a".*code cites src\/editor\/\.\.\/\.\.\/package\.json, which is not a canonical repository path/);
    expect(out).toMatch(/"a".*code cites src\/\.\/editor\/a\.ts, which is not a canonical repository path/);
  });

  it("refuses a repository file cited by an ABSOLUTE or home-relative path — it names one machine, not the repo", () => {
    const out = check(LEDGER(area(1, block("A", {
      id: "a",
      code: "`/src/editor/a.ts`, `/Users/me/vmark/src/editor/a.ts`, `~/vmark/README.md`",
      notes: "none",
    }) + T)));
    expect(out).toMatch(/"a".*code cites \/src\/editor\/a\.ts, which is an absolute path — cite it repository-relative/);
    expect(out).toMatch(/"a".*code cites \/Users\/me\/vmark\/src\/editor\/a\.ts, which is an absolute path/);
    expect(out).toMatch(/"a".*code cites ~\/vmark\/README\.md, which is an absolute path/);
  });

  it("leaves a system path stated as a fact alone — it is not a repository citation", () => {
    const text = LEDGER(area(1, block("A", { id: "a", rust: "capability scopes `$HOME/**`, `/Volumes/**`, `/media/**`; spawns `/bin/sleep`" }) + T));
    expect(check(text)).toBe("");
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
  const base_files = () => base;

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

  it("catches an unowned file BEFORE it is committed — the untracked half of the enumeration", () => {
    const { dir, head } = scratch({ ...base, "scripts/feature-map.json": map(goodSpine) });
    writeLedger(dir, head);
    writeFileSync(path.join(dir, "src/untracked.ts"), "export {};\n");
    const res = runGate(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/src\/untracked\.ts is owned by no feature/);
  });

  it("reports a spine that is valid JSON but the wrong shape as a finding, not a crash", () => {
    const { dir, head } = scratch({ ...base, "scripts/feature-map.json": "null" });
    writeLedger(dir, head);
    const res = runGate(dir);
    expect(res.stderr).not.toMatch(/TypeError|at .*\.mjs:\d+/);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/expected a `features` array/);
  });

  it("exits 66 with the input named when git cannot enumerate the tree", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "feature-map-nogit-"));
    mkdirSync(path.join(dir, "scripts"), { recursive: true });
    writeFileSync(path.join(dir, "scripts/feature-map.json"), map(goodSpine));
    const res = runGate(dir);
    expect(res.status).toBe(66);
    expect(res.stderr).toMatch(/git ls-files: unreadable/);
    expect(res.stderr).not.toMatch(/at .*\.mjs:\d+/);
  });

  it("exits 66 with the input named when the ledger cannot be read", () => {
    const { dir } = scratch({ ...base, "scripts/feature-map.json": map(goodSpine) });
    mkdirSync(path.join(dir, ".claude/feature-ledger.md"), { recursive: true }); // a directory: exists, unreadable as a file
    const res = runGate(dir);
    expect(res.status).toBe(66);
    expect(res.stderr).toMatch(/\.claude\/feature-ledger\.md: unreadable/);
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

  it("judges ancestry with real git: an ancestor or HEAD passes, a sibling-branch or descendant commit does not", () => {
    const { dir, head: base } = scratch({ ...base_files(), "scripts/feature-map.json": map(goodSpine) });
    const git = (...a) => execFileSync("git", ["-c", "user.email=g@example.test", "-c", "user.name=G", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8" }).trim();
    git("checkout", "-q", "-b", "side");
    writeFileSync(path.join(dir, "src/editor/a.ts"), "export const a = 2;\n");
    git("commit", "-qam", "sibling");
    const sibling = git("rev-parse", "--short", "HEAD");
    git("checkout", "-q", "main");
    writeFileSync(path.join(dir, "src/editor/a.ts"), "export const a = 3;\n");
    git("commit", "-qam", "mid");
    const mid = git("rev-parse", "--short", "HEAD");
    writeFileSync(path.join(dir, "src/editor/a.ts"), "export const a = 4;\n");
    git("commit", "-qam", "tip");
    const tip = git("rev-parse", "--short", "HEAD");
    git("checkout", "-q", "--detach", mid); // HEAD = mid, so tip is a DESCENDANT of it
    const { isAncestor, shaExists } = ledgerProbes(dir, gitIn(dir), []);
    expect([base, mid, sibling, tip].map(shaExists)).toEqual([true, true, true, true]);
    expect(isAncestor(base)).toBe(true);
    expect(isAncestor(mid)).toBe(true);
    expect(isAncestor(sibling)).toBe(false);
    expect(isAncestor(tip)).toBe(false);
    // And through the gate: a ledger verified at the sibling commit is refused by name.
    writeLedger(dir, sibling);
    const res = runGate(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(new RegExp(`Area 1: verified commit ${sibling} is not an ancestor of HEAD`));
    writeLedger(dir, base);
    expect(runGate(dir).status).toBe(0);
  });

  it("rejects an unknown flag with exit 64", () => {
    expect(spawnSync(process.execPath, [SCRIPT, "--nope"], { encoding: "utf8" }).status).toBe(64);
  });
});
