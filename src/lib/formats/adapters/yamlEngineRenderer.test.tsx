// WI-LX2.1 — a VMark engine workflow opened as a .yml file gets the Run/Cancel panel, behind the engine flag.
/**
 * The finding this closes: the engine's panel mounted only inside the MARKDOWN
 * surface, and `.yml` always routes to the yaml adapter — so with the engine
 * on, no workflow file could ever show Run. The yaml adapter now declares a
 * `vmark-workflow` schema; its renderer is the run panel when the engine is on
 * and the plain YAML tree when it is off.
 *
 * Only the IPC boundary and the React Flow canvas are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@/plugins/workflowPreview/WorkflowPreview", () => ({
  WorkflowPreview: ({ graph }: { graph: { steps: unknown[] } }) => (
    <div data-testid="engine-graph">{graph.steps.length} steps</div>
  ),
}));

import { yamlFormat } from "./yaml";
import * as rendererModule from "./yamlEngineRenderer";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { PreviewRendererProps } from "../types";

const ENGINE = `name: Triage
steps:
  - id: rewrite
    uses: genie/rewrite-in-english
    with:
      input: hi
  - id: save
    uses: action/save-file
    needs: rewrite
    with:
      path: out.md
      input: done
`;
const initialAdvanced = useSettingsStore.getState().advanced;

function setEngine(on: boolean) {
  useSettingsStore.setState({
    advanced: { ...useSettingsStore.getState().advanced, workflowEngine: on },
  });
}

function props(content: string): PreviewRendererProps {
  return { content, liveContent: content, path: "/ws/triage.yml", diagnostics: [], tabId: "tab-1" };
}

function renderSchema(content: string) {
  const Renderer = yamlFormat.schemaRenderers!["vmark-workflow"];
  return render(createElement(Renderer, props(content)));
}

beforeEach(() => {
  useWorkspaceStore.setState({ rootPath: "/ws" } as never);
});

afterEach(() => {
  useSettingsStore.setState({ advanced: initialAdvanced });
});

describe("the vmark-workflow schema renderer", () => {
  it("engine ON: shows the step graph with a Run button", async () => {
    setEngine(true);
    renderSchema(ENGINE);
    expect(await screen.findByTestId("engine-graph", {}, { timeout: 15_000 })).toHaveTextContent(
      "2 steps",
    );
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "workflow:run.start" })).toBeEnabled();
  });

  it("engine ON: a workflow that does not validate shows why, and Run stays off", async () => {
    setEngine(true);
    renderSchema("steps:\n  - uses: action/notify\n");
    expect(
      await screen.findByText("Workflow must have a 'name' field", {}, { timeout: 15_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "workflow:run.start" })).toBeDisabled();
  });

  it("engine OFF: the file is plain YAML to VMark — the generic tree, no Run button", async () => {
    setEngine(false);
    const { container } = renderSchema(ENGINE);
    await waitFor(() =>
      expect(container.querySelector('.json-tree-preview[data-format="yaml"]')).not.toBeNull(),
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.queryByTestId("engine-graph")).toBeNull();
  });
});

describe("yamlEngineRenderer module contract", () => {
  it("exports the renderer under the name the adapter's lazy import maps", () => {
    expect(typeof rendererModule.EngineWorkflowSchemaRenderer).toBe("function");
    expect(rendererModule.EngineWorkflowSchemaRenderer.length).toBe(1);
  });
});
