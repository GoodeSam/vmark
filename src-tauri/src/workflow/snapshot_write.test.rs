//! The restore's filesystem half: a delete of a file the run created, and the
//! windows an attacker would need to redirect it (#75).

use super::*;
use tempfile::tempdir;

fn held(ws: &Path) -> HeldRoot {
    HeldRoot::open(ws.canonicalize().expect("canonical root")).expect("the root opens")
}

#[test]
fn a_created_file_inside_the_root_is_deleted_and_a_missing_one_is_not_an_error() {
    let ws = tempdir().unwrap();
    let root = held(ws.path());
    let made = root.path().join("sub").join("out.md");
    std::fs::create_dir(root.path().join("sub")).unwrap();
    std::fs::write(&made, "made by the run").unwrap();

    assert_eq!(delete_created(&made, &root), Ok(true));
    assert!(!made.exists());
    assert_eq!(delete_created(&made, &root), Ok(false), "already gone");
    assert_eq!(
        delete_created(&root.path().join("gone").join("out.md"), &root),
        Ok(false),
        "a parent that is gone holds no file"
    );
}

#[test]
fn a_directory_at_the_name_is_not_deleted() {
    let ws = tempdir().unwrap();
    let root = held(ws.path());
    std::fs::create_dir(root.path().join("out.md")).unwrap();

    assert!(delete_created(&root.path().join("out.md"), &root).is_err());
    assert!(root.path().join("out.md").is_dir());
}

/// #75 — the parent is swapped for an escaping link AFTER it was proved inside
/// the root and BEFORE the unlink: the window a path-based `remove_file`
/// resolves the name through again. Nothing outside may be deleted.
#[cfg(unix)]
#[test]
fn a_parent_swapped_after_the_check_deletes_nothing_outside() {
    let ws = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let root = held(ws.path());
    let sub = root.path().join("sub");
    std::fs::create_dir(&sub).unwrap();
    std::fs::write(sub.join("out.md"), "made by the run").unwrap();
    let victim = outside.path().join("out.md");
    std::fs::write(&victim, "victim").unwrap();

    let result = delete_created_with(&sub.join("out.md"), &root, || {
        std::fs::rename(&sub, root.path().join("sub-moved")).unwrap();
        std::os::unix::fs::symlink(outside.path(), &sub).unwrap();
    });

    assert_eq!(
        std::fs::read_to_string(&victim).unwrap(),
        "victim",
        "the file behind the link survives"
    );
    assert_eq!(
        result,
        Ok(true),
        "the run's own file, in the directory held, goes"
    );
    assert!(!root.path().join("sub-moved").join("out.md").exists());
}

/// #74 (round 2) — the root was canonicalized, then OPENED by name: two
/// resolutions of one path. A root, or any directory above it, swapped for a
/// link in between made the held directory the attacker's choice. The open
/// now walks the canonical path without following a link at any component,
/// so a swap in that window is refused rather than followed.
#[cfg(unix)]
#[test]
fn a_root_or_an_ancestor_swapped_for_a_link_after_resolution_is_refused() {
    use std::os::unix::fs::symlink;
    let base = tempdir().unwrap();
    let elsewhere = base.path().join("elsewhere");
    std::fs::create_dir_all(elsewhere.join("ws")).unwrap();

    // The root itself.
    let ws = base.path().join("ws");
    std::fs::create_dir(&ws).unwrap();
    let canonical = ws.canonicalize().unwrap();
    std::fs::rename(&ws, base.path().join("ws-moved")).unwrap();
    symlink(elsewhere.join("ws"), &ws).unwrap();
    assert!(
        HeldRoot::open(canonical).is_err(),
        "a swapped root is not held"
    );

    // A directory above it.
    let above = base.path().join("above");
    std::fs::create_dir_all(above.join("ws")).unwrap();
    let canonical = above.join("ws").canonicalize().unwrap();
    std::fs::rename(&above, base.path().join("above-moved")).unwrap();
    symlink(&elsewhere, &above).unwrap();
    assert!(
        HeldRoot::open(canonical).is_err(),
        "a swapped ancestor is not followed"
    );

    // Unswapped, the same walk holds the root.
    let kept = base.path().join("kept");
    std::fs::create_dir(&kept).unwrap();
    assert!(HeldRoot::open(kept.canonicalize().unwrap()).is_ok());
}
