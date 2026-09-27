//! WI-LX2.3 — the snapshot read side: restore puts a run's files back where
//! the snapshot recorded them, and list tells the UI which runs have one.
//!
//! The restore used to take the workspace root from its caller and copy with
//! a path-based `tokio::fs::copy`. It now reads the root the snapshot RECORDED
//! (a caller cannot redirect it), writes through the same anchored commit
//! `action/save-file` uses, and reports what it did instead of `()`.

use super::super::snapshots::create_snapshot;
use super::*;
use crate::command_error::ErrorCode;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

fn ws_file(ws: &Path, rel: &str, content: &str) -> PathBuf {
    let p = ws.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(&p, content).unwrap();
    p
}

fn meta_path(app_data: &Path, id: &str) -> PathBuf {
    app_data
        .join("workflow-snapshots")
        .join(id)
        .join("metadata.json")
}

// -- the recorded root --------------------------------------------------------

#[tokio::test]
async fn a_snapshot_records_the_workspace_root_it_was_taken_against() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let file = ws_file(ws.path(), "a.md", "x");
    let id = create_snapshot(app_data.path(), "rec-1", &[file], ws.path())
        .await
        .unwrap();
    let info: SnapshotInfo =
        serde_json::from_str(&std::fs::read_to_string(meta_path(app_data.path(), &id)).unwrap())
            .unwrap();
    assert_eq!(
        info.workspace_root.as_deref().map(PathBuf::from),
        Some(ws.path().canonicalize().unwrap())
    );
}

#[tokio::test]
async fn restore_reports_what_it_put_back_and_what_it_deleted() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let edited = ws_file(ws.path(), "notes/doc.md", "original");
    let created = ws.path().join("out.md");
    let id = create_snapshot(
        app_data.path(),
        "rep-1",
        &[edited.clone(), created.clone()],
        ws.path(),
    )
    .await
    .unwrap();

    std::fs::write(&edited, "overwritten by the run").unwrap();
    std::fs::write(&created, "made by the run").unwrap();

    let report = restore_snapshot(app_data.path(), &id).await.unwrap();
    assert_eq!(
        report,
        RestoreReport {
            restored: 1,
            deleted: 1,
            skipped: 0
        }
    );
    assert_eq!(std::fs::read_to_string(&edited).unwrap(), "original");
    assert!(!created.exists());
}

#[tokio::test]
async fn restore_is_idempotent() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let edited = ws_file(ws.path(), "a.md", "original");
    let created = ws.path().join("new.md");
    let id = create_snapshot(
        app_data.path(),
        "idem-1",
        &[edited.clone(), created.clone()],
        ws.path(),
    )
    .await
    .unwrap();
    std::fs::write(&edited, "changed").unwrap();
    std::fs::write(&created, "new").unwrap();

    restore_snapshot(app_data.path(), &id).await.unwrap();
    let second = restore_snapshot(app_data.path(), &id).await.unwrap();
    // The created file is already gone, so nothing is deleted the second time;
    // the edited file is written again with the same bytes.
    assert_eq!(
        second,
        RestoreReport {
            restored: 1,
            deleted: 0,
            skipped: 0
        }
    );
    assert_eq!(std::fs::read_to_string(&edited).unwrap(), "original");
}

#[tokio::test]
async fn restore_recreates_a_file_the_user_deleted_after_the_run() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let file = ws_file(ws.path(), "deep/dir/a.md", "original");
    let id = create_snapshot(
        app_data.path(),
        "gone-1",
        std::slice::from_ref(&file),
        ws.path(),
    )
    .await
    .unwrap();
    std::fs::remove_dir_all(ws.path().join("deep")).unwrap();

    let report = restore_snapshot(app_data.path(), &id).await.unwrap();
    assert_eq!(report.restored, 1);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "original");
}

// -- refusals, each with its code -----------------------------------------------

#[tokio::test]
async fn a_hostile_id_is_invalid_input() {
    let app_data = tempdir().unwrap();
    let err = restore_snapshot(app_data.path(), "../../../etc")
        .await
        .unwrap_err();
    assert_eq!(err.code(), ErrorCode::InvalidInput);
}

#[tokio::test]
async fn a_missing_snapshot_is_not_found() {
    let app_data = tempdir().unwrap();
    let err = restore_snapshot(app_data.path(), "snap-nope")
        .await
        .unwrap_err();
    assert_eq!(err.code(), ErrorCode::NotFound);
    assert_eq!(err.i18n_key(), Some("errors.workflow.snapshotNotFound"));
}

#[tokio::test]
async fn corrupt_metadata_is_refused_as_invalid_not_as_missing() {
    let app_data = tempdir().unwrap();
    let dir = app_data.path().join("workflow-snapshots").join("snap-bad");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("metadata.json"), "{not json").unwrap();
    let err = restore_snapshot(app_data.path(), "snap-bad")
        .await
        .unwrap_err();
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(err.i18n_key(), Some("errors.workflow.snapshotUnreadable"));
}

/// A snapshot written before restore existed has no recorded root. Guessing
/// one (the caller's, the current workspace) is exactly how a restore could
/// be pointed somewhere it was never taken from — so it is refused.
#[tokio::test]
async fn a_snapshot_without_a_recorded_root_is_refused_not_guessed() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let file = ws_file(ws.path(), "a.md", "original");
    let dir = app_data
        .path()
        .join("workflow-snapshots")
        .join("snap-legacy");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("a.md"), "snapshot copy").unwrap();
    let legacy = serde_json::json!({
        "id": "snap-legacy",
        "execution_id": "legacy",
        "timestamp": 1,
        "files": [file.canonicalize().unwrap().to_string_lossy()],
    });
    std::fs::write(dir.join("metadata.json"), legacy.to_string()).unwrap();

    let err = restore_snapshot(app_data.path(), "snap-legacy")
        .await
        .unwrap_err();
    assert_eq!(err.code(), ErrorCode::Unsupported);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "original");
}

#[tokio::test]
async fn a_workspace_that_no_longer_exists_is_not_found() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let file = ws_file(ws.path(), "a.md", "x");
    let id = create_snapshot(app_data.path(), "moved-1", &[file], ws.path())
        .await
        .unwrap();
    let ws_path = ws.path().to_path_buf();
    drop(ws);
    assert!(!ws_path.exists());

    let err = restore_snapshot(app_data.path(), &id).await.unwrap_err();
    assert_eq!(err.code(), ErrorCode::NotFound);
    assert_eq!(
        err.i18n_key(),
        Some("errors.workflow.snapshotWorkspaceMissing")
    );
}

// -- containment: tampered metadata cannot aim a restore outside the root ------

#[tokio::test]
async fn tampered_paths_outside_the_recorded_root_are_skipped() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let victim = ws_file(outside.path(), "victim.md", "must survive");
    let file = ws_file(ws.path(), "a.md", "original");
    let id = create_snapshot(
        app_data.path(),
        "tamper-1",
        std::slice::from_ref(&file),
        ws.path(),
    )
    .await
    .unwrap();

    // Rewrite the record: one absolute path outside, one `..` escape, and a
    // created-file entry pointing at the victim.
    let meta = meta_path(app_data.path(), &id);
    let mut info: SnapshotInfo =
        serde_json::from_str(&std::fs::read_to_string(&meta).unwrap()).unwrap();
    let root = ws.path().canonicalize().unwrap();
    info.files.push(victim.to_string_lossy().to_string());
    info.files.push(
        root.join("..")
            .join("escape.md")
            .to_string_lossy()
            .to_string(),
    );
    info.created_files
        .push(victim.canonicalize().unwrap().to_string_lossy().to_string());
    std::fs::write(&meta, serde_json::to_string(&info).unwrap()).unwrap();

    let report = restore_snapshot(app_data.path(), &id).await.unwrap();
    assert_eq!(report.restored, 1, "the legitimate file is still restored");
    assert_eq!(report.skipped, 3);
    assert_eq!(std::fs::read_to_string(&victim).unwrap(), "must survive");
}

/// The first containment layer on its own. The end-to-end tamper test above
/// cannot see it: the layers behind it (the relative-path lookup, the parent
/// canonicalization, the anchored commit) also refuse, so disabling this check
/// was a mutation no restore test killed. Pinned directly instead.
#[test]
fn contained_accepts_only_absolute_dot_free_paths_strictly_under_the_root() {
    let root = tempdir().unwrap();
    let root = root.path().canonicalize().unwrap();
    let inside = root.join("notes").join("a.md");
    assert_eq!(contained(&inside.to_string_lossy(), &root), Ok(inside));

    let outside = root.parent().unwrap().join("victim.md");
    // (An interior `.` is not listed: `Path::components` drops it, so
    // `root/./a.md` IS `root/a.md` and is correctly accepted.)
    let parent_escape = root.join("..").join("victim.md");
    for rejected in [
        outside.to_string_lossy().to_string(),
        parent_escape.to_string_lossy().to_string(),
        "notes/a.md".to_string(),
        root.to_string_lossy().to_string(),
        String::new(),
    ] {
        assert!(
            contained(&rejected, &root).is_err(),
            "{rejected:?} must be refused"
        );
    }
}

/// A created-file entry that is now a SYMLINK is not followed: deleting the
/// canonical target would remove a file the run never made.
#[cfg(unix)]
#[tokio::test]
async fn a_created_path_replaced_by_a_symlink_is_not_deleted_through() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let keep = ws_file(ws.path(), "important.md", "keep me");
    let created = ws.path().join("out.md");
    let id = create_snapshot(
        app_data.path(),
        "link-1",
        std::slice::from_ref(&created),
        ws.path(),
    )
    .await
    .unwrap();
    std::os::unix::fs::symlink(&keep, &created).unwrap();

    let report = restore_snapshot(app_data.path(), &id).await.unwrap();
    assert_eq!(report.deleted, 0);
    assert_eq!(report.skipped, 1);
    assert_eq!(std::fs::read_to_string(&keep).unwrap(), "keep me");
}

/// A parent directory swapped for a symlink that leaves the workspace is
/// refused by the anchored commit; nothing is written outside.
#[cfg(unix)]
#[tokio::test]
async fn a_parent_swapped_for_an_escaping_symlink_is_not_written_through() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let file = ws_file(ws.path(), "sub/a.md", "original");
    let id = create_snapshot(
        app_data.path(),
        "swap-1",
        std::slice::from_ref(&file),
        ws.path(),
    )
    .await
    .unwrap();
    std::fs::remove_dir_all(ws.path().join("sub")).unwrap();
    std::os::unix::fs::symlink(outside.path(), ws.path().join("sub")).unwrap();

    let report = restore_snapshot(app_data.path(), &id).await.unwrap();
    assert_eq!(report.restored, 0);
    assert_eq!(report.skipped, 1);
    assert!(!outside.path().join("a.md").exists());
}

// -- list -----------------------------------------------------------------------

#[tokio::test]
async fn list_is_empty_before_any_snapshot() {
    let app_data = tempdir().unwrap();
    assert!(list_snapshots(app_data.path()).await.unwrap().is_empty());
}

#[tokio::test]
async fn list_summarises_each_snapshot_newest_first_and_skips_corrupt_ones() {
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let a = ws_file(ws.path(), "a.md", "x");
    let b = ws.path().join("b.md");
    create_snapshot(app_data.path(), "old", std::slice::from_ref(&a), ws.path())
        .await
        .unwrap();
    create_snapshot(app_data.path(), "new", &[a, b], ws.path())
        .await
        .unwrap();
    // Force a deterministic order: `timestamp` has one-second resolution.
    let old_meta = meta_path(app_data.path(), "snap-old");
    let mut info: SnapshotInfo =
        serde_json::from_str(&std::fs::read_to_string(&old_meta).unwrap()).unwrap();
    info.timestamp -= 10;
    std::fs::write(&old_meta, serde_json::to_string(&info).unwrap()).unwrap();
    let junk = app_data.path().join("workflow-snapshots").join("snap-junk");
    std::fs::create_dir_all(&junk).unwrap();
    std::fs::write(junk.join("metadata.json"), "nope").unwrap();

    let list = list_snapshots(app_data.path()).await.unwrap();
    let ids: Vec<&str> = list.iter().map(|s| s.execution_id.as_str()).collect();
    assert_eq!(ids, ["new", "old"]);
    assert_eq!(list[0].id, "snap-new");
    assert_eq!(list[0].file_count, 1);
    assert_eq!(list[0].created_count, 1);
}

#[test]
fn a_summary_serializes_in_camel_case_for_the_webview() {
    let summary = SnapshotSummary {
        id: "snap-x".into(),
        execution_id: "x".into(),
        timestamp: 7,
        file_count: 2,
        created_count: 1,
    };
    let json = serde_json::to_value(&summary).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "id": "snap-x", "executionId": "x", "timestamp": 7,
            "fileCount": 2, "createdCount": 1
        })
    );
    let report = serde_json::to_value(RestoreReport {
        restored: 1,
        deleted: 2,
        skipped: 3,
    })
    .unwrap();
    assert_eq!(
        report,
        serde_json::json!({ "restored": 1, "deleted": 2, "skipped": 3 })
    );
}
