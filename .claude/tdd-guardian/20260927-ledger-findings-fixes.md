---
title: "Ledger findings fixes — security boundaries, capture setting, YAML engine, guide drift, tracked ledger"
created_at: "2026-09-27"
mode: "full-plan"
---

# Ledger findings fixes

**Status:** IN PROGRESS on branch `fix/feature-ledger-findings`.
**Evidence:** `.claude/feature-ledger.md` §"Open findings" (verified at `12c98051e`).
**Namespace:** `WI-LX<phase>.<n>`.
**Maintainer decisions (2026-09-27):** YAML engine — keep in every build behind `advanced.workflowEngine` and make it work (re-verdict recorded in rule 60 §12); `asset://` — narrow to the fs scope plus runtime grants; workspace grants — Rust-owned.

## Phase 1 — Security boundaries

- **WI-LX1.1** Rust-owned workspace grants. `allow_workspace_access` grants any webview-supplied path recursively. Replace with grants Rust can attribute to a user action: the Rust-side folder picker, Finder/CLI open, and a Rust-persisted list of roots previously granted that way (session restore and Open Recent re-issue from it). A path outside the list is refused with a typed `permission-denied`. DoD: tests prove an arbitrary path (including `/`) is refused, a picked/persisted root is granted, and restore still works.
- **WI-LX1.2** Narrow `asset://`. `tauri.conf.json` `assetProtocol.scope` `**/*` → the static fs roots; runtime grants (`allow_fs_read`, `allow_fs_read_dir`, `grant_asset_access`) keep extending it. DoD: a Rust test pins the configured scope; media inside the roots and granted folders still resolves.
- **WI-LX1.3** PDF-export window write scope. Remove the `$HOME/**` / `/Volumes/**` write grant if nothing in that window writes through the fs plugin; otherwise narrow it to what it writes and correct the description. DoD: capability test pins it.
- **WI-LX1.4** `general.coherenceCaptureOnSave` honoured on every write path. MCP writes, genie apply, accepted AI suggestions, history restore and explorer new-file no longer create `.vmark/` or stamp identity blocks when the setting is off. DoD: tests per path; `coherence.md` and the setting description match.

## Phase 2 — YAML workflow engine works

- **WI-LX2.1** The Run/Cancel panel opens for `.yml`/`.yaml` workflow files when the engine is on.
- **WI-LX2.2** `WorkflowSidePanel` targets the current window, not `"main"`.
- **WI-LX2.3** Snapshot restore is reachable (`restore_snapshot` / `list_snapshots` wired to a command and UI), or the dead code is deleted with the run-requires-snapshot rule revisited — whichever keeps the safety story true.
- **WI-LX2.4** The remaining area-12 open findings (source-view registration for split panes, unwired layout/matrix toggles, stale headers, guide drift in `workflows.md`, `workflow-viewer.md`, `settings.md` §Workflow).
- **WI-LX2.5** Rule 60 §12 records a dated `RE-VERDICT 2026-09-27` for the engine.

## Phase 3 — Guides and the ledger

- **WI-LX3.1** Every `[docs]` finding in the ledger fixed in the English guide, and the same sections updated in all nine locales.
- **WI-LX3.2** The ledger is tracked at `.claude/feature-ledger.md` and `pnpm lint:feature-map` requires it. Not a `.gitignore` exception inside `dev-docs/`: worktrees symlink `dev-docs`, and git refuses to track a path beyond a symlink. `.claude/**/*.md` is already prose to the docs-only CI filter.
- **WI-LX3.3** The ledger's fixed findings are deleted and the touched blocks re-verified.

## Definition of Done

`pnpm check:predelta` green, Rust `cargo test` + `cargo clippy --all-targets -- -D warnings` green, `bash scripts/check-cross-target.sh` for new mock-runtime tests, `cd website && pnpm build` green.
