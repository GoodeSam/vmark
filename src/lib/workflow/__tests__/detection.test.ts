// @vitest-environment node
// WI-LX2.1 — telling a VMark engine workflow apart from a GitHub Actions workflow.
import { describe, expect, it } from "vitest";
import { isEngineWorkflow } from "../detection";

const ENGINE = `name: Triage
steps:
  - id: rewrite
    uses: genie/rewrite-in-english
    with:
      input: hello
  - id: save
    uses: action/save-file
    needs: rewrite
    with:
      path: out.md
      input: \${{ steps.rewrite.outputs.text }}
`;

const GHA = `name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;

describe("isEngineWorkflow", () => {
  it("accepts the engine's shape: top-level steps whose uses name a VMark step type", () => {
    expect(isEngineWorkflow("/ws/flows/triage.yml", ENGINE)).toBe(true);
  });

  it.each(["genie/x", "action/read-file", "action/read-folder", "action/notify", "webhook/post"])(
    "accepts a step using %s",
    (uses) => {
      expect(isEngineWorkflow(null, `name: n\nsteps:\n  - uses: ${uses}\n`)).toBe(true);
    },
  );

  it("accepts quoted uses values", () => {
    expect(isEngineWorkflow(null, `name: n\nsteps:\n  - id: a\n    uses: "genie/x"\n`)).toBe(true);
    expect(isEngineWorkflow(null, `name: n\nsteps:\n  - uses: 'action/copy'\n`)).toBe(true);
  });

  it("accepts an engine file that also declares on: triggers — it has no jobs", () => {
    expect(isEngineWorkflow(null, `on:\n  manual: true\n${ENGINE}`)).toBe(true);
  });

  it("rejects a GitHub Actions workflow (top-level jobs:)", () => {
    expect(isEngineWorkflow(null, GHA)).toBe(false);
  });

  it("rejects anything under .github/workflows/, whatever it contains — GitHub owns that directory", () => {
    expect(isEngineWorkflow("/repo/.github/workflows/triage.yml", ENGINE)).toBe(false);
  });

  it("rejects a file with top-level steps AND jobs — ambiguity goes to the viewer, not the runner", () => {
    expect(isEngineWorkflow(null, `${ENGINE}jobs:\n  a:\n    runs-on: x\n`)).toBe(false);
  });

  it("rejects GitHub-style action references under a top-level steps: list", () => {
    // Azure Pipelines / composite-action lookalikes: steps, but not VMark's.
    expect(isEngineWorkflow(null, "steps:\n  - uses: actions/checkout@v4\n")).toBe(false);
    expect(isEngineWorkflow(null, "steps:\n  - script: echo hi\n")).toBe(false);
  });

  it("rejects steps nested under another key (a composite action's runs.steps)", () => {
    expect(isEngineWorkflow(null, "runs:\n  steps:\n    - uses: action/copy\n")).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   \n"],
    ["plain YAML", "name: x\nversion: 1\n"],
  ])("rejects %s content", (_label, content) => {
    expect(isEngineWorkflow("/x/config.yml", content)).toBe(false);
  });

  // Audit 20260928 round 2 (#123/#126): malformed YAML is never an engine
  // workflow. A text scan of broken YAML cannot tell a step's own `uses:` from
  // one nested in a flow value, so claiming it offered Run on a guess. A LIVE
  // run whose file stops parsing keeps its Cancel through the yaml adapter's
  // generic preview instead (#124).
  it("never claims malformed YAML, whatever it looks like", () => {
    expect(isEngineWorkflow(null, "name: [unclosed\nsteps:\n  - uses: genie/x\n")).toBe(false);
  });

  it("handles CRLF line endings", () => {
    expect(isEngineWorkflow(null, ENGINE.replace(/\n/g, "\r\n"))).toBe(true);
  });

  it("recognises a Windows path under .github\\workflows\\ as GitHub's", () => {
    expect(isEngineWorkflow("C:\\repo\\.github\\workflows\\triage.yml", ENGINE)).toBe(false);
  });
});

// Audit 20260928 #123/#126/#127 — the classifier reads the STRUCTURE: only a
// `uses:` that is a step's own key counts, and every YAML sequence form the
// workflow parser accepts is recognised.
describe("isEngineWorkflow — structure, not text (audit 20260928)", () => {
  it.each([
    ["a uses: under another top-level key", "steps:\n  - script: echo hi\nmetadata:\n  plugin:\n    uses: action/notify\n"],
    ["a uses: inside a block scalar", "steps:\n  - script: |\n      uses: action/notify\n"],
    ["a uses: nested under a step's with:", "steps:\n  - id: a\n    with:\n      uses: action/notify\n"],
    ["top-level steps that is a mapping, not a list", "steps:\n  uses: action/notify\n"],
  ])("rejects %s", (_label, content) => {
    expect(isEngineWorkflow(null, content)).toBe(false);
  });

  it.each([
    ["an indentationless sequence", "name: n\nsteps:\n- uses: action/notify\n"],
    ["an indentationless sequence whose uses is not the first key", "name: n\nsteps:\n- id: a\n  uses: genie/x\n"],
    ["a flow sequence", "name: n\nsteps: [{uses: action/notify}]\n"],
    ["a flow sequence spanning lines", "name: n\nsteps: [\n  {id: a, uses: 'genie/x'},\n]\n"],
  ])("accepts %s", (_label, content) => {
    expect(isEngineWorkflow(null, content)).toBe(true);
  });

  it.each([
    ["an indented step", "name: [unclosed\nsteps:\n  - id: a\n    uses: genie/x\n"],
    ["an indentationless step", "name: [unclosed\nsteps:\n- uses: genie/x\n"],
    ["a flow sequence on the steps line", "name: [unclosed\nsteps: [{uses: action/notify}]\n"],
    ["a uses: nested in a flow value", "name: [unclosed\nsteps: [{script: {uses: action/notify}}]\n"],
    ["a uses: in a step's flow with:", "name: [unclosed\nsteps:\n  - with: {uses: action/notify}\n"],
    ["a duplicate key", "name: a\nname: b\nsteps:\n  - uses: action/notify\n"],
  ])("never claims malformed YAML: %s", (_label, content) => {
    expect(isEngineWorkflow(null, content)).toBe(false);
  });
});
