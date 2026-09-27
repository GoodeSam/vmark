//! Tests for `file_write.rs` (moved with the code out of `lib.test.rs`;
//! included via `#[path]`).
//!
//! WI-14 — this command is the first migration to `CommandError`. It was the
//! clearest case in the crate: the parent-directory failure travelled as a
//! `"PARENT_MISSING:"` STRING PREFIX that `saveToPath.ts` re-parsed, with a
//! comment in each language telling the next reader to keep the other in sync.
//! The assertions below are on the exact serialized wire value, because that —
//! not the Display text — is what the frontend branches on.

use super::atomic_write_file_sync;
use crate::command_error::ErrorCode;
use serde_json::json;

#[test]
fn atomic_write_succeeds_when_parent_dir_exists() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let target = dir.path().join("note.md");

    atomic_write_file_sync(&target, "hello").expect("write should succeed");

    let read_back = std::fs::read_to_string(&target).expect("read back");
    assert_eq!(read_back, "hello");
}

#[test]
fn missing_parent_dir_is_a_typed_not_found_carrying_the_directory() {
    // Regression test: if the parent directory was renamed/deleted between open
    // and save, `NamedTempFile::new_in` would fail with a raw "No such file or
    // directory (os error 2)". The frontend routes this into Save As — it used
    // to recognize it by string prefix; now it reads `code` and `detail.dir`.
    let dir = tempfile::tempdir().expect("create tempdir");
    let gone = dir.path().join("renamed-away");
    let target = gone.join("note.md");
    // gone/ is intentionally never created — the parent does not exist.

    let err = atomic_write_file_sync(&target, "hello")
        .expect_err("write must fail when parent dir is missing");

    assert_eq!(err.code(), ErrorCode::NotFound);
    assert_eq!(err.i18n_key(), Some("errors.save.parentMissing"));
    assert_eq!(
        err.detail()
            .and_then(|d| d.get("dir"))
            .and_then(|v| v.as_str()),
        Some(gone.to_string_lossy().as_ref()),
        "the missing directory must be machine-readable, not embedded in prose"
    );
    // Belt-and-suspenders: we still do NOT leak the raw OS error.
    assert!(
        !err.message().contains("os error 2"),
        "raw OS error must not leak when parent is missing, got: {}",
        err.message()
    );
}

/// Level 3 — the value the frontend actually receives. `serde_json::to_value`
/// is the same serialization Tauri performs on a rejected command, so this
/// pins the whole wire contract, not just the Rust-side accessors.
#[test]
fn missing_parent_dir_serializes_to_the_exact_wire_value() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let gone = dir.path().join("vanished");
    let err = atomic_write_file_sync(&gone.join("note.md"), "hello").expect_err("must fail");

    let value = serde_json::to_value(&err).expect("serialize as Tauri does");
    assert_eq!(value["code"], json!("not-found"));
    assert_eq!(value["i18nKey"], json!("errors.save.parentMissing"));
    assert_eq!(value["detail"]["dir"], json!(gone.to_string_lossy()));
    assert!(
        value
            .get("message")
            .and_then(|m| m.as_str())
            .is_some_and(|m| !m.is_empty()),
        "a human-readable fallback message is part of the contract"
    );
    let keys: Vec<&str> = value
        .as_object()
        .expect("object")
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        vec!["code", "message", "i18nKey", "detail"],
        "no extra fields may appear on the wire"
    );
}

#[test]
fn path_traversal_is_invalid_input_not_an_io_failure() {
    let err = atomic_write_file_sync(std::path::Path::new("/tmp/../etc/passwd"), "x")
        .expect_err("traversal must be refused");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(err.i18n_key(), Some("errors.core.pathTraversal"));
}

#[test]
fn relative_path_is_invalid_input() {
    let err = atomic_write_file_sync(std::path::Path::new("notes/note.md"), "x")
        .expect_err("relative path must be refused");
    assert_eq!(err.code(), ErrorCode::InvalidInput);
    assert_eq!(err.i18n_key(), Some("errors.core.pathNotAbsolute"));
}

/// Overwriting an existing file must preserve its permission bits — the
/// temp-file + rename dance would otherwise silently reset an executable
/// 0755 script to the temp file's 0600.
#[cfg(unix)]
#[test]
fn atomic_write_preserves_existing_permissions() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().expect("create tempdir");
    let target = dir.path().join("script.md");
    std::fs::write(&target, "old").expect("seed file");
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755))
        .expect("set mode 0755");

    atomic_write_file_sync(&target, "new").expect("write should succeed");

    assert_eq!(std::fs::read_to_string(&target).expect("read back"), "new");
    let mode = std::fs::metadata(&target)
        .expect("metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(mode, 0o755, "atomic write must not reset permissions");
}

#[test]
fn parent_that_is_a_file_reports_the_same_not_found_class() {
    // Edge case: parent path exists but isn't a directory (someone replaced the
    // folder with a file of the same name). Same user-visible situation, so it
    // must reach the same Save As route — one code, not two.
    let dir = tempfile::tempdir().expect("create tempdir");
    let parent_as_file = dir.path().join("not-a-dir");
    std::fs::write(&parent_as_file, b"oops").expect("create file");
    let target = parent_as_file.join("note.md");

    let err = atomic_write_file_sync(&target, "hello")
        .expect_err("write must fail when parent is a file, not a dir");
    assert_eq!(err.code(), ErrorCode::NotFound);
    assert_eq!(err.i18n_key(), Some("errors.save.parentMissing"));
}

#[test]
fn cjk_content_and_path_survive_the_write_and_the_error_path() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let target = dir.path().join("日记.md");
    atomic_write_file_sync(&target, "# 标题\n中文正文").expect("write should succeed");
    assert_eq!(
        std::fs::read_to_string(&target).expect("read back"),
        "# 标题\n中文正文"
    );

    let gone = dir.path().join("已删除的文件夹");
    let err = atomic_write_file_sync(&gone.join("日记.md"), "x").expect_err("must fail");
    let value = serde_json::to_value(&err).expect("serialize");
    assert_eq!(value["detail"]["dir"], json!(gone.to_string_lossy()));
}

// -- WI-LX1.1: the workspace-grant list is not a document ---------------------
//
// `atomic_write_file` writes any absolute path the webview names, so it could
// write roots of a script's choosing into `workspace-grants.json` and have
// them granted at the next launch. Both generic writers refuse the list —
// by its own name, through a link to it, and through a linked folder — with a
// typed `permission-denied`, and leave it untouched. Gated like every
// mock-runtime suite in the crate (tauri's `test` feature is off on Windows).
#[cfg(not(target_os = "windows"))]
mod grant_list {
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    use super::super::{atomic_write_file, create_file_exclusive};
    use crate::command_error::{CommandError, ErrorCode};
    use crate::workspace_grants::{restore_from, WorkspaceGrants, GRANTS_FILE};

    const FORGED: &str = r#"["vmark-workspace-grants/1","/"]"#;

    fn app_with_list() -> (
        tauri::App<tauri::test::MockRuntime>,
        tempfile::TempDir,
        PathBuf,
    ) {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .manage(WorkspaceGrants::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app");
        let data = tempfile::tempdir().expect("app data");
        let list = data.path().join(GRANTS_FILE);
        restore_from(app.handle(), list.clone(), Duration::from_secs(5));
        (app, data, list)
    }

    fn write(app: &tauri::App<tauri::test::MockRuntime>, path: &Path) -> Result<(), CommandError> {
        tauri::async_runtime::block_on(atomic_write_file(
            app.handle().clone(),
            path.to_str().expect("utf-8").to_owned(),
            FORGED.to_owned(),
        ))
    }

    fn assert_refused(result: Result<(), CommandError>) {
        let err = result.expect_err("the grant list is written by VMark alone");
        assert_eq!(err.code(), ErrorCode::PermissionDenied);
        assert_eq!(err.i18n_key(), Some("errors.workspaceAccess.listProtected"));
    }

    #[test]
    fn a_save_onto_the_list_is_refused_and_leaves_it_untouched() {
        let (app, _data, list) = app_with_list();
        let before = std::fs::read(&list).expect("created at launch");

        assert_refused(write(&app, &list));

        assert_eq!(std::fs::read(&list).expect("still there"), before);
    }

    #[cfg(unix)]
    #[test]
    fn a_save_through_a_link_to_the_list_is_refused() {
        let (app, _data, list) = app_with_list();
        let before = std::fs::read(&list).expect("created at launch");
        let docs = tempfile::tempdir().expect("docs");
        let link = docs.path().join("note.md");
        std::os::unix::fs::symlink(&list, &link).expect("link");

        assert_refused(write(&app, &link));

        assert_eq!(std::fs::read(&list).expect("still there"), before);
    }

    #[cfg(unix)]
    #[test]
    fn a_save_through_a_linked_folder_is_refused() {
        let (app, data, list) = app_with_list();
        let before = std::fs::read(&list).expect("created at launch");
        let docs = tempfile::tempdir().expect("docs");
        let alias = docs.path().join("alias");
        std::os::unix::fs::symlink(data.path(), &alias).expect("link");

        assert_refused(write(&app, &alias.join(GRANTS_FILE)));

        assert_eq!(std::fs::read(&list).expect("still there"), before);
    }

    #[test]
    fn a_save_beside_the_list_still_works() {
        let (app, data, _list) = app_with_list();
        let note = data.path().join("note.md");

        write(&app, &note).expect("an ordinary document");

        assert_eq!(std::fs::read_to_string(&note).expect("written"), FORGED);
    }

    #[test]
    fn claiming_the_list_name_is_refused() {
        let (app, _data, list) = app_with_list();
        std::fs::remove_file(&list).expect("start with no list");

        let result = tauri::async_runtime::block_on(create_file_exclusive(
            app.handle().clone(),
            list.to_str().expect("utf-8").to_owned(),
        ));

        let err = result.expect_err("the grant list is created by VMark alone");
        assert_eq!(err.code(), ErrorCode::PermissionDenied);
        assert!(!list.exists(), "nothing was created");
    }
}
