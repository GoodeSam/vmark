/**
 * EngineWorkflowSchemaRenderer — the yaml adapter's `vmark-workflow` preview.
 *
 * Purpose: give a VMark engine workflow file (`name:` + top-level `steps:`
 *   using `genie/`, `action/` or `webhook/` — see `lib/workflow/detection.ts`)
 *   the engine's Run/Cancel panel in the split pane's preview side. Before
 *   WI-LX2.1 that panel mounted only inside the MARKDOWN surface, and a `.yml`
 *   file never reaches that surface, so with the engine on no workflow file
 *   could be run from the editor at all.
 *
 *   Reached only through `React.lazy` from the adapter, for the same cold-start
 *   reason as `yamlWorkflowRenderer` (the adapter is always registered), and
 *   only while `advanced.workflowEngine` is on — the adapter's wrapper renders
 *   the plain YAML tree otherwise, so this chunk is never fetched for a user
 *   who has not asked for the engine.
 *
 * Key decisions:
 *   - The graph comes from this component's own parse of the (deferred)
 *     preview content, like the GitHub Actions renderer — preview-only view
 *     mode unmounts the source pane, so nothing else could keep it current.
 *   - Run executes the document's LIVE content: the panel reads it from the
 *     document store for its tab at click time, never the deferred copy drawn
 *     here (`PreviewRendererProps.liveContent` explains why that matters).
 *
 * @coordinates-with lib/formats/adapters/yaml.tsx — the flag gate and the lazy mount
 * @coordinates-with components/Editor/WorkflowPanel/WorkflowRunPanel.tsx — the panel
 * @coordinates-with lib/workflow/parser.ts — parseWorkflow
 * @module lib/formats/adapters/yamlEngineRenderer
 */
import { useMemo } from "react";
import { parseWorkflow } from "@/lib/workflow/parser";
import { WorkflowRunPanel } from "@/components/Editor/WorkflowPanel/WorkflowRunPanel";
import { errorMessage } from "@/utils/errorMessage";
import type { PreviewRendererProps } from "../types";

export function EngineWorkflowSchemaRenderer({ content, tabId }: PreviewRendererProps) {
  const parsed = useMemo(() => {
    try {
      return { graph: parseWorkflow(content), error: null };
    } catch (error) {
      return { graph: null, error: errorMessage(error) };
    }
  }, [content]);

  return <WorkflowRunPanel tabId={tabId ?? null} graph={parsed.graph} parseError={parsed.error} />;
}
