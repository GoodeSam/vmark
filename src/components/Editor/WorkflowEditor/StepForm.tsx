/**
 * Purpose: Edit form for one step inside a job. Handles both `uses:`
 *   and `run:` step kinds. The `with:` block renders as key/value
 *   rows; users can add, edit, or remove individual keys, each
 *   producing a typed IRPatch. The component owns layout; the logic
 *   lives in `useStepNavigation` (back/prev/next and Alt+Arrow),
 *   `useStepFields` (scalar fields and the expand editor) and
 *   `useStepWithRows` (the `with:` rows and action-metadata suggestions).
 *
 * Origin: GitHub Actions workflow viewer plan (2026-05-04, retired) §6
 *   Phase 7 / WI-7.1 + WI-7.2.
 *
 * Key decisions:
 *   - `uses:` is read-only in this form (Phase 7). Changing the action
 *     reference is a structural edit better expressed in source until
 *     a dedicated action picker exists.
 *   - `with:` rows hold local state and commit on blur through the pure
 *     plans in withRowPlans.ts (see `useStepWithRows`).
 *   - `with:` key suggestions, required-input warnings and default
 *     placeholders come from the action's metadata (`useActionMetadata`,
 *     setting-gated); a failed fetch falls back to free-form rows.
 *
 * @coordinates-with src/stores/workflowStore.ts — IRPatch sink
 * @module components/Editor/WorkflowEditor/StepForm
 */

import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, ArrowUp } from "lucide-react";
import type { StepIR } from "@/lib/ghaWorkflow/types";
import { ExpressionEditor } from "./ExpressionEditor";
import { useStepFields } from "./useStepFields";
import { useStepNavigation } from "./useStepNavigation";
import { useStepWithRows } from "./useStepWithRows";
import "./workflow-editor.css";

interface StepFormProps {
  jobId: string;
  stepIndex: number;
  step: StepIR;
  /** The PRE-EDIT step — what a field (and a `with:` row) compares itself
   *  against to decide the user has reverted it. `step` is the preview and
   *  already carries this step's queued edits, so comparing against it
   *  cancelled the edit just committed (audit R2, #1020). Defaults to `step`,
   *  which is only the same thing while nothing is queued. */
  baseline?: StepIR | undefined;
  /** Total number of steps in this job — used to render N of M.
   *  Optional for unit tests that render the form in isolation; production
   *  callers (WorkflowEditorPanel) always provide it. Defaults to
   *  `stepIndex + 1` so the position label degrades to "Step N of N". */
  stepCount?: number;
  /** Step id to navigate to with Prev. null/undefined disables the button. */
  prevStepId?: string | null;
  /** Step id to navigate to with Next. null/undefined disables the button. */
  nextStepId?: string | null;
}

export function StepForm({
  jobId,
  stepIndex,
  step,
  baseline = step,
  stepCount,
  prevStepId = null,
  nextStepId = null,
}: StepFormProps): ReactElement {
  const totalSteps = stepCount ?? stepIndex + 1;
  const { t } = useTranslation("workflowEditor");

  const { goToStep, backToJob } = useStepNavigation(jobId, prevStepId, nextStepId);
  const {
    name, setName, run, setRun, workingDir, setWorkingDir, ifCond, setIfCond,
    expand, setExpand, commitField, handleExpandSave,
  } = useStepFields({ jobId, stepIndex, step, baseline });
  const {
    withRows, metadataResult, inputs, setKeys, missingRequired, datalistId, knownInputKeys,
    addSuggestedKey, updateRow, commitWithRow, removeRow, addRow,
  } = useStepWithRows({ jobId, stepIndex, step, baseline });

  return (
    <form className="workflow-form" onSubmit={(e) => e.preventDefault()}>
      <header className="workflow-form__header workflow-form__header--step">
        <button
          type="button" data-step-nav="back-to-job"
          className="vm-icon-btn vm-icon-btn--sm workflow-form__nav-btn"
          onClick={backToJob}
          aria-label={t("form.step.nav.backToJob", {
            defaultValue: "Back to job",
          })}
          title={t("form.step.nav.backToJob", { defaultValue: "Back to job" })}
        >
          <ArrowUp size={14} />
        </button>
        <button
          type="button" data-step-nav="prev"
          className="vm-icon-btn vm-icon-btn--sm workflow-form__nav-btn"
          onClick={() => goToStep(prevStepId)}
          disabled={!prevStepId}
          aria-label={t("form.step.nav.prev", {
            defaultValue: "Previous step (Alt+Left)",
          })}
          title={t("form.step.nav.prev", {
            defaultValue: "Previous step (Alt+Left)",
          })}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="workflow-form__step-position">
          {t("form.step.nav.position", {
            defaultValue: "Step {{current}} of {{total}}",
            current: stepIndex + 1,
            total: totalSteps,
          })}
        </span>
        <button
          type="button" data-step-nav="next"
          className="vm-icon-btn vm-icon-btn--sm workflow-form__nav-btn"
          onClick={() => goToStep(nextStepId)}
          disabled={!nextStepId}
          aria-label={t("form.step.nav.next", {
            defaultValue: "Next step (Alt+Right)",
          })}
          title={t("form.step.nav.next", {
            defaultValue: "Next step (Alt+Right)",
          })}
        >
          <ChevronRight size={14} />
        </button>
        <code className="workflow-form__id" title={step.id}>
          {step.id}
        </code>
      </header>

      <label className="workflow-form__field">
        <span className="workflow-form__label">{t("form.step.name.label")}</span>
        <input
          className="vm-input vm-input--field workflow-form__input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => commitField("name", name, baseline.name ?? "")}
        />
      </label>

      {step.uses && (
        <div className="workflow-form__field">
          <span className="workflow-form__label">{t("form.step.uses.label")}</span>
          <code className="workflow-form__id">{step.uses}</code>
        </div>
      )}

      {step.run !== undefined && (
        <label className="workflow-form__field">
          <span className="workflow-form__label">{t("form.step.run.label")}</span>
          <textarea
            className="vm-input vm-input--field vm-input--mono workflow-form__input"
            rows={3}
            value={run}
            onChange={(e) => setRun(e.target.value)}
            onBlur={() => commitField("run", run, baseline.run ?? "")}
          />
          <button
            type="button"
            className="workflow-form__expand-btn"
            onClick={() => setExpand({ field: "run", value: run })}
          >
            {t("expression.expand.run")}
          </button>
        </label>
      )}

      <label className="workflow-form__field">
        <span className="workflow-form__label">
          {t("form.step.workingDirectory.label")}
        </span>
        <input
          className="vm-input vm-input--field vm-input--mono workflow-form__input"
          type="text"
          value={workingDir}
          onChange={(e) => setWorkingDir(e.target.value)}
          onBlur={() =>
            commitField(
              "working-directory",
              workingDir,
              baseline.workingDirectory ?? "",
            )
          }
        />
      </label>

      <label className="workflow-form__field">
        <span className="workflow-form__label">{t("form.step.if.label")}</span>
        <textarea
          className="vm-input vm-input--field vm-input--mono workflow-form__input"
          rows={2}
          value={ifCond}
          onChange={(e) => setIfCond(e.target.value)}
          onBlur={() => commitField("if", ifCond, baseline.if ?? "")}
        />
        <button
          type="button"
          className="workflow-form__expand-btn"
          onClick={() => setExpand({ field: "if", value: ifCond })}
        >
          {t("expression.expand.if")}
        </button>
      </label>

      {(step.uses || withRows.length > 0) && (
        <div className="workflow-form__field">
          <span className="workflow-form__label">
            {t("form.step.with.label")}
          </span>
          {metadataResult.state === "loading" && (
            <span className="workflow-form__metadata-loading">
              {t("panel.metadata.fetching")}
            </span>
          )}
          {metadataResult.state === "unavailable" && (
            <span className="workflow-form__metadata-loading">
              {t("panel.metadata.unavailable")}
            </span>
          )}
          <div className="workflow-form__with-rows">
            {withRows.map((row, idx) => {
              const schema = inputs?.[row.key];
              return (
                <div key={idx} className="workflow-form__with-row-group">
                  <div className="workflow-form__with-row">
                    <input
                      className="vm-input vm-input--field vm-input--mono workflow-form__input"
                      type="text"
                      value={row.key}
                      placeholder={t("form.step.with.keyPlaceholder")}
                      list={knownInputKeys.length > 0 ? datalistId : undefined}
                      aria-describedby={
                        knownInputKeys.length > 0
                          ? `${datalistId}-help`
                          : undefined
                      }
                      aria-invalid={row.duplicateKey || undefined}
                      onChange={(e) => updateRow(idx, { key: e.target.value })}
                      onBlur={() => commitWithRow(idx)}
                    />
                    <input
                      className="vm-input vm-input--field vm-input--mono workflow-form__input"
                      type="text"
                      value={row.value}
                      placeholder={
                        schema?.default ?? t("form.step.with.valuePlaceholder")
                      }
                      onChange={(e) => updateRow(idx, { value: e.target.value })}
                      onBlur={() => commitWithRow(idx)}
                    />
                    <button
                      type="button"
                      className="workflow-form__with-remove"
                      aria-label={t("form.step.with.removeRow")}
                      onClick={() => removeRow(idx)}
                    >
                      ×
                    </button>
                  </div>
                  {row.duplicateKey && (
                    <span className="workflow-form__with-error" role="alert">
                      {t("form.step.with.duplicateKey")}
                    </span>
                  )}
                  {schema?.description && (
                    <span className="workflow-form__metadata-desc">
                      {schema.description}
                    </span>
                  )}
                </div>
              );
            })}
            {missingRequired.length > 0 && (
              <div className="workflow-form__missing-required">
                <span className="workflow-form__label">
                  {t("form.step.with.missingRequired")}
                </span>
                {missingRequired.map(([key, schema]) => (
                  <button
                    key={key}
                    type="button"
                    className="workflow-form__missing-required-key"
                    onClick={() => addSuggestedKey(key)}
                    title={schema.description ?? ""}
                  >
                    <code>{key}</code>
                    <span aria-label="required">*</span>
                  </button>
                ))}
              </div>
            )}
            {knownInputKeys.length > 0 && (
              <details
                id={`${datalistId}-help`}
                className="workflow-form__known-inputs"
              >
                <summary className="workflow-form__known-inputs-summary">
                  {t("form.step.with.knownInputs", {
                    defaultValue: "Available inputs ({{count}})",
                    count: knownInputKeys.length,
                  })}
                </summary>
                <div className="workflow-form__known-inputs-list">
                  {Object.entries(inputs!).map(([key, schema]) => {
                    const used = setKeys.has(key);
                    return (
                      <div
                        key={key}
                        className="workflow-form__known-input-row"
                      >
                        <button
                          type="button"
                          className="workflow-form__known-input"
                          data-used={used}
                          disabled={used}
                          onClick={() => addSuggestedKey(key)}
                          aria-label={
                            schema.description
                              ? `${key} — ${schema.description}`
                              : key
                          }
                          title={schema.description ?? ""}
                        >
                          <code>{key}</code>
                          {schema.required && (
                            <span
                              className="workflow-form__known-input-required"
                              aria-label={t("form.step.with.required", {
                                defaultValue: "required",
                              })}
                            >
                              *
                            </span>
                          )}
                        </button>
                        {schema.description && (
                          <span
                            className="workflow-form__known-input-desc"
                            id={`${datalistId}-${key}-desc`}
                          >
                            {schema.description}
                            {schema.default !== undefined && (
                              <em className="workflow-form__known-input-default">
                                {" "}
                                {t("form.step.with.defaultValue", {
                                  defaultValue: "(default: {{value}})",
                                  value: schema.default,
                                })}
                              </em>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
            {knownInputKeys.length > 0 && (
              <datalist id={datalistId}>
                {knownInputKeys.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            )}
            <button
              type="button"
              className="workflow-form__with-add"
              onClick={addRow}
            >
              + {t("form.step.with.addRow")}
            </button>
          </div>
        </div>
      )}
      {expand && (
        <ExpressionEditor
          initialValue={expand.value}
          language={expand.field === "if" ? "yaml" : "plain"}
          title={t(
            expand.field === "if"
              ? "expression.title.if"
              : "expression.title.run",
          )}
          onSave={handleExpandSave}
          onCancel={() => setExpand(null)}
        />
      )}
    </form>
  );
}
