/**
 * Purpose: Step-to-step navigation for the step form — back to the job,
 *   previous/next step, and Alt+Left / Alt+Right on the window.
 *
 * Key decisions:
 *   - The shortcut listens on the window so the form need not be focused.
 *   - It bails out inside an editable surface (input, textarea, select,
 *     contenteditable, CodeMirror) so native Alt+Arrow word navigation keeps
 *     working, and when another handler already called preventDefault.
 *   - Focus restoration after the step→step remount is owned by
 *     WorkflowEditorPanel (`useStepFocusRestore`): a remounted form cannot
 *     tell whether its mount came from navigation.
 *
 * @coordinates-with src/components/Editor/WorkflowEditor/StepForm.tsx — the consumer
 * @coordinates-with src/stores/workflowStore.ts — selectStep / selectJob
 * @module components/Editor/WorkflowEditor/useStepNavigation
 */
import { useEffect } from "react";
import { useWorkflowStore } from "@/stores/workflowStore";

function isEditableTarget(target: EventTarget | null): boolean {
  // The instanceof check handles Window/Document/null targets that don't
  // expose tagName/closest/isContentEditable.
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    target.closest(".cm-editor") !== null
  );
}

export function useStepNavigation(
  jobId: string,
  prevStepId: string | null,
  nextStepId: string | null,
) {
  const goToStep = (stepId: string | null): void => {
    if (!stepId) return;
    useWorkflowStore.getState().selectStep(jobId, stepId);
  };
  const backToJob = (): void => {
    useWorkflowStore.getState().selectJob(jobId);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey) return;
      if (e.defaultPrevented) return;
      if (isEditableTarget(e.target)) return;
      if (e.key === "ArrowLeft" && prevStepId) {
        e.preventDefault();
        goToStep(prevStepId);
      } else if (e.key === "ArrowRight" && nextStepId) {
        e.preventDefault();
        goToStep(nextStepId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // jobId is captured into goToStep via useWorkflowStore.getState();
    // we only need to refresh the listener when prev/next change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevStepId, nextStepId]);

  return { goToStep, backToJob };
}
