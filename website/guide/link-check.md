# Link Check

VMark verifies that local link and image targets in your markdown actually exist on disk. Runs alongside the [markdown lint engine](/guide/lint) on `Alt + Mod + V` or **View → Check Markdown**.

## What it checks

For every local link and image in the document:

- `[text](./other.md)` — the file `./other.md` resolves and exists
- `![alt](./image.png)` — the image file exists
- `[text](./other.md#section)` — the file exists (anchor checking is handled by the [`linkFragments` rule](/guide/lint#rule-reference))

When a target is missing, an entry appears in the lint badge and in `F2` / `Shift + F2` navigation. How it is drawn depends on the mode: in Source mode the link gets CodeMirror's red diagnostic underline; in WYSIWYG mode the whole block containing the link is marked with a red bar along its left edge and a faint tint — WYSIWYG lint marks are block-level, never an inline underline.

## What it skips

- **Fragment-only links** (`#anchor`) — handled by the `linkFragments` rule which checks against the current document's headings
- **External URLs** — any URI scheme (`http:`, `https:`, `mailto:`, `obsidian:`, `vscode:`, …) and protocol-relative `//host/…` URLs. Windows drive-letter paths (`C:\…`, `C:/…`) are still checked as file paths
- **Untitled documents** — without a saved file path, relative URLs can't be resolved against any directory
- **Network paths and drive-relative paths** — a UNC path (`\\server\share\…`) is never looked up, because checking it on Windows would contact that host over the network (and could offer it your Windows sign-in credentials). A drive-relative `C:file.md` (a drive letter with no slash after it) is skipped too: it is relative to the app's working directory, not to the document

## How resolution works

Link Check resolves a relative path against the source file's directory, and takes an absolute path as the file it names:

| Link in `/repo/docs/intro.md` | Resolves to |
|---|---|
| `[a](./other.md)` | `/repo/docs/other.md` |
| `[a](../shared.md)` | `/repo/shared.md` |
| `[a](images/logo.png)` | `/repo/docs/images/logo.png` |
| `[a](/docs/intro.md)` | `/docs/intro.md` (an absolute path names that file; on Windows it lands on the document's own drive) |

Fragments are stripped before file lookup — `[a](./other.md#section)` checks `./other.md` only.

Percent-encoded paths are decoded before lookup — `![x](photo%20one.png)` checks `photo one.png`, matching how the editor renders it.

## Performance

- **Async** — runs in parallel with the sync rules; results merge in when ready
- **Deduped** — each unique resolved path is checked once per run, even if linked multiple times
- **No keystroke triggering** — fs.exists on every keystroke would thrash; runs only on the explicit lint trigger
- **Operational error tolerance** — if `fs.exists` throws (permission denied, capability scope issue), the result is `error` (skipped), not `missing`. Better silent than wrong.

## Diagnostic codes

| Code | Severity | Trigger |
|---|---|---|
| **M001** | Error | Image file not found at resolved local path |
| **M002** | Error | Linked file not found at resolved local path |

## See also

- [Markdown Lint](/guide/lint) — full rule reference
- [Settings → Markdown → Lint](/guide/settings#lint)
