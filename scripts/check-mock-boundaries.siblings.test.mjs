// WI-RA13B.8 — the mock-boundary ratchet sees same-feature sibling mocks.
/**
 * A relative `vi.mock("./x")` / `vi.mock("../x")` of a module that is the
 * app's own logic replaces real behaviour with a hand-written fake — the
 * anti-pattern `.claude/rules/10-tdd.md` names. A relative mock of a module
 * that wraps a real boundary (it imports `@tauri-apps/*` or a Node builtin)
 * is the sanctioned pattern and is not counted. Non-code targets (CSS, raw
 * assets) carry no logic and are not counted either.
 *
 * Like the store-mock suite, these run the REAL script against tmpdir
 * fixture trees and assert on the message as well as the exit code.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-mock-boundaries.mjs");

function writeTree(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "mock-siblings-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function runGate(root, baseline, extra = []) {
  const baselinePath = path.join(root, "baseline.json");
  writeFileSync(baselinePath, typeof baseline === "string" ? baseline : JSON.stringify(baseline, null, 2));
  const res = spawnSync(process.execPath, [SCRIPT, "--root", root, "--baseline", baselinePath, ...extra], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "", baselinePath };
}

const EMPTY = { entries: [], siblingEntries: [] };
const triple = (file, api, target) => ({ file, api, target });

const LOGIC = `export function add(a, b) { return a + b; }\n`;
const TAURI_WRAPPER = `import { invoke } from "@tauri-apps/api/core";\nexport const load = () => invoke("load");\n`;
const FS_WRAPPER = `import { readFile } from "node:fs/promises";\nexport const read = (p) => readFile(p, "utf8");\n`;

describe("sibling mocks — the subject's own logic", () => {
  it("fails on vi.mock('./sibling') of a logic module, naming file and resolved target", () => {
    const root = writeTree({
      "src/feature/calc.ts": LOGIC,
      "src/feature/calc.test.ts": `import { vi } from "vitest";\nvi.mock("./calc");\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("sibling");
    expect(stderr).toContain("src/feature/calc.test.ts");
    expect(stderr).toContain("src/feature/calc");
  });

  it("fails on a parent-relative mock from __tests__/, and on vi.doMock", () => {
    const root = writeTree({
      "src/feature/calc.tsx": LOGIC,
      "src/feature/__tests__/calc.test.ts": `import { vi } from "vitest";\nvi.doMock("../calc");\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/feature/__tests__/calc.test.ts — vi.doMock → src/feature/calc");
  });

  it("resolves a directory import to its index module", () => {
    const root = writeTree({
      "src/feature/parts/index.ts": LOGIC,
      "src/feature/a.test.ts": `import { vi } from "vitest";\nvi.mock("./parts");\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/feature/parts");
  });

  it("resolves a TS-ESM `.js` specifier to the `.ts` source", () => {
    const root = writeTree({
      "server/x/src/index.ts": LOGIC,
      "server/x/__tests__/unit/a.test.ts": `import { vi } from "vitest";\nvi.mock("../../src/index.js");\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("server/x/src/index");
  });

  it("fails closed on a relative code target that does not exist", () => {
    const root = writeTree({
      "src/feature/a.test.ts": `import { vi } from "vitest";\nvi.mock("./gone");\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/feature/gone");
  });

  it("passes when the sibling triple is in siblingEntries, and fails an identity swap", () => {
    const files = {
      "src/feature/calc.ts": LOGIC,
      "src/feature/other.ts": LOGIC,
      "src/feature/calc.test.ts": `import { vi } from "vitest";\nvi.mock("./calc");\n`,
    };
    const held = { entries: [], siblingEntries: [triple("src/feature/calc.test.ts", "vi.mock", "src/feature/calc")] };
    expect(runGate(writeTree(files), held).status).toBe(0);

    const swapped = writeTree({ ...files, "src/feature/calc.test.ts": `import { vi } from "vitest";\nvi.mock("./other");\n` });
    const { status, stderr } = runGate(swapped, held);
    expect(status).toBe(1);
    expect(stderr).toContain("src/feature/other");
    expect(stderr).toContain("no longer exist");
  });

  it("fails when a baselined sibling mock is gone and the win was not recorded", () => {
    const root = writeTree({ "src/feature/calc.ts": LOGIC, "src/feature/calc.test.ts": `export {};\n` });
    const { status, stderr } = runGate(root, {
      entries: [],
      siblingEntries: [triple("src/feature/calc.test.ts", "vi.mock", "src/feature/calc")],
    });
    expect(status).toBe(1);
    expect(stderr).toContain("no longer exist");
    expect(stderr).toContain("src/feature/calc.test.ts");
  });

  it("treats a baseline without siblingEntries as zero allowed sibling mocks", () => {
    const root = writeTree({
      "src/feature/calc.ts": LOGIC,
      "src/feature/calc.test.ts": `import { vi } from "vitest";\nvi.mock("./calc");\n`,
    });
    expect(runGate(root, { entries: [] }).status).toBe(1);
  });

  it("fails closed when siblingEntries is not an array of triples", () => {
    const root = writeTree({ "src/feature/ok.test.ts": `export {};\n` });
    const { status, stderr } = runGate(root, { entries: [], siblingEntries: { nope: 1 } });
    expect(status).toBe(1);
    expect(stderr).toContain("siblingEntries");
  });

  it("--write-baseline records sibling triples under siblingEntries", () => {
    const root = writeTree({
      "src/feature/calc.ts": LOGIC,
      "src/feature/calc.test.ts": `import { vi } from "vitest";\nvi.mock("./calc");\n`,
    });
    const { status, baselinePath } = runGate(root, EMPTY, ["--write-baseline"]);
    expect(status).toBe(0);
    const written = JSON.parse(readFileSync(baselinePath, "utf8"));
    expect(written.entries).toEqual([]);
    expect(written.siblingEntries).toEqual([triple("src/feature/calc.test.ts", "vi.mock", "src/feature/calc")]);
  });
});

describe("sibling mocks — sanctioned boundaries and non-code", () => {
  it.each([
    ["a Tauri wrapper", TAURI_WRAPPER],
    ["a Node filesystem wrapper", FS_WRAPPER],
    ["a wrapper re-exporting from a Tauri plugin", `export { open } from "@tauri-apps/plugin-dialog";\n`],
    ["a wrapper loading a builtin lazily", `export const sh = () => import("child_process");\n`],
  ])("does not count a relative mock of %s", (_label, source) => {
    const root = writeTree({
      "src/feature/io.ts": source,
      "src/feature/a.test.ts": `import { vi } from "vitest";\nvi.mock("./io");\n`,
    });
    const { status, stdout } = runGate(root, EMPTY);
    expect(status).toBe(0);
    expect(stdout).toContain("held");
  });

  it.each(["./styles.css", "./reader.css?raw", "./icon.svg"])("does not count a non-code target %s", (spec) => {
    const root = writeTree({
      "src/feature/styles.css": `.a{}\n`,
      "src/feature/a.test.ts": `import { vi } from "vitest";\nvi.mock(${JSON.stringify(spec)});\n`,
    });
    expect(runGate(root, EMPTY).status).toBe(0);
  });

  it("does not double-count a relative mock that resolves into src/stores/", () => {
    const root = writeTree({
      "src/stores/fooStore.ts": LOGIC,
      "src/hooks/a.test.ts": `import { vi } from "vitest";\nvi.mock("../stores/fooStore");\n`,
    });
    const { status, stderr } = runGate(root, {
      entries: [triple("src/hooks/a.test.ts", "vi.mock", "src/stores/fooStore")],
      siblingEntries: [],
    });
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
  });

  it("ignores bare package and @/ alias specifiers (not same-feature siblings)", () => {
    const root = writeTree({
      "src/feature/calc.ts": LOGIC,
      "src/feature/a.test.ts": `import { vi } from "vitest";\nvi.mock("@/feature/calc");\nvi.mock("katex");\n`,
    });
    expect(runGate(root, EMPTY).status).toBe(0);
  });
});
