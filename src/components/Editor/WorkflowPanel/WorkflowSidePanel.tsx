/**
 * Workflow Side Panel
 *
 * Purpose: the engine's run panel as a resizable right-hand dock inside the
 * MARKDOWN surface. That surface edits a YAML file only when the user has
 * associated `.yml`/`.yaml` with markdown (Settings → Formats); in Source mode
 * `sourceWorkflowPreview` parses the file into the workflow store and opens
 * this panel. The ordinary path for a `.yml` engine workflow is the yaml
 * adapter's split pane, which mounts the same `WorkflowRunPanel` directly.
 *
 * Runs ITS tab's document (`tabId`, from the surface that mounts it) — never
 * the active tab of window "main", which is what it used to read (WI-LX2.2).
 *
 * @coordinates-with stores/workflowStore.ts — panel open state + parsed graph
 * @coordinates-with components/Editor/WorkflowPanel/WorkflowRunPanel.tsx — the panel body
 * @coordinates-with components/Editor/WorkflowPanel/WorkflowEngineSlot.tsx — the gated mount
 * @coordinates-with plugins/codemirror/sourceWorkflowPreview.ts — opens it
 * @module components/Editor/WorkflowPanel/WorkflowSidePanel
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useWorkflowStore } from "@/stores/workflowStore";
import { WorkflowRunPanel } from "./WorkflowRunPanel";
import "./workflow-side-panel.css";

const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH_RATIO = 0.8; // max 80% of container
const DEFAULT_PANEL_WIDTH = 400;

export function WorkflowSidePanel({ tabId }: { tabId: string | null }) {
  const { t } = useTranslation();
  const panelOpen = useWorkflowStore((s) => s.preview.panelOpen);
  const graph = useWorkflowStore((s) => s.preview.graph);
  const parseError = useWorkflowStore((s) => s.preview.parseError);

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const panelRef = useRef<HTMLDivElement>(null);

  // Resize handler refs for cleanup (project convention: rules/50 section 2)
  const handlersRef = useRef<{
    move: ((e: MouseEvent) => void) | null;
    up: (() => void) | null;
  }>({ move: null, up: null });

  const cleanup = useCallback(() => {
    if (handlersRef.current.move) {
      document.removeEventListener("mousemove", handlersRef.current.move);
    }
    if (handlersRef.current.up) {
      document.removeEventListener("mouseup", handlersRef.current.up);
    }
    handlersRef.current = { move: null, up: null };
  }, []);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    cleanup(); // Clean up any previous handlers

    const startX = e.clientX;
    const startWidth = panelWidth;
    const containerWidth = panelRef.current?.parentElement?.clientWidth ?? window.innerWidth;
    const maxWidth = containerWidth * MAX_PANEL_WIDTH_RATIO;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      setPanelWidth(Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, startWidth + delta)));
    };

    const onUp = () => {
      cleanup();
    };

    handlersRef.current = { move: onMove, up: onUp };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [panelWidth, cleanup]);

  if (!panelOpen) return null;

  return (
    <div
      className="workflow-side-panel"
      style={{ width: panelWidth }}
      ref={panelRef}
    >
      <div
        className="workflow-side-panel__resize-handle"
        onMouseDown={handleResizeStart}
        role="separator"
        aria-label={t("common:resize")}
      />
      <WorkflowRunPanel tabId={tabId} graph={graph} parseError={parseError} />
    </div>
  );
}
