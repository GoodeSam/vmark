// @vitest-environment node
// WI-LX2.4 — serializeWithPatches' discriminated outcome and its formatting modes (CST-preserving vs normalised).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as yamlParse } from "yaml";
import type { IRPatch } from "@/lib/ghaWorkflow/save/mutators";
import { useSettingsStore } from "@/stores/settingsStore";
import { serializeWithPatches, type WorkflowSerializeResult } from "./workflowSerialize";

// ─── Fixtures ────────────────────────────────────────────────────────

/** A small but real workflow, in the block style the CST path reproduces byte-for-byte. */
const CI_YAML = `# Continuous integration
name: CI
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest # the default runner
    steps:
      - uses: actions/checkout@v4
      - name: Test
        run: pnpm test
`;

/** The same document with no comments, already in the normalised stringify style. */
const PLAIN_YAML = `name: CI
on:
  push:
    branches:
      - main
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Test
        run: pnpm test
`;

const RENAME: IRPatch = { kind: "workflow.set", path: "name", value: "Release" };

/** Anchors nested five deep, ten wide: 10^5 expanded nodes — past the alias bound. */
function aliasBomb(): string {
  const item = (alias: string) => Array.from({ length: 10 }, () => alias).join(", ");
  return [
    "name: CI",
    `x-a: &a [${item("lol")}]`,
    `x-b: &b [${item("*a")}]`,
    `x-c: &c [${item("*b")}]`,
    `x-d: &d [${item("*c")}]`,
    `x-e: [${item("*d")}]`,
    "",
  ].join("\n");
}

function expectApplied(result: WorkflowSerializeResult): string {
  if (result.status !== "applied") {
    throw new Error(`expected "applied", got ${JSON.stringify(result)}`);
  }
  return result.yaml;
}

function expectFailure(
  result: WorkflowSerializeResult,
  status: "parse-failed" | "apply-failed",
): string {
  if (result.status !== status) {
    throw new Error(`expected "${status}", got ${JSON.stringify(result)}`);
  }
  return result.detail;
}

// ─── Settings isolation (the `null` override reads the user's setting) ─

const initialAdvanced = useSettingsStore.getState().advanced;

function setPreserveSetting(value: boolean): void {
  useSettingsStore.setState({
    advanced: { ...useSettingsStore.getState().advanced, workflowEditorPreserveYamlFormatting: value },
  });
}

beforeEach(() => {
  useSettingsStore.setState({ advanced: initialAdvanced });
});

afterEach(() => {
  useSettingsStore.setState({ advanced: initialAdvanced });
});

// ─── no-patches ──────────────────────────────────────────────────────

describe("serializeWithPatches — nothing queued", () => {
  it.each<{ name: string; yaml: string; preserve: boolean | null }>([
    { name: "a valid workflow", yaml: CI_YAML, preserve: true },
    { name: "an empty document", yaml: "", preserve: false },
    { name: "a document that does not parse", yaml: "name: [unclosed\n", preserve: null },
  ])("reports no-patches for $name without looking at the text", ({ yaml, preserve }) => {
    expect(serializeWithPatches(yaml, [], preserve)).toEqual({ status: "no-patches" });
  });
});

// ─── applied ─────────────────────────────────────────────────────────

describe("serializeWithPatches — applied", () => {
  it("preserve=true keeps every comment and changes only the edited line", () => {
    const yaml = expectApplied(serializeWithPatches(CI_YAML, [RENAME], true));
    expect(yaml).toBe(CI_YAML.replace("name: CI\n", "name: Release\n"));
  });

  it("preserve=false applies the edit but normalises the text, dropping comments", () => {
    const yaml = expectApplied(serializeWithPatches(CI_YAML, [RENAME], false));
    expect(yaml).not.toContain("#");
    expect(yamlParse(yaml)).toEqual({ ...yamlParse(CI_YAML), name: "Release" });
  });

  it("both modes agree on the resulting data", () => {
    const kept = expectApplied(serializeWithPatches(CI_YAML, [RENAME], true));
    const normalised = expectApplied(serializeWithPatches(CI_YAML, [RENAME], false));
    expect(yamlParse(kept)).toEqual(yamlParse(normalised));
  });

  it("applies the queue in order, so a later write to one path wins", () => {
    const patches: IRPatch[] = [
      { kind: "workflow.set", path: "name", value: "First" },
      { kind: "workflow.set", path: "name", value: "Second" },
    ];
    const yaml = expectApplied(serializeWithPatches(CI_YAML, patches, true));
    expect(yamlParse(yaml)).toMatchObject({ name: "Second" });
  });

  it("applies a mixed queue of real patches across workflow, job, step and trigger", () => {
    const patches: IRPatch[] = [
      { kind: "job.set", jobId: "build", path: "runs-on", value: "macos-latest" },
      { kind: "with.set", jobId: "build", stepIndex: 0, key: "fetch-depth", value: 0 },
      { kind: "step.set", jobId: "build", stepIndex: 1, path: "name", value: "Unit tests" },
      { kind: "trigger.setFilters", event: "push", filter: "branches", value: ["main", "release/*"] },
      { kind: "workflow.concurrency.set", value: { group: "ci", cancelInProgress: true } },
    ];
    const yaml = expectApplied(serializeWithPatches(CI_YAML, patches, true));
    expect(yaml).toContain("# Continuous integration");
    expect(yaml).toContain("# the default runner");
    expect(yamlParse(yaml)).toEqual({
      name: "CI",
      on: { push: { branches: ["main", "release/*"] } },
      jobs: {
        build: {
          "runs-on": "macos-latest",
          steps: [
            { uses: "actions/checkout@v4", with: { "fetch-depth": 0 } },
            { name: "Unit tests", run: "pnpm test" },
          ],
        },
      },
      concurrency: { group: "ci", "cancel-in-progress": true },
    });
  });

  it("carries a CJK value through the CST path verbatim", () => {
    const yaml = expectApplied(
      serializeWithPatches(CI_YAML, [{ kind: "workflow.set", path: "name", value: "构建 · 测试" }], true),
    );
    expect(yaml).toContain("name: 构建 · 测试\n");
    expect(yaml).toContain("# Continuous integration");
  });

  it("builds a document from an empty input", () => {
    const yaml = expectApplied(serializeWithPatches("", [RENAME], true));
    expect(yamlParse(yaml)).toEqual({ name: "Release" });
  });

  it("keeps an anchor and its alias as written on the CST path", () => {
    const source = "name: CI\nenv: &shared\n  NODE: '20'\njobs:\n  build:\n    runs-on: ubuntu-latest\n    env: *shared\n";
    const yaml = expectApplied(serializeWithPatches(source, [RENAME], true));
    expect(yaml).toContain("&shared");
    expect(yaml).toContain("env: *shared");
  });

  it("expands an honest alias on the normalised path", () => {
    const source = "name: CI\nenv: &shared\n  NODE: '20'\njobs:\n  build:\n    runs-on: ubuntu-latest\n    env: *shared\n";
    const yaml = expectApplied(serializeWithPatches(source, [RENAME], false));
    expect(yaml).not.toContain("*shared");
    expect(yamlParse(yaml)).toMatchObject({ jobs: { build: { env: { NODE: "20" } } } });
  });
});

// ─── unchanged ───────────────────────────────────────────────────────

describe("serializeWithPatches — unchanged", () => {
  it.each<{ name: string; patch: IRPatch }>([
    { name: "a write of the value already there", patch: { kind: "workflow.set", path: "name", value: "CI" } },
    { name: "an edit to a job that does not exist", patch: { kind: "job.set", jobId: "ghost", path: "runs-on", value: "x" } },
    { name: "an out-of-range step", patch: { kind: "step.set", jobId: "build", stepIndex: 9, path: "name", value: "x" } },
    { name: "removing a need that is not there", patch: { kind: "needs.remove", jobId: "build", ref: "lint" } },
    { name: "a filter on an event the workflow lacks", patch: { kind: "trigger.setFilters", event: "release", filter: "types", value: ["published"] } },
  ])("preserve=true reports unchanged for $name", ({ patch }) => {
    expect(serializeWithPatches(CI_YAML, [patch], true)).toEqual({ status: "unchanged" });
  });

  it("preserve=false reports unchanged when the text is already in normalised form", () => {
    const noOp: IRPatch = { kind: "job.set", jobId: "ghost", path: "runs-on", value: "x" };
    expect(serializeWithPatches(PLAIN_YAML, [noOp], false)).toEqual({ status: "unchanged" });
  });

  it("an edit followed by its inverse nets out to unchanged", () => {
    const patches: IRPatch[] = [
      { kind: "workflow.set", path: "name", value: "Temp" },
      { kind: "workflow.set", path: "name", value: "CI" },
    ];
    expect(serializeWithPatches(CI_YAML, patches, true)).toEqual({ status: "unchanged" });
  });
});

// ─── preserve=null defers to the user's setting ───────────────────────

describe("serializeWithPatches — preserve=null reads the setting", () => {
  it("setting on: the CST path, comments kept", () => {
    setPreserveSetting(true);
    const yaml = expectApplied(serializeWithPatches(CI_YAML, [RENAME], null));
    expect(yaml).toBe(CI_YAML.replace("name: CI\n", "name: Release\n"));
  });

  it("setting off: the normalised path, comments dropped", () => {
    setPreserveSetting(false);
    const yaml = expectApplied(serializeWithPatches(CI_YAML, [RENAME], null));
    expect(yaml).not.toContain("#");
  });

  it("an explicit override beats the setting in both directions", () => {
    setPreserveSetting(false);
    expect(expectApplied(serializeWithPatches(CI_YAML, [RENAME], true))).toContain("# the default runner");
    setPreserveSetting(true);
    expect(expectApplied(serializeWithPatches(CI_YAML, [RENAME], false))).not.toContain("#");
  });

  it("a settings object that predates the key falls back to preserving", () => {
    const { workflowEditorPreserveYamlFormatting: _dropped, ...legacy } = initialAdvanced;
    useSettingsStore.setState({ advanced: legacy as typeof initialAdvanced });
    const yaml = expectApplied(serializeWithPatches(CI_YAML, [RENAME], null));
    expect(yaml).toContain("# Continuous integration");
  });
});

// ─── parse-failed ────────────────────────────────────────────────────

describe("serializeWithPatches — parse-failed", () => {
  it.each<{ name: string; yaml: string }>([
    { name: "an unterminated flow sequence", yaml: "name: [unclosed\n" },
    { name: "a duplicate key", yaml: "name: a\nname: b\n" },
    { name: "a tab used for indentation", yaml: "jobs:\n\tbuild: {}\n" },
  ])("reports parse-failed with a detail for $name", ({ yaml }) => {
    const detail = expectFailure(serializeWithPatches(yaml, [RENAME], true), "parse-failed");
    expect(detail.length).toBeGreaterThan(0);
  });

  it.each([true, false, null])("fails to parse the same way whatever preserve=%s says", (preserve) => {
    expect(serializeWithPatches("name: [unclosed\n", [RENAME], preserve).status).toBe("parse-failed");
  });

  it("joins every parser error into the one detail line", () => {
    const detail = expectFailure(
      serializeWithPatches("name: a\nname: b\non: c\non: d\n", [RENAME], true),
      "parse-failed",
    );
    expect(detail.split("; ").length).toBeGreaterThanOrEqual(2);
  });
});

// ─── apply-failed ────────────────────────────────────────────────────

describe("serializeWithPatches — apply-failed", () => {
  it.each<{ name: string; yaml: string }>([
    { name: "a bare scalar", yaml: "just a string\n" },
    { name: "a top-level sequence", yaml: "- one\n- two\n" },
  ])("a document whose root is $name cannot take a top-level field", ({ yaml }) => {
    // A sequence root accepts `set` only for integer keys, a scalar root not at
    // all — either way the patch throws, and the failure is named, not thrown.
    const result = serializeWithPatches(yaml, [RENAME], true);
    expect(result.status).toBe("apply-failed");
  });

  it("refuses to expand an alias bomb on the normalised path", () => {
    const detail = expectFailure(serializeWithPatches(aliasBomb(), [RENAME], false), "apply-failed");
    expect(detail).toMatch(/alias/i);
  });

  it("the same alias bomb is written back unexpanded on the CST path", () => {
    const yaml = expectApplied(serializeWithPatches(aliasBomb(), [RENAME], true));
    expect(yaml).toContain("name: Release");
    expect(yaml).toContain("x-e: [*d");
  });

  it("never throws, and reports the failure rather than echoing the input", () => {
    const run = () => serializeWithPatches(aliasBomb(), [RENAME], false);
    expect(run).not.toThrow();
    expect(run()).not.toHaveProperty("yaml");
  });
});

// WI-LX2.4 — a Windows-line-ending file keeps its line endings. The CST
// stringifier writes LF, so every save rewrote every line of a CRLF file, and
// a patch that changed nothing reported `applied` instead of `unchanged`.
describe("serializeWithPatches — CRLF documents", () => {
  const CRLF = PLAIN_YAML.replace(/\n/g, "\r\n");

  it("writes the edit back with CRLF line endings", () => {
    const yaml = expectApplied(serializeWithPatches(CRLF, [RENAME], true));
    expect(yaml).toContain("name: Release\r\n");
    expect(yaml.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("a patch that changes nothing on a CRLF file is `unchanged`", () => {
    const same: IRPatch = { kind: "workflow.set", path: "name", value: "CI" };
    expect(serializeWithPatches(CRLF, [same], true)).toEqual({ status: "unchanged" });
  });

  it("an LF file stays LF", () => {
    const yaml = expectApplied(serializeWithPatches(PLAIN_YAML, [RENAME], true));
    expect(yaml).not.toContain("\r");
  });
});
