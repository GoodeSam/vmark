/**
 * Is this YAML a VMark engine workflow? (WI-LX2.1)
 *
 * Purpose: the yaml adapter routes every `.yml`/`.yaml` file, and two
 * unrelated features want some of them. The rule that tells them apart:
 *
 * | Check (in order) | GitHub Actions workflow | VMark engine workflow |
 * |---|---|---|
 * | Path under `.github/workflows/` | always — GitHub owns it | never |
 * | Top-level `jobs:` | yes | never (the schema has no jobs) |
 * | Top-level `steps:` whose `uses:` names `genie/`, `action/` or `webhook/` | never (steps live under a job) | yes |
 *
 * Both may carry `on:`, so `on:` decides nothing. A file with top-level
 * `steps:` AND `jobs:` is not claimed here: ambiguity goes to the read-only
 * viewer, never to the runner. The `uses:` prefix is what keeps look-alikes
 * out — an Azure Pipelines file has top-level `steps:` too, but its steps are
 * `script:`/`task:`, and a GitHub reference is `owner/repo@ref`.
 *
 * Deliberately a regex check, not a parse: malformed YAML with the engine's
 * shape is still claimed, so the run panel can show the parse error instead of
 * the file silently falling back to a plain tree.
 *
 * @coordinates-with lib/formats/adapters/yaml.tsx — the schema detector that calls it
 * @coordinates-with lib/ghaWorkflow/detection.ts — the GitHub Actions half of the rule
 * @module lib/workflow/detection
 */

import { looksLikeWorkflowPath } from "@/lib/ghaWorkflow/detection";

const TOP_LEVEL_JOBS = /^jobs\s*:/m;
const TOP_LEVEL_STEPS = /^steps\s*:/m;
/** An indented `uses:` (optionally the list item's first key) naming a VMark step type. */
const ENGINE_USES = /^[ \t]+(?:-[ \t]+)?uses[ \t]*:[ \t]*["']?(?:genie|action|webhook)\//m;

export function isEngineWorkflow(path: string | null | undefined, content: string): boolean {
  if (looksLikeWorkflowPath(path)) return false;
  if (!content || TOP_LEVEL_JOBS.test(content)) return false;
  return TOP_LEVEL_STEPS.test(content) && ENGINE_USES.test(content);
}
