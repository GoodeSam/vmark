//! Runtime extension of the fs + asset-protocol scopes.
//!
//! The STATIC capability scope (`capabilities/default.json`, plus C:–F: in
//! `windows.json`) covers `$HOME/**`, `/Volumes/**`, `/mnt/**` and `/media/**`,
//! and the asset-protocol scope in `tauri.conf.json` is narrowed to the same
//! roots (WI-LX1.2). Anything the user opens from outside them — a file from
//! Finder or the CLI, a workspace on another drive — is granted here at runtime.
//!
//! Three properties of these grants drive every caller:
//!   - they are IN-MEMORY and do not survive a restart, so a path must be
//!     re-granted on every launch that opens it, not once when it is first
//!     picked;
//!   - `allow_file` grants exactly one path, while `allow_directory(p, r)`
//!     pushes `p/*` when `r` is false and `p/**` when true — so a workspace
//!     needs the recursive form or its subdirectories stay out of scope;
//!   - a runtime fs grant is NOT read-only: the fs plugin accepts a
//!     runtime-granted path for every command the capability permits (write,
//!     rename, remove). Which folders get the recursive grant is therefore
//!     decided in `workspace_grants`, never by a webview-supplied path.
//!
//! Split out of `file_open.rs` when that file crossed the 300-line limit:
//! granting scope is a separate concern from queueing Finder/CLI opens.
//!
//! @coordinates-with file_open.rs — queues the opens these grants make readable
//! @coordinates-with workspace_grants/mod.rs — the only caller of the recursive grant

use tauri::Manager;

/// Runtime-extend the fs + asset scopes for a path the user asked to open.
/// Files from Finder / CLI / "open in new window" can live anywhere
/// (`/private/tmp`, `/etc`), so `readTextFile` rejects them until extended
/// here. The asset-protocol scope is limited to the same static roots, so it
/// needs the same per-file grant for `convertFileSrc`/asset:// to serve the
/// file (inline images + media viewer). Best-effort: failures logged, not
/// propagated.
pub(crate) fn allow_fs_read<R: tauri::Runtime, P: AsRef<std::path::Path>>(
    app: &tauri::AppHandle<R>,
    path: P,
) {
    use tauri_plugin_fs::FsExt;
    let path = path.as_ref();
    if let Err(e) = app.fs_scope().allow_file(path) {
        log::warn!(
            "[fs-scope] Failed to allow file '{}': {}",
            path.display(),
            e
        );
    }
    if let Err(e) = app.asset_protocol_scope().allow_file(path) {
        log::warn!(
            "[asset-scope] Failed to allow file '{}': {}",
            path.display(),
            e
        );
    }
}

/// [`allow_fs_read`], reporting whether `path` ended up READABLE (#481).
///
/// `allow_fs_read` is best-effort by design — it logs a failed grant and
/// returns — which is right for the Finder/CLI callers, where the static scope
/// often covers the file anyway and refusing the open would turn a partial
/// degradation into a hard failure. It is wrong for `open_*_in_new_window`,
/// whose entire job is to make this file readable in the window it is about to
/// build: the command reported success, the window opened, and the webview's
/// first read came back `forbidden path`.
///
/// **This is an ASSERTION, and it is measured as never firing today.** Both
/// `Scope::allow_file` calls return `Result`, but Tauri escapes each granted
/// path before compiling it as a glob, so the obvious failure — a filename
/// holding `[` or `*` — grants fine (`fs_scope.test.rs` pins that). The check
/// stays because the failure it guards is otherwise INVISIBLE: nothing else
/// distinguishes "granted" from "logged and carried on", and the symptom
/// surfaces a window later as an error the user cannot act on.
///
/// The verdict is the RUNTIME scope's `is_allowed`, not the grant's own
/// `Result`. That scope starts empty (the fs plugin builds it from
/// `FsScope::default()`) and never sees the capability files, so the check
/// answers exactly "did a runtime pattern take?".
pub(crate) fn grant_fs_read<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    path: &str,
) -> Result<(), String> {
    use tauri_plugin_fs::FsExt;
    allow_fs_read(app, path);
    if app.fs_scope().is_allowed(path) {
        Ok(())
    } else {
        Err(format!(
            "{path} could not be added to the file-read scope, so a window opened on it \
             would be refused every read"
        ))
    }
}

/// Runtime-extend the fs + asset scopes for a DIRECTORY tree the user opened
/// as a workspace (#1252). Callers are in `workspace_grants`, which decides
/// that the user chose `path`.
///
/// `allow_fs_read` grants a single path, which is right for one opened file and
/// wrong for a workspace: a non-recursive grant leaves every SUBDIRECTORY out
/// of scope.
///
/// Invisible on macOS and Linux, where the static scope already covers where
/// users keep files. On Windows `windows.json` covers `C:\` to `F:\`, so a
/// workspace on `G:\` or later, or on a network share, is covered by nothing
/// and every file in it is refused with `forbidden path: …`. Best-effort:
/// failures logged, not propagated.
pub(crate) fn allow_fs_read_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: &str) {
    use tauri_plugin_fs::FsExt;
    if let Err(e) = app.fs_scope().allow_directory(path, true) {
        log::warn!("[fs-scope] Failed to allow directory '{}': {}", path, e);
    }
    if let Err(e) = app.asset_protocol_scope().allow_directory(path, true) {
        log::warn!("[asset-scope] Failed to allow directory '{}': {}", path, e);
    }
}

#[cfg(test)]
#[path = "fs_scope.test.rs"]
mod tests;
