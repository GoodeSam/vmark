//! The webview's two workspace-grant commands (WI-LX1.1).
//!
//! Purpose: `allow_workspace_access` re-issues a grant the user already made;
//! `pick_workspace_folder` is how the user makes one. Neither lets a script
//! name a folder and receive it.
//!
//! Key decisions:
//!   - Both are `async` and do their filesystem work on the blocking pool: a
//!     non-`async` command runs on the thread that delivered the IPC message,
//!     and `canonicalize` on a dead network mount blocks for the mount's
//!     timeout (audit #470). The picker must be `async` regardless — a dialog
//!     shown from a synchronous command would be driven from the IPC thread.
//!   - Going `async` removes the serialization the blocking IPC loop gave for
//!     free (rule 50 §10). The check-then-act here is "is it recorded? then
//!     grant": the list only grows except for oldest-first eviction, so a root
//!     evicted between the two steps was recorded a moment earlier, and the
//!     grant it gets is the one it already had. Two pickers are refused by an
//!     atomic slot (`begin_picker`), not by a check followed by a set.
//!   - The dialog glue is not unit-tested: MockRuntime cannot show a native
//!     panel. Everything after the user's answer is `grant_chosen_root`, which
//!     is (`mod.test.rs`).
//!
//! @coordinates-with workspace_grants/mod.rs — the state and `grant_chosen_root`
//! @coordinates-with services/workspaces/workspaceAccess.ts — the only caller
//! @module workspace_grants/commands

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

use super::{canonical_dir, grant_chosen_root, WorkspaceGrants};
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

/// Grant the fs + asset scopes again for a workspace root the user chose
/// before — the folder picker, Finder, or a recorded root from an earlier
/// launch — or for a folder inside one. Returns the canonical root.
///
/// Anything else is refused with `permission-denied` and extends nothing. A
/// folder the static capability scope already covers (under `$HOME`, say)
/// needs no grant; the caller tells the two apart by reading it.
#[tauri::command]
pub async fn allow_workspace_access<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<String, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_dir(Path::new(&path))?;
        if !app.state::<WorkspaceGrants>().covers(&root) {
            return Err(localized_error!(
                ErrorCode::PermissionDenied,
                "errors.workspaceAccess.notGranted",
                path = root.as_str()
            ));
        }
        crate::fs_scope::allow_fs_read_dir(&app, &root);
        Ok(root)
    })
    .await
    .map_err(|e| CommandError::internal(format!("workspace access task failed: {e}")))?
}

/// Show the folder picker and grant + record what the user chooses. Returns the
/// canonical folder, or `None` when the dialog was cancelled.
///
/// `default_path` opens the dialog AT that folder, so confirming a requested
/// folder (Open Recent, the `open_workspace` MCP tool) is one click on Open.
#[tauri::command]
pub async fn pick_workspace_folder<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    default_path: Option<String>,
) -> Result<Option<String>, CommandError> {
    use tauri_plugin_dialog::DialogExt;

    let grants = app.state::<WorkspaceGrants>();
    let Some(_flight) = grants.begin_picker() else {
        return Err(localized_error!(
            ErrorCode::Conflict,
            "errors.workspaceAccess.pickerBusy"
        ));
    };

    let start = default_path.map(PathBuf::from).filter(|p| p.is_absolute());
    let title = if start.is_some() {
        rust_i18n::t!("workspaceAccess.confirmTitle")
    } else {
        rust_i18n::t!("workspaceAccess.pickTitle")
    };
    let mut dialog = app
        .dialog()
        .file()
        .set_title(title.to_string())
        .set_can_create_directories(true);
    #[cfg(any(windows, target_os = "macos"))]
    {
        dialog = dialog.set_parent(&window);
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = &window;
    if let Some(start) = start {
        dialog = dialog.set_directory(start);
    }

    let (answer, answered) = tokio::sync::oneshot::channel();
    dialog.pick_folder(move |folder| {
        let _ = answer.send(folder);
    });
    let Some(folder) = answered
        .await
        .map_err(|_| CommandError::internal("the folder dialog closed without an answer"))?
    else {
        return Ok(None);
    };
    let picked = folder
        .into_path()
        .map_err(|e| CommandError::invalid_input(format!("unusable folder: {e}")))?;

    // The slot stays held until the grant is recorded, so a second dialog cannot
    // open between the answer and the record.
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || grant_chosen_root(&handle, &picked).map(Some))
        .await
        .map_err(|e| CommandError::internal(format!("workspace grant task failed: {e}")))?
}

#[cfg(test)]
#[path = "commands.test.rs"]
mod tests;
