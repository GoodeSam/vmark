---
paths:
  - "package.json"
  - "src-tauri/tauri.conf.json"
  - "src-tauri/Cargo.toml"
  - "src-tauri/Cargo.lock"
  - "server/mcp/package.json"
  - "server/mcp/src/cli.ts"
  - "scripts/bump-version.sh"
  - ".github/workflows/release*.yml"
---

# 40 - Version Bump Procedure

Use `/bump` or `scripts/bump-version.sh <x.y.z>`. The five version sources must
change together, and `src-tauri/Cargo.lock` must be regenerated and committed
with them (`cargo update -p vmark --manifest-path src-tauri/Cargo.toml`).

| File | Field |
|------|-------|
| `package.json` | `"version"` (the website reads it at build time) |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |
| `server/mcp/package.json` | `"version"` |
| `server/mcp/src/cli.ts` | `VERSION` — declared with SINGLE quotes; a double-quote-only `sed` silently matches nothing |

Mismatches show as `Version 0.2.5 (0.3.0)` in About, or a stale MCP health-check version.

## Landing and tagging

1. **Prefer folding the bump into the feature PR** being released; a standalone
   bump PR costs a full CI cycle. Standalone is the fallback when `main` already
   has the changes.
2. `main` requires a PR (rule 60 §10): push a branch, `gh pr create --fill`,
   `gh pr checks --watch`, merge, then `git checkout main && git pull`.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`. **Never `git push --tags`** — a
   stale tag triggers a second release that can become "Latest".
4. The pre-push tag leg (`scripts/check-tag-green.sh`) passes immediately after
   the merge. If the push dies with SIGPIPE (141) after a green gate, the SSH
   keepalive is missing: run `node scripts/setup-local-git.mjs`. Never
   `--no-verify`.

## Related failure classes

- Tauri npm package and Rust crate versions must share major/minor, or
  `tauri build` fails only at release time. `pnpm lint:tauri-versions` catches
  the skew; align the pair.
- There is no post-release cleanup step: releases build in CI and leave nothing
  locally. Disk growth is `src-tauri/target/debug`; use `pnpm clean:dev`.

## Verification

About VMark shows a single version; `vmark-mcp-server --version` and the MCP
status dialog show the same one.
