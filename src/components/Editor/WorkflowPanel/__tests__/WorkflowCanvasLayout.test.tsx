// WI-LX2.4 — the layout toggle re-lays the nodes out and refits the viewport.
/**
 * `WorkflowCanvas.test.tsx` toggles the direction on ONE disconnected node, and
 * one node sits in the same place top-down or left-to-right — so it pinned the
 * handle sides and nothing about the layout (audit fix-round #100). These cases
 * use a dependency chain, where the two directions place the nodes differently.
 *
 * `fitView` on `<ReactFlow>` fits only the INITIAL nodes; a re-layout that
 * moves them needs an explicit refit or a long chain lands off-screen (audit
 * fix-round #101). jsdom has no layout, so the refit is observed at its
 * boundary — the instance's `fitView` — rather than by measuring a viewport.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fitView = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useReactFlow: (...args: Parameters<typeof actual.useReactFlow>) => ({
      ...actual.useReactFlow(...args),
      fitView,
    }),
  };
});

import { useWorkflowStore } from "@/stores/workflowStore";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";
import { WorkflowCanvasInner } from "../WorkflowCanvasInner";

beforeEach(() => {
  fitView.mockClear();
  useWorkflowStore.getState().setLayoutDirection("TD");
  // jsdom gaps xyflow reaches: an observer (a no-op is enough — see
  // WorkflowCanvas.test.tsx) and the viewport matrix a re-layout reads.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  const matrixWindow = window as unknown as { DOMMatrixReadOnly?: unknown };
  matrixWindow.DOMMatrixReadOnly ??= class {
    m22 = 1;
  };
});

/** `build` → `test` → `deploy`, each needing the one before. */
function chain(): WorkflowIR {
  const ids = ["build", "test", "deploy"];
  return {
    triggers: [],
    permissions: {},
    env: {},
    positions: {},
    diagnostics: [],
    jobs: ids.map((id, i) => ({
      id,
      needs: i === 0 ? [] : [ids[i - 1]],
      steps: [],
      position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    })),
  };
}

/** A node's laid-out position, read from the transform xyflow renders. */
function position(container: HTMLElement, id: string): { x: number; y: number } {
  const node = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
  const match = node?.style.transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
  if (!match) throw new Error(`no laid-out position for node ${id}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

describe("WorkflowCanvasInner — layout direction", () => {
  it("lays a dependency chain out downwards, then across when toggled", async () => {
    const { container } = render(<WorkflowCanvasInner workflow={chain()} />);
    await waitFor(() => expect(container.querySelector('[data-id="deploy"]')).not.toBeNull());

    const [a, b, c] = ["build", "test", "deploy"].map((id) => position(container, id));
    expect(b.y).toBeGreaterThan(a.y);
    expect(c.y).toBeGreaterThan(b.y);
    expect(b.x).toBe(a.x);

    fireEvent.click(screen.getByRole("button", { name: "Lay out left to right" }));

    await waitFor(() => expect(position(container, "test").x).toBeGreaterThan(position(container, "build").x));
    const [a2, b2, c2] = ["build", "test", "deploy"].map((id) => position(container, id));
    expect(c2.x).toBeGreaterThan(b2.x);
    expect(b2.y).toBe(a2.y);
    // Edges attach where the layout put the neighbours.
    expect(container.querySelector(".react-flow__handle-left")).not.toBeNull();
    expect(container.querySelector(".react-flow__handle-top")).toBeNull();
  });

  it("refits the viewport after the direction changes — not only on first render", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { container } = render(<WorkflowCanvasInner workflow={chain()} />);
      await waitFor(() => expect(container.querySelector('[data-id="deploy"]')).not.toBeNull());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      const before = fitView.mock.calls.length;

      fireEvent.click(screen.getByRole("button", { name: "Lay out left to right" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(fitView.mock.calls.length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
