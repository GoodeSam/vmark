//! Tests for `workspace_grants/mod.rs` — choosing a root, persisting it, and
//! re-issuing it at launch.
//!
//! WI-LX1.1 — a picked or Finder-opened root is granted and recorded; a
//! recorded root is granted again after a restart; a recorded name that now
//! resolves somewhere else is NOT.
//!
//! tauri::test::MockRuntime crashes the test binary at startup on
//! windows-latest (STATUS_ENTRYPOINT_NOT_FOUND) and tauri's `test` feature is
//! not enabled there, so the mock-app tests are gated like every other suite
//! of this kind in the crate (`fs_scope.test.rs`).

use std::time::Duration;

use super::{run_bounded, WorkspaceGrants};

#[test]
fn a_second_picker_is_refused_while_one_is_open() {
    let grants = WorkspaceGrants::default();
    let first = grants.begin_picker().expect("no picker open yet");
    assert!(
        grants.begin_picker().is_none(),
        "one folder dialog at a time"
    );
    drop(first);
    assert!(
        grants.begin_picker().is_some(),
        "closing the dialog frees the slot"
    );
}

#[test]
fn a_bounded_wait_returns_when_the_job_finishes() {
    assert!(run_bounded(Duration::from_secs(5), || {}));
}

#[test]
fn a_bounded_wait_gives_up_on_a_job_that_hangs() {
    // A recorded root on a stale network mount can block `canonicalize` for
    // the mount's own timeout. Launch must not wait that long.
    let started = std::time::Instant::now();
    let finished = run_bounded(Duration::from_millis(50), || {
        std::thread::sleep(Duration::from_secs(2));
    });
    assert!(!finished);
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "did not wait for the job"
    );
}

#[cfg(not(target_os = "windows"))]
mod with_app {
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    use tauri::Manager;
    use tauri_plugin_fs::FsExt;

    use super::super::{grant_chosen_root, restore_from, WorkspaceGrants, GRANTS_FILE};
    use crate::command_error::ErrorCode;

    const WAIT: Duration = Duration::from_secs(10);

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .manage(WorkspaceGrants::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app")
    }

    fn canonical(path: &Path) -> String {
        path.canonicalize()
            .expect("canonicalize")
            .to_str()
            .expect("utf-8")
            .to_owned()
    }

    /// `<tmp>/root/sub/deeper/note.md`, returning the root and the nested file.
    fn workspace() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("root");
        let deeper = root.join("sub").join("deeper");
        std::fs::create_dir_all(&deeper).expect("mkdir");
        let nested = deeper.join("note.md");
        std::fs::write(&nested, b"# hi").expect("write");
        (dir, root, nested)
    }

    fn readable<R: tauri::Runtime>(app: &tauri::App<R>, path: &Path) -> (bool, bool) {
        (
            app.fs_scope().is_allowed(path),
            app.asset_protocol_scope().is_allowed(path),
        )
    }

    #[test]
    fn a_chosen_root_is_granted_recursively_and_recorded() {
        let app = mock_app();
        let (_dir, root, nested) = workspace();
        assert_eq!(
            readable(&app, &nested),
            (false, false),
            "nothing granted yet"
        );

        let granted = grant_chosen_root(app.handle(), &root).expect("a real folder");

        assert_eq!(
            granted,
            canonical(&root),
            "the canonical target is what is granted"
        );
        assert_eq!(
            readable(&app, &nested),
            (true, true),
            "fs AND asset, whole tree"
        );
        assert!(app.state::<WorkspaceGrants>().covers(&granted));
    }

    #[test]
    fn choosing_a_file_grants_and_records_nothing() {
        let app = mock_app();
        let (_dir, _root, nested) = workspace();

        let err = grant_chosen_root(app.handle(), &nested).expect_err("a file is not a root");

        assert_eq!(err.code(), ErrorCode::InvalidInput);
        assert_eq!(readable(&app, &nested), (false, false));
        assert!(!app.state::<WorkspaceGrants>().covers(&canonical(&nested)));
    }

    #[test]
    fn choosing_a_missing_folder_is_not_found() {
        let app = mock_app();
        let (dir, _root, _nested) = workspace();

        let err =
            grant_chosen_root(app.handle(), &dir.path().join("gone")).expect_err("nothing there");

        assert_eq!(err.code(), ErrorCode::NotFound);
    }

    #[test]
    fn a_chosen_root_is_granted_again_after_a_restart() {
        let data = tempfile::tempdir().expect("app data");
        let file = data.path().join(GRANTS_FILE);
        let (_dir, root, nested) = workspace();

        let first = mock_app();
        restore_from(first.handle(), file.clone(), WAIT);
        grant_chosen_root(first.handle(), &root).expect("grant");
        assert!(file.exists(), "the choice is persisted when it is made");

        // A new process: runtime grants start empty.
        let second = mock_app();
        assert_eq!(readable(&second, &nested), (false, false));
        restore_from(second.handle(), file, WAIT);

        assert_eq!(
            readable(&second, &nested),
            (true, true),
            "re-issued at launch"
        );
        assert!(second.state::<WorkspaceGrants>().covers(&canonical(&root)));
    }

    /// #250 in another place: Tauri's `push_pattern` also inserts the CANONICAL
    /// form of whatever it is given, resolved at grant time. Re-granting a
    /// recorded NAME that has since become a link would grant the link's target.
    #[cfg(unix)]
    #[test]
    fn a_recorded_root_that_now_resolves_elsewhere_is_not_granted_at_launch() {
        let data = tempfile::tempdir().expect("app data");
        let file = data.path().join(GRANTS_FILE);
        let (_dir, root, _nested) = workspace();
        let elsewhere = tempfile::tempdir().expect("elsewhere");
        let secret = elsewhere.path().join("secret.md");
        std::fs::write(&secret, b"# theirs").expect("write");

        let first = mock_app();
        restore_from(first.handle(), file.clone(), WAIT);
        let recorded = grant_chosen_root(first.handle(), &root).expect("grant");

        // The recorded folder is replaced by a link to somewhere else.
        std::fs::remove_dir_all(&recorded).expect("rm root");
        std::os::unix::fs::symlink(elsewhere.path(), &recorded).expect("link");

        let second = mock_app();
        restore_from(second.handle(), file, WAIT);

        assert_eq!(
            readable(&second, &secret),
            (false, false),
            "the target was never chosen"
        );
        assert_eq!(
            readable(&second, &Path::new(&recorded).join("secret.md")),
            (false, false),
            "nor is it reachable through the old name"
        );
    }

    #[test]
    fn a_list_this_build_cannot_read_grants_nothing() {
        let data = tempfile::tempdir().expect("app data");
        let file = data.path().join(GRANTS_FILE);
        let (_dir, root, nested) = workspace();
        let forged = serde_json::json!({ "version": 99, "roots": [canonical(&root)] });
        std::fs::write(&file, forged.to_string()).expect("write");

        let app = mock_app();
        restore_from(app.handle(), file.clone(), WAIT);

        assert_eq!(readable(&app, &nested), (false, false));
        assert!(!app.state::<WorkspaceGrants>().covers(&canonical(&root)));

        // And the next choice replaces it with a list this build CAN read.
        grant_chosen_root(app.handle(), &root).expect("grant");
        let bytes = std::fs::read(&file).expect("rewritten");
        assert!(super::super::registry::GrantList::parse(&bytes).is_ok());
    }

    #[test]
    fn the_list_file_is_fenced_off_from_the_fs_plugin() {
        // The static capability scope covers `$HOME/**`, which is where the app
        // data directory lives on macOS and Windows: without this, a script
        // could write its own roots into the list through `writeTextFile`.
        let data = tempfile::tempdir().expect("app data");
        let file = data.path().join(GRANTS_FILE);

        let app = mock_app();
        restore_from(app.handle(), file.clone(), WAIT);

        assert!(app.fs_scope().is_forbidden(&file));
    }
}

// -- The list refuses webview-supplied writes (WI-LX1.1) ----------------------
//
// `atomic_write_file` writes any absolute path, so without this a script could
// write its own roots into the list and have them granted at the next launch.
// A write lands on the list if its folder is the list's folder (compared after
// resolving links, so an aliased folder is caught) and its name is the list's
// name ignoring ASCII case (macOS and Windows file systems ignore it too).
mod names_grant_list {
    use std::path::Path;

    use super::super::protect::names_grant_list;
    use super::super::GRANTS_FILE;

    fn data() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let list = dir.path().join(GRANTS_FILE);
        (dir, list)
    }

    #[test]
    fn the_list_itself() {
        let (_dir, list) = data();
        assert!(names_grant_list(&list, &list));
    }

    #[test]
    fn a_case_variant_of_its_name() {
        let (dir, list) = data();
        assert!(names_grant_list(
            &list,
            &dir.path().join("WORKSPACE-Grants.JSON")
        ));
    }

    #[cfg(unix)]
    #[test]
    fn its_name_under_a_linked_folder() {
        let (dir, list) = data();
        let elsewhere = tempfile::tempdir().expect("elsewhere");
        let alias = elsewhere.path().join("alias");
        std::os::unix::fs::symlink(dir.path(), &alias).expect("link");
        assert!(names_grant_list(&list, &alias.join(GRANTS_FILE)));
    }

    #[test]
    fn not_its_name_in_another_folder() {
        let (_dir, list) = data();
        let other = tempfile::tempdir().expect("other");
        assert!(!names_grant_list(&list, &other.path().join(GRANTS_FILE)));
    }

    #[test]
    fn not_another_file_beside_it() {
        let (dir, list) = data();
        assert!(!names_grant_list(&list, &dir.path().join("notes.md")));
        assert!(!names_grant_list(
            &list,
            &dir.path().join("workspace-grants.json.bak")
        ));
    }

    #[test]
    fn not_a_path_whose_folder_does_not_exist() {
        // Nothing can be written there, so there is nothing to refuse.
        let (_dir, list) = data();
        assert!(!names_grant_list(
            &list,
            Path::new("/no/such/dir/workspace-grants.json")
        ));
    }
}

#[cfg(not(target_os = "windows"))]
mod list_protection {
    use std::time::Duration;

    use tauri_plugin_fs::FsExt;

    use super::super::{refuse_list_write, restore_from, WorkspaceGrants, GRANTS_FILE};
    use crate::command_error::ErrorCode;

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .manage(WorkspaceGrants::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app")
    }

    #[test]
    fn a_write_to_the_list_is_refused_with_a_typed_localized_error() {
        let data = tempfile::tempdir().expect("app data");
        let file = data.path().join(GRANTS_FILE);
        let app = mock_app();
        restore_from(app.handle(), file.clone(), Duration::from_secs(5));

        let err = refuse_list_write(app.handle(), &file).expect_err("the list is Rust's");

        assert_eq!(err.code(), ErrorCode::PermissionDenied);
        assert_eq!(err.i18n_key(), Some("errors.workspaceAccess.listProtected"));
        assert!(refuse_list_write(app.handle(), &data.path().join("notes.md")).is_ok());
    }

    #[test]
    fn launch_creates_a_missing_list_so_the_fence_covers_every_spelling() {
        // The fs-plugin fence is a case-sensitive glob. A file that does not
        // exist is matched as spelled, so `WORKSPACE-GRANTS.JSON` would slip
        // past it and, on a case-insensitive disk, create the list. Once the
        // file exists, a request is canonicalized to its real name first.
        let data = tempfile::tempdir().expect("app data");
        let file = data.path().join(GRANTS_FILE);
        let app = mock_app();

        restore_from(app.handle(), file.clone(), Duration::from_secs(5));

        let bytes = std::fs::read(&file).expect("created at launch");
        assert!(
            super::super::registry::GrantList::parse(&bytes).is_ok(),
            "an empty, valid list"
        );
        #[cfg(target_os = "macos")]
        assert!(app
            .fs_scope()
            .is_forbidden(data.path().join("WORKSPACE-GRANTS.JSON")));
    }
}

// A workflow run's workspace root bounds every `action/*` step, so a root that
// CONTAINS the list's folder would let a `save-file` step rewrite the list
// (WI-LX1.1 follow-up). The run is refused up front instead.
mod root_contains_list {
    use super::super::protect::root_contains_list;
    use super::super::GRANTS_FILE;

    fn data() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let app_data = dir.path().join("app.vmark");
        std::fs::create_dir_all(&app_data).expect("app data");
        let list = app_data.join(GRANTS_FILE);
        (dir, list)
    }

    #[test]
    fn a_root_that_is_the_list_folder_or_above_it_contains_the_list() {
        let (dir, list) = data();
        assert!(root_contains_list(&list, list.parent().unwrap()));
        assert!(root_contains_list(&list, dir.path()));
    }

    #[test]
    fn a_sibling_or_a_folder_inside_app_data_does_not() {
        let (dir, list) = data();
        let sibling = dir.path().join("app.vmark-notes");
        std::fs::create_dir_all(&sibling).unwrap();
        assert!(!root_contains_list(&list, &sibling));
        let inner = list.parent().unwrap().join("workspaces");
        std::fs::create_dir_all(&inner).unwrap();
        assert!(!root_contains_list(&list, &inner));
    }

    #[cfg(unix)]
    #[test]
    fn a_root_that_links_to_an_ancestor_of_the_list_contains_it() {
        let (dir, list) = data();
        let link = tempfile::tempdir().unwrap();
        let alias = link.path().join("alias");
        std::os::unix::fs::symlink(dir.path(), &alias).unwrap();
        assert!(root_contains_list(&list, &alias));
    }

    #[test]
    fn a_root_that_does_not_exist_does_not() {
        let (dir, list) = data();
        assert!(!root_contains_list(&list, &dir.path().join("missing")));
    }
}
