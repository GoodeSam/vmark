//! Tests for `asset_access.rs` — the media viewer's per-file grant.
//!
//! WI-LX1.2 — the command is invocable from webview JS, so it must never widen
//! a scope past one previewable media file: not by extension, not through a
//! link NAMED like media, and not into the write-capable fs scope.

use super::*;
use std::path::Path;

#[test]
fn accepts_image_video_audio_extensions() {
    for p in [
        "/x/a.png",
        "/x/a.PNG",
        "/x/clip.mp4",
        "/x/song.mp3",
        "/x/vector.svg",
    ] {
        assert!(is_media_extension(Path::new(p)), "should accept {p}");
    }
}

/// The frontend decides what is media; this list decides what may be
/// granted. Both read ONE file, `src/utils/mediaExtensions.json` — embedded
/// here at compile time — so there is no second list to drift. What is left
/// to pin is that the embedded file parses, and holds what the viewer needs.
#[test]
fn media_extensions_come_from_the_shared_file() {
    let exts = media_extensions();
    for ext in ["png", "svg", "heic", "mp4", "3gp", "mp3", "wma"] {
        assert!(exts.iter().any(|e| e == ext), "{ext} missing");
    }
    assert_eq!(exts.len(), 38, "image 15 + video 12 + audio 11");
    let parsed = parse_media_extensions(MEDIA_EXTENSIONS_JSON).expect("embedded file parses");
    assert_eq!(parsed, exts.to_vec());
}

#[test]
fn refuses_a_malformed_extension_file_by_name() {
    for (json, why) in [
        ("[]", "an object"),
        (r#"{"image":["png"],"video":["mp4"]}"#, "\"audio\""),
        (
            r#"{"image":["png"],"video":["mp4"],"audio":["mp3"],"other":["x"]}"#,
            "\"other\"",
        ),
        (
            r#"{"image":"png","video":["mp4"],"audio":["mp3"]}"#,
            "\"image\"",
        ),
        (
            r#"{"image":[".png"],"video":["mp4"],"audio":["mp3"]}"#,
            ".png",
        ),
        (
            r#"{"image":["PNG"],"video":["mp4"],"audio":["mp3"]}"#,
            "PNG",
        ),
        (
            r#"{"image":["png"],"video":["png"],"audio":["mp3"]}"#,
            "twice",
        ),
        (r#"{"image":[],"video":["mp4"],"audio":["mp3"]}"#, "empty"),
        ("not json", "JSON"),
    ] {
        let err = parse_media_extensions(json).expect_err(json);
        assert!(err.contains(why), "{json}: expected {why:?} in {err:?}");
    }
}

#[test]
fn rejects_non_media_and_traversal_paths() {
    for p in [
        "/x/lib.rs",
        "/x/notes.txt",
        "../../etc/passwd",
        "/etc/passwd",
        "/x/noext",
        "/x/.hidden",
    ] {
        assert!(!is_media_extension(Path::new(p)), "should reject {p}");
    }
}

// -- The grant itself, on a mock app ------------------------------------------
//
// Gated like every mock-runtime suite in the crate: tauri's `test` feature is
// off on Windows.
#[cfg(not(target_os = "windows"))]
mod granting {
    use std::path::Path;

    use tauri::Manager;
    use tauri_plugin_fs::FsExt;

    use super::super::grant_media;

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app")
    }

    fn picture() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("photo.png");
        std::fs::write(&file, b"\x89PNG").expect("write");
        (dir, file)
    }

    #[test]
    fn a_media_file_becomes_servable_over_asset() {
        let app = mock_app();
        let (_dir, file) = picture();

        grant_media(app.handle(), &file).expect("media");

        assert!(app.asset_protocol_scope().is_allowed(&file));
    }

    /// The media viewer only ever loads over asset://, and a runtime fs grant
    /// is accepted by every fs command the capability permits — write and
    /// remove included. A preview has no business granting either.
    #[test]
    fn the_grant_does_not_reach_the_write_capable_fs_scope() {
        let app = mock_app();
        let (_dir, file) = picture();

        grant_media(app.handle(), &file).expect("media");

        assert!(!app.fs_scope().is_allowed(&file));
    }

    /// Tauri inserts the CANONICAL form of a granted path too, so a link named
    /// `secret.png` would grant whatever it points at. The extension that
    /// matters is the target's.
    #[cfg(unix)]
    #[test]
    fn a_link_named_like_media_to_a_non_media_file_grants_nothing() {
        let app = mock_app();
        let outside = tempfile::tempdir().expect("outside");
        let secret = outside.path().join("id_rsa");
        std::fs::write(&secret, b"-----BEGIN").expect("write");
        let docs = tempfile::tempdir().expect("docs");
        let disguised = docs.path().join("secret.png");
        std::os::unix::fs::symlink(&secret, &disguised).expect("link");

        let err = grant_media(app.handle(), &disguised).expect_err("not media");

        assert!(err.contains("not a previewable media file"), "{err}");
        assert!(!app.asset_protocol_scope().is_allowed(&secret));
        assert!(!app.fs_scope().is_allowed(&secret));
    }

    /// A link to a real media file still previews: the target is what is
    /// judged and what is granted, and a request by the link's name resolves to
    /// it.
    #[cfg(unix)]
    #[test]
    fn a_link_to_a_media_file_previews_through_its_target() {
        let app = mock_app();
        let (_dir, file) = picture();
        let docs = tempfile::tempdir().expect("docs");
        let alias = docs.path().join("alias.png");
        std::os::unix::fs::symlink(&file, &alias).expect("link");

        grant_media(app.handle(), &alias).expect("media behind a link");

        assert!(app.asset_protocol_scope().is_allowed(&alias));
        assert!(app.asset_protocol_scope().is_allowed(&file));
    }

    #[test]
    fn a_media_file_that_does_not_exist_is_refused() {
        let app = mock_app();
        let (dir, _file) = picture();
        let gone = dir.path().join("gone.png");

        assert!(grant_media(app.handle(), &gone).is_err());
        assert!(!app.asset_protocol_scope().is_allowed(Path::new(&gone)));
    }
}
