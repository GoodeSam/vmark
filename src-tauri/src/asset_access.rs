//! Per-file asset-protocol access grants for the media viewer.
//!
//! Media tabs never read their file as text, so they skip the `readTextFile`
//! path that extends the scopes for text documents. The frontend calls
//! `grant_asset_access` before mounting the media surface so `convertFileSrc`
//! (asset://) can serve the file instead of returning 403.
//!
//! Threat model (WI-LX1.2). The asset-protocol scope in `tauri.conf.json` is
//! the fs capability's static roots — `$HOME/**`, `/Volumes/**`, `/mnt/**`,
//! `/media/**`, plus `C:\` to `F:\` on Windows via `tauri.windows.conf.json`
//! (pinned by `capabilities.test.rs`). Until 0.9.84 it was `**/*`, which matched
//! every absolute path without a dot component, so this gate guarded nothing.
//! It is now the boundary: this command is invocable from webview JS, so an
//! injected script could otherwise grant itself asset:// read of ANY path
//! (e.g. `/etc/passwd`) and exfiltrate it. Grants are therefore restricted to
//! files whose extension is a previewable media type — the only thing the
//! media viewer ever legitimately needs.
//!
//! What it does NOT bound is WHICH media file: any image, video or audio file
//! the user can read, anywhere on disk, is grantable. The grant goes through
//! `allow_fs_read`, so it extends the fs scope as well, and a runtime fs grant
//! is accepted by every fs command the capability permits, write and remove
//! included (`fs_scope.rs`).

/// Media extensions eligible for an asset-protocol grant (lowercased, no dot).
///
/// Source of truth: `src/utils/mediaExtensions.ts` (image + video + audio),
/// and `media_extensions_match_the_frontend_list` below fails when the two
/// differ. Also mirrors the media block of `SUPPORTED_EXTENSIONS` in
/// `supported_files.rs`, which `scripts/check-ext-sync.sh` checks against the
/// frontend registry.
const MEDIA_EXTENSIONS: &[&str] = &[
    // Images (svg is a previewable image for the media viewer)
    "png", "jpg", "jpeg", "jfif", "gif", "webp", "svg", "bmp", "ico", "avif", "apng", "heic",
    "heif", "tiff", "tif", // Video
    "mp4", "webm", "mov", "avi", "mkv", "m4v", "ogv", "mpeg", "mpg", "wmv", "flv", "3gp",
    // Audio
    "mp3", "m4a", "ogg", "oga", "wav", "flac", "aac", "opus", "weba", "aiff", "wma",
];

/// True if `path` has a previewable media extension (case-insensitive).
///
/// Extension-only check — does not touch the filesystem. A traversal string
/// like `../../etc/passwd` has no media extension and is rejected.
fn is_media_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lowered = ext.to_ascii_lowercase();
            MEDIA_EXTENSIONS.iter().any(|allowed| *allowed == lowered)
        })
        .unwrap_or(false)
}

/// Grant the webview asset:// + fs read access to one media file.
///
/// Rejects non-media paths so injected webview JS can never widen the
/// asset-protocol scope to arbitrary files. The `allow_fs_read` step itself
/// stays best-effort (failures are logged, not fatal) — `MediaView` already
/// falls back on a 403 — but a non-media path is a hard `Err` that never
/// extends the scope.
#[tauri::command]
pub fn grant_asset_access(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !is_media_extension(std::path::Path::new(&path)) {
        return Err("not a previewable media file".to_string());
    }
    crate::allow_fs_read(&app, &path);
    Ok(())
}

#[cfg(test)]
mod tests {
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
    /// granted. A format added on one side only is either refused its preview
    /// or grantable with no preview that needs it.
    #[test]
    fn media_extensions_match_the_frontend_list() {
        let ts = include_str!("../../src/utils/mediaExtensions.ts");
        let mut frontend: Vec<&str> = ["IMAGE_EXTENSIONS", "VIDEO_EXTENSIONS", "AUDIO_EXTENSIONS"]
            .iter()
            .flat_map(|name| {
                let decl = format!("export const {name} = [");
                let start = ts.find(&decl).unwrap_or_else(|| panic!("{decl} not found"));
                let body = &ts[start + decl.len()..];
                let body = &body[..body.find(']').expect("list closes")];
                body.split('"').skip(1).step_by(2).collect::<Vec<_>>()
            })
            .collect();
        frontend.sort_unstable();
        let mut backend = MEDIA_EXTENSIONS.to_vec();
        backend.sort_unstable();
        assert!(
            !frontend.is_empty(),
            "parsed nothing from mediaExtensions.ts"
        );
        assert_eq!(backend, frontend);
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
}
