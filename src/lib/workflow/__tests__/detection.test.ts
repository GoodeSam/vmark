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

  it("still claims malformed YAML with the engine's shape, so the panel can show the parse error", () => {
    expect(isEngineWorkflow(null, "name: [unclosed\nsteps:\n  - uses: genie/x\n")).toBe(true);
  });

  it("handles CRLF line endings", () => {
    expect(isEngineWorkflow(null, ENGINE.replace(/\n/g, "\r\n"))).toBe(true);
  });

  it("recognises a Windows path under .github\\workflows\\ as GitHub's", () => {
    expect(isEngineWorkflow("C:\\repo\\.github\\workflows\\triage.yml", ENGINE)).toBe(false);
  });
});
