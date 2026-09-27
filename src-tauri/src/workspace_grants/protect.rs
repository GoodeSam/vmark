//! Keeping webview-supplied writes off the grant list (WI-LX1.1).
//!
//! Purpose: the list decides what is granted at the next launch, so a generic
//! write command that lets the webview name a path must not reach it. This is
//! the predicate those commands share; they call [`refuse_list_write`] with the
//! path they are about to write, and with its link-resolved referent.
//!
//! Key decisions:
//!   - Matching is by FOLDER and NAME, not by string: the folders are compared
//!     after `canonicalize` (so a linked folder, `/var` vs `/private/var`, or a
//!     differently-cased folder is caught), and the name ignoring ASCII case
//!     (macOS and Windows file systems do). Over-refusing `WORKSPACE-GRANTS.JSON`
//!     on a case-sensitive Linux disk costs nothing.
//!   - A path whose folder does not exist is not the list: nothing can be
//!     written there, so there is nothing to refuse.
//!   - Link resolution is the caller's (`file_write.rs`, the one place that
//!     follows document links); this module only compares.
//!
//! @coordinates-with file_write.rs — atomic_write_file, create_file_exclusive
//! @coordinates-with workflow/commands.rs — run_workflow refuses a root containing the list
//! @coordinates-with workspace_grants/mod.rs — where the list file lives
//! @module workspace_grants/protect

use std::path::Path;

use tauri::{AppHandle, Manager, Runtime};

use super::WorkspaceGrants;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;

/// Does writing `target` write the list file `list`?
pub(crate) fn names_grant_list(list: &Path, target: &Path) -> bool {
    let (Some(name), Some(list_name)) = (target.file_name(), list.file_name()) else {
        return false;
    };
    if !name
        .to_string_lossy()
        .eq_ignore_ascii_case(&list_name.to_string_lossy())
    {
        return false;
    }
    let (Some(dir), Some(list_dir)) = (target.parent(), list.parent()) else {
        return false;
    };
    match (dir.canonicalize(), list_dir.canonicalize()) {
        (Ok(dir), Ok(list_dir)) => dir == list_dir,
        _ => false,
    }
}

/// Does a workspace rooted at `root` contain the list file `list`?
///
/// Compared after `canonicalize`, so a root that is a link to an ancestor of
/// app data is caught. A root that does not exist contains nothing.
pub(crate) fn root_contains_list(list: &Path, root: &Path) -> bool {
    let Some(list_dir) = list.parent() else {
        return false;
    };
    match (list_dir.canonicalize(), root.canonicalize()) {
        (Ok(list_dir), Ok(root)) => list_dir.starts_with(root),
        _ => false,
    }
}

/// Refuse a workspace root that contains the list — a workflow run is bounded
/// by its root, so such a root would let an `action/save-file` step rewrite
/// the list (WI-LX1.1 follow-up).
pub(crate) fn refuse_root_containing_list<R: Runtime>(
    app: &AppHandle<R>,
    root: &Path,
) -> Result<(), CommandError> {
    let list = app
        .try_state::<WorkspaceGrants>()
        .and_then(|grants| grants.list_file());
    match list {
        Some(list) if root_contains_list(&list, root) => Err(localized_error!(
            ErrorCode::PermissionDenied,
            "errors.workspaceAccess.listProtected"
        )),
        _ => Ok(()),
    }
}

/// Refuse a webview-supplied write to `target` if it would land on the list,
/// with a typed, localized `permission-denied`.
pub(crate) fn refuse_list_write<R: Runtime>(
    app: &AppHandle<R>,
    target: &Path,
) -> Result<(), CommandError> {
    let list = app
        .try_state::<WorkspaceGrants>()
        .and_then(|grants| grants.list_file());
    match list {
        Some(list) if names_grant_list(&list, target) => Err(localized_error!(
            ErrorCode::PermissionDenied,
            "errors.workspaceAccess.listProtected"
        )),
        _ => Ok(()),
    }
}
