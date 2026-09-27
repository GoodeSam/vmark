//! The read side of workflow snapshots: list and restore (WI-LX2.3).
//!
//! Split from `snapshots.rs` at the file-size gate when the write side grew
//! its bounded, cancellable copy (#267). Until WI-LX2.3 this half was
//! `#[allow(dead_code)]` with no command and no UI, while a run whose
//! snapshot failed was already REFUSED (`prepare.rs`, #266) — a recovery
//! point nothing could recover from. `snapshot_commands.rs` now exposes both
//! functions, and the run panel offers the restore after a run.
//!
//! Three properties hold here:
//!   - The root is the one the snapshot RECORDED (`SnapshotInfo::
//!     workspace_root`), never a caller's. A snapshot without one predates
//!     restore and is refused rather than guessed at.
//!   - Every write goes through the anchored commit `action/save-file` uses
//!     (`ensure_dir::create_parents_within` + `commit::
//!     commit_inside_workspace`), so a parent swapped for an escaping symlink
//!     is refused, not written through. A recorded path outside the root, or
//!     one carrying `..`, is skipped — metadata is not trusted.
//!   - Per-file failures are COUNTED, not fatal: an undo that stops at the
//!     first bad file leaves the rest unrestored for no reason. The report
//!     says how many were restored, deleted and skipped.
//!
//! @coordinates-with snapshots.rs — `SnapshotInfo`, `validate_id`, the re-export
//! @coordinates-with snapshot_commands.rs — the Tauri commands
//! @module workflow::snapshot_restore

use super::commit::commit_inside_workspace;
use super::ensure_dir::create_parents_within;
use super::snapshot_copy::MAX_SNAPSHOT_FILE_BYTES;
use super::snapshots::{validate_id, SnapshotInfo};
use crate::bounded_read::read_regular_bounded;
use crate::command_error::{CommandError, ErrorCode};
use crate::localized_error;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

const MAX_SNAPSHOTS: usize = 50;
const SNAPSHOTS_DIR: &str = "workflow-snapshots";

/// What the run panel needs to know about one snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSummary {
    pub id: String,
    pub execution_id: String,
    pub timestamp: u64,
    /// Files that existed before the run and will be put back.
    pub file_count: usize,
    /// Files the run was about to create, deleted by a restore.
    pub created_count: usize,
}

/// What a restore did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub restored: usize,
    pub deleted: usize,
    pub skipped: usize,
}

async fn read_metadata(snapshot_dir: &Path) -> Result<SnapshotInfo, CommandError> {
    let raw = tokio::fs::read_to_string(snapshot_dir.join("metadata.json"))
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => {
                localized_error!(ErrorCode::NotFound, "errors.workflow.snapshotNotFound")
            }
            _ => localized_error!(
                ErrorCode::Io,
                "errors.workflow.snapshotUnreadable",
                detail = e
            ),
        })?;
    serde_json::from_str(&raw).map_err(|e| {
        localized_error!(
            ErrorCode::InvalidInput,
            "errors.workflow.snapshotUnreadable",
            detail = e
        )
    })
}

/// Put back every file `snapshot_id` preserved and delete the files the run
/// created, under the root the snapshot recorded.
pub async fn restore_snapshot(
    app_data_dir: &Path,
    snapshot_id: &str,
) -> Result<RestoreReport, CommandError> {
    validate_id(snapshot_id).map_err(CommandError::invalid_input)?;
    let snapshot_dir = app_data_dir.join(SNAPSHOTS_DIR).join(snapshot_id);
    let info = read_metadata(&snapshot_dir).await?;

    let Some(recorded_root) = info.workspace_root.clone() else {
        return Err(localized_error!(
            ErrorCode::Unsupported,
            "errors.workflow.snapshotNoWorkspace"
        ));
    };
    let root = PathBuf::from(&recorded_root).canonicalize().map_err(|_| {
        localized_error!(
            ErrorCode::NotFound,
            "errors.workflow.snapshotWorkspaceMissing",
            path = recorded_root
        )
    })?;

    tokio::task::spawn_blocking(move || restore_blocking(&snapshot_dir, &info, &root))
        .await
        .map_err(|e| CommandError::internal(format!("snapshot restore task failed: {e}")))
}

/// The recorded path, if it is absolute, has no `..`, and lies strictly under `root`.
fn contained(recorded: &str, root: &Path) -> Result<PathBuf, String> {
    let path = PathBuf::from(recorded);
    let plain = path.components().all(|c| {
        matches!(
            c,
            Component::Normal(_) | Component::RootDir | Component::Prefix(_)
        )
    });
    if path.is_absolute() && plain && path.starts_with(root) && path != root {
        Ok(path)
    } else {
        Err("outside the snapshot's workspace".to_string())
    }
}

fn restore_blocking(snapshot_dir: &Path, info: &SnapshotInfo, root: &Path) -> RestoreReport {
    let mut report = RestoreReport::default();
    for recorded in &info.files {
        match restore_one(snapshot_dir, recorded, root) {
            Ok(()) => report.restored += 1,
            Err(reason) => {
                log::warn!("[workflow] not restoring '{recorded}': {reason}");
                report.skipped += 1;
            }
        }
    }
    for recorded in &info.created_files {
        match delete_created(recorded, root) {
            Ok(true) => report.deleted += 1,
            Ok(false) => {}
            Err(reason) => {
                log::warn!("[workflow] not deleting '{recorded}': {reason}");
                report.skipped += 1;
            }
        }
    }
    report
}

fn restore_one(snapshot_dir: &Path, recorded: &str, root: &Path) -> Result<(), String> {
    let target = contained(recorded, root)?;
    let relative = target
        .strip_prefix(root)
        .map_err(|_| "outside the snapshot's workspace".to_string())?;
    let bytes = read_regular_bounded(&snapshot_dir.join(relative), MAX_SNAPSHOT_FILE_BYTES)
        .map_err(|e| format!("snapshot copy unreadable: {e}"))?;
    let parent = target
        .parent()
        .ok_or_else(|| "no parent directory".to_string())?;
    create_parents_within(parent, root)?;
    commit_inside_workspace(&target, root, &bytes)
}

/// Delete a file the run created. `Ok(false)` when it is already gone. A path
/// that is now a symlink or a directory is NOT the file the run made, and
/// following a link would delete its target — so it is refused.
fn delete_created(recorded: &str, root: &Path) -> Result<bool, String> {
    let target = contained(recorded, root)?;
    let meta = match std::fs::symlink_metadata(&target) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.to_string()),
    };
    if !meta.file_type().is_file() {
        return Err("no longer a regular file".to_string());
    }
    let parent = target
        .parent()
        .and_then(|p| p.canonicalize().ok())
        .ok_or_else(|| "parent directory unresolvable".to_string())?;
    if !parent.starts_with(root) {
        return Err("parent resolves outside the workspace".to_string());
    }
    std::fs::remove_file(&target)
        .map(|()| true)
        .map_err(|e| e.to_string())
}

/// Recent snapshots, newest first. A corrupt entry is logged and left out.
pub async fn list_snapshots(app_data_dir: &Path) -> Result<Vec<SnapshotSummary>, CommandError> {
    let snapshots_dir = app_data_dir.join(SNAPSHOTS_DIR);
    let mut dir = match tokio::fs::read_dir(&snapshots_dir).await {
        Ok(dir) => dir,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(list_failed(e)),
    };

    let mut snapshots = Vec::new();
    while let Some(entry) = dir.next_entry().await.map_err(list_failed)? {
        let meta_path = entry.path().join("metadata.json");
        let Ok(raw) = tokio::fs::read_to_string(&meta_path).await else {
            continue;
        };
        match serde_json::from_str::<SnapshotInfo>(&raw) {
            Ok(info) => snapshots.push(SnapshotSummary {
                file_count: info.files.len(),
                created_count: info.created_files.len(),
                id: info.id,
                execution_id: info.execution_id,
                timestamp: info.timestamp,
            }),
            Err(e) => log::warn!("Corrupt snapshot metadata at {:?}: {}", meta_path, e),
        }
    }

    snapshots.sort_by_key(|s| std::cmp::Reverse(s.timestamp));
    snapshots.truncate(MAX_SNAPSHOTS);
    Ok(snapshots)
}

fn list_failed(e: std::io::Error) -> CommandError {
    localized_error!(
        ErrorCode::Io,
        "errors.workflow.snapshotListFailed",
        detail = e
    )
}

#[cfg(test)]
#[path = "snapshot_restore.test.rs"]
mod tests;
