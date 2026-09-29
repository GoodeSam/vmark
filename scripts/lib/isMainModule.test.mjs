/**
 * `isMainModule(import.meta.url)` — was this module started as the entry
 * script, rather than imported by a test or by another script?
 *
 * Every case runs a real `node` child through a real path in a temp directory.
 * The property under test is how Node spells the entry (`process.argv[1]`)
 * against the module's own URL, and a mock would only restate an assumption
 * about that. The shapes below are the ones that made a gate's `main()`
 * silently not run — exit 0, no output, nothing checked (#1473): a path with a
 * space or CJK characters (`import.meta.url` is percent-encoded), and a
 * symlinked directory or file (Node runs the REAL path, argv[1] stays as
 * typed). And the half the helper must not over-correct into: an imported
 * module, a same-named script elsewhere (what an `endsWith` guard mistook for
 * itself), no argv[1] at all, and an argv[1] that names no file.
 *
 * @coordinates-with scripts/lib/isMainModule.mjs — the subject
 * @coordinates-with scripts/check-main-module-guards.test.mjs — keeps every script on it
 * @module scripts/lib/isMainModule.test
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const HELPER = pathToFileURL(path.join(import.meta.dirname, "isMainModule.mjs")).href;
const base = mkdtempSync(path.join(tmpdir(), "is-main-module-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/**
 * Write a module at `file` that prints `<label>=<isMainModule(import.meta.url)>`,
 * after importing each of `imports` (which print their own verdicts).
 */
function probe(file, label, { imports = [], extraLines = [] } = {}) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      ...imports.map((dep) => `import ${JSON.stringify(pathToFileURL(dep).href)};`),
      `import { isMainModule } from ${JSON.stringify(HELPER)};`,
      `console.log(${JSON.stringify(label)} + "=" + isMainModule(import.meta.url));`,
      ...extraLines,
      "",
    ].join("\n"),
  );
  return file;
}

/** Run `node …args`, require a clean exit, and return every `label=bool` it printed. */
function verdicts(args, { cwd = base } = {}) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: "utf8", input: "", timeout: 60_000 });
  if (r.error) throw r.error;
  expect(r.status, `node ${args.join(" ")}\n${r.stdout}${r.stderr}`).toBe(0);
  return Object.fromEntries([...r.stdout.matchAll(/^(\S+)=(true|false)$/gm)].map((m) => [m[1], m[2] === "true"]));
}

describe("the entry script is recognised wherever it lives", () => {
  it.each([
    ["a plain temp path", "plain"],
    ["a path with a space", "with space"],
    ["a path with CJK characters", "中文目录"],
    ["a path with a space and CJK characters", "vmark 测试"],
  ])("%s", (_, dir) => {
    const entry = probe(path.join(base, "shapes", dir, "entry.mjs"), "entry");
    expect(verdicts([entry])).toEqual({ entry: true });
  });

  it("a path relative to the working directory", () => {
    const dir = path.join(base, "relative");
    probe(path.join(dir, "entry.mjs"), "entry");
    expect(verdicts(["entry.mjs"], { cwd: dir })).toEqual({ entry: true });
  });

  it("a TypeScript entry under tsx (`node --import tsx <path>`, as lint:theme-contrast runs)", () => {
    const entry = probe(path.join(base, "tsx 目录", "entry.ts"), "entry", { extraLines: ["const typed: number = 1;", "void typed;"] });
    // `--import tsx` resolves from the working directory: the repo's own copy.
    expect(verdicts(["--import", "tsx", entry], { cwd: REPO })).toEqual({ entry: true });
  });

  describe.skipIf(platform() === "win32")("through a symlink (Node runs the real path)", () => {
    it("a symlinked directory whose name has a space and CJK characters", () => {
      const real = path.join(base, "real dir 真实");
      probe(path.join(real, "entry.mjs"), "entry");
      const link = path.join(base, "link dir 链接");
      symlinkSync(real, link, "dir");
      expect(verdicts([path.join(link, "entry.mjs")])).toEqual({ entry: true });
    });

    it("a symlinked file", () => {
      const real = probe(path.join(base, "file-target", "entry.mjs"), "entry");
      const link = path.join(base, "file-link 链接.mjs");
      symlinkSync(real, link, "file");
      expect(verdicts([link])).toEqual({ entry: true });
    });
  });
});

describe("everything that is not the entry script is refused", () => {
  it("a module the entry script imports", () => {
    const dir = path.join(base, "imports");
    const dep = probe(path.join(dir, "dep.mjs"), "dep");
    const entry = probe(path.join(dir, "entry.mjs"), "entry", { imports: [dep] });
    expect(verdicts([entry])).toEqual({ dep: false, entry: true });
  });

  it("a same-named script in another directory — the false positive an endsWith guard had", () => {
    const other = probe(path.join(base, "same-name", "a", "check-x.mjs"), "imported");
    const entry = probe(path.join(base, "same-name", "b", "check-x.mjs"), "entry", { imports: [other] });
    expect(verdicts([entry])).toEqual({ imported: false, entry: true });
  });

  it("no argv[1] at all", () => {
    const mod = probe(path.join(base, "eval", "mod.mjs"), "mod");
    const code = `console.log("argc=" + process.argv.length); await import(${JSON.stringify(pathToFileURL(mod).href)});`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", input: "", timeout: 60_000 });
    if (r.error) throw r.error;
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("argc=1"); // the precondition: there really is no argv[1]
    expect(r.stdout).toContain("mod=false");
  });

  it.each([
    ["an empty string", ""],
    ["a name too long for the filesystem", "x".repeat(5000)],
    ["a path that does not exist", path.join(base, "nowhere", "entry.mjs")],
  ])("an argv[1] that names no file: %s", (_, arg) => {
    const mod = probe(path.join(base, "not-a-path", "mod.mjs"), "mod");
    const code = `await import(${JSON.stringify(pathToFileURL(mod).href)});`;
    expect(verdicts(["--input-type=module", "-e", code, arg])).toEqual({ mod: false });
  });
});

// Guards the guard: if these fixtures stopped reproducing the defect — a temp
// path with no space, a "symlink" that is a copy — every case above would pass
// against the old ad-hoc guards too, and prove nothing.
describe("SELF-TEST: the fixtures reproduce the defect the helper exists for", () => {
  const naive = [
    'import { pathToFileURL } from "node:url";',
    // The two shapes the repository used before the helper, verbatim.
    'console.log("template=" + (import.meta.url === `file://${process.argv[1]}`));',
    'console.log("pathToFileURL=" + (import.meta.url === pathToFileURL(process.argv[1] ?? "").href));',
  ];

  it("a space and CJK characters defeat `file://${argv[1]}`", () => {
    const entry = probe(path.join(base, "self-test", "vmark 测试", "entry.mjs"), "entry", { extraLines: naive });
    expect(verdicts([entry])).toMatchObject({ entry: true, template: false });
  });

  it.skipIf(platform() === "win32")("a symlink defeats even `pathToFileURL(argv[1])`", () => {
    const real = path.join(base, "self-test", "real");
    probe(path.join(real, "entry.mjs"), "entry", { extraLines: naive });
    const link = path.join(base, "self-test", "link");
    symlinkSync(real, link, "dir");
    expect(verdicts([path.join(link, "entry.mjs")])).toEqual({ entry: true, template: false, pathToFileURL: false });
  });
});
