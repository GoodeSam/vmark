//! Tests for `app_setup.rs` (included via `#[path]`).
//!
//! WI-FL5.9 — `machine_id_hash` is the only fact about a machine VMark ever
//! sends (the `X-Machine-Id` header on update checks). It must be stable
//! across launches and releases, opaque, and carry no PII.

use crate::app_setup::machine_id_hash;
use sha2::{Digest, Sha256};

fn is_lowercase_hex(s: &str) -> bool {
    s.bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[test]
fn the_machine_id_is_a_64_char_lowercase_hex_digest() {
    let id = machine_id_hash();
    assert_eq!(id.len(), 64, "{id}");
    assert!(is_lowercase_hex(&id), "{id}");
}

#[test]
fn the_machine_id_is_stable_across_calls() {
    assert_eq!(machine_id_hash(), machine_id_hash());
}

#[test]
fn the_machine_id_is_the_documented_digest_of_prefix_host_os_and_arch() {
    // The recipe is the contract: the update server keys on this value, so
    // changing the prefix, the separators or an input silently re-identifies
    // every installation. Recomputed here from the documented inputs.
    let hostname = gethostname::gethostname().to_string_lossy().into_owned();
    let documented = format!(
        "{:x}",
        Sha256::digest(
            format!(
                "vmark-machine-id-v1:{}:{}:{}",
                hostname,
                std::env::consts::OS,
                std::env::consts::ARCH
            )
            .as_bytes()
        )
    );
    assert_eq!(machine_id_hash(), documented);

    // Any other hostname under the same recipe yields a different id — the
    // "different inputs, different outputs" half, stated against the recipe.
    let other = format!(
        "{:x}",
        Sha256::digest(
            format!(
                "vmark-machine-id-v1:{}-other:{}:{}",
                hostname,
                std::env::consts::OS,
                std::env::consts::ARCH
            )
            .as_bytes()
        )
    );
    assert_ne!(machine_id_hash(), other);
}

#[test]
fn the_machine_id_does_not_contain_the_raw_hostname() {
    let id = machine_id_hash();
    let hostname = gethostname::gethostname()
        .to_string_lossy()
        .to_ascii_lowercase();
    // A hostname that is itself short lowercase hex ("abc") could appear in a
    // 64-hex digest by chance; every real hostname with a non-hex character
    // or eight-plus characters cannot, so the assertion is meaningful there.
    if hostname.is_empty() || (hostname.len() < 8 && is_lowercase_hex(&hostname)) {
        return;
    }
    assert!(!id.contains(&hostname), "the raw hostname leaked into {id}");
}

/// Audit F2 #38/#39 — `setup_app` cannot run under MockRuntime: it builds the
/// native menu, deletes the legacy `~/.vmark` directory and installs default
/// genies into the real app-data folder. What decides whether a restored
/// session can read a folder before its grant is in is ORDER — the main window
/// exists already but cannot load or invoke until setup returns — so the order
/// is pinned against the source, as `workflow/guards.test.rs` pins its gate.
/// What `restore_at_launch` itself does is tested in `workspace_grants`.
#[test]
fn setup_restores_workspace_grants_before_anything_else_starts() {
    let source = include_str!("app_setup.rs");
    let start = source
        .find("pub(crate) fn setup_app(")
        .expect("setup_app exists");
    let body = &source[start..];
    let body = &body[..body.find("\n}\n").expect("setup_app ends")];

    let restore = body
        .find("workspace_grants::restore_at_launch(")
        .expect("setup restores the recorded workspace grants");
    assert_eq!(
        body.matches("restore_at_launch(").count(),
        1,
        "exactly once"
    );
    for later in [
        "create_localized_menu(",
        "cleanup_legacy_home_dir(",
        "install_default_genies(",
        "FILE_OPEN_STATE",
        "log_runtime_state(",
        ".listen(",
    ] {
        let at = body
            .find(later)
            .unwrap_or_else(|| panic!("`{later}` left setup_app: re-derive this list"));
        assert!(
            restore < at,
            "`{later}` runs before the grants are restored"
        );
    }
}
