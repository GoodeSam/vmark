/**
 * Source Workflow Preview Plugin
 *
 * Purpose: When the MARKDOWN Source editor edits a YAML file (a `.yml`
 * associated with markdown in Settings → Formats — ordinary `.yml` files use
 * the yaml adapter's own `vmark-workflow` preview instead), debounces YAML
 * parsing and feeds the result through `workflowPort` (the workflow store) so
 * the WorkflowSidePanel shows a live React Flow graph.
 *
 * Key decisions (WI-LX2.4):
 *   - Parses the document it OPENS with. It used to wait for a `docChanged`
 *     update, so a workflow file opened as-is never showed its panel until the
 *     user typed.
 *   - Leaving the file clears the graph and closes the panel but does NOT
 *     reset the slice: `resetPreview` also dropped a live run's registration,
 *     and the run's events then stopped routing to anything.
 *
 * @coordinates-with workflowPort.ts — the store port that receives graph/parseError (bound to stores/workflowStore.ts)
 * @coordinates-with parser.ts — parseWorkflow, isWorkflowYaml
 * @module plugins/codemirror/sourceWorkflowPreview
 */

import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { workflowPort } from "./workflowPort";
import { parseWorkflow, isWorkflowYaml, WorkflowParseError, WorkflowValidationError } from "@/lib/workflow/parser";
import { workflowLog, workflowWarn } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

const DEBOUNCE_MS = 300;

class SourceWorkflowPreviewPlugin {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastContent = "";

  constructor(view: EditorView) {
    this.schedule(view.state.doc.toString());
  }

  update(update: ViewUpdate) {
    if (!update.docChanged) return;
    this.schedule(update.state.doc.toString());
  }

  /** Debounced parse of `content`, skipping a repeat of the last one. */
  private schedule(content: string) {
    if (content === this.lastContent) return;
    this.lastContent = content;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.parseAndUpdate(content);
    }, DEBOUNCE_MS);
  }

  private parseAndUpdate(content: string) {
    if (!isWorkflowYaml(content)) {
      workflowPort().getState().setGraph(null);
      workflowPort().getState().previewClosePanel();
      return;
    }

    try {
      const graph = parseWorkflow(content);
      workflowLog("Parsed workflow:", graph.name, `(${graph.steps.length} steps)`);
      workflowPort().getState().setGraph(graph);
      // Auto-open the panel if a valid workflow is detected
      if (!workflowPort().getState().preview.panelOpen) {
        workflowPort().getState().previewOpenPanel();
      }
    } catch (e) {
      if (e instanceof WorkflowParseError || e instanceof WorkflowValidationError) {
        workflowWarn("Workflow parse error:", e.message);
        workflowPort().getState().setGraph(null, e.message);
      } else {
        workflowWarn("Unexpected parse error:", errorMessage(e));
        workflowPort().getState().setGraph(
          null,
          errorMessage(e),
        );
      }
    }
  }

  destroy() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    // Leaving the workflow file: no graph, no panel — and a live run keeps
    // its registration, so its events still route (see the header).
    workflowPort().getState().setGraph(null);
    workflowPort().getState().previewClosePanel();
  }
}

function createSourceWorkflowPreviewPlugin() {
  return ViewPlugin.fromClass(SourceWorkflowPreviewPlugin);
}

export const sourceWorkflowPreviewExtensions = [createSourceWorkflowPreviewPlugin()];
