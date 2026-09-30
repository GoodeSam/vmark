//! WI-TP1.1: preserve existing hooks; refuse arbitrary file reads.
use super::*;
#[test]
fn merges_hooks_without_destroying_settings() {
    let mut config = serde_json::json!({"theme":"dark", "hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"existing"}]}]}});
    assert!(add_hook(&mut config, "node '/preview.cjs'").unwrap());
    assert!(
        !add_hook(&mut config, "node '/preview.cjs'").unwrap(),
        "second add is a no-op"
    );
    assert_eq!(config["theme"], "dark");
    assert_eq!(config["hooks"]["SessionStart"].as_array().unwrap().len(), 2);
    assert_eq!(
        config["hooks"]["SessionStart"][0]["hooks"][0]["command"],
        "existing"
    );
}
#[test]
fn invalid_hook_config_is_not_overwritten() {
    assert!(add_hook(&mut serde_json::json!({"hooks":false}), "test").is_err());
}
#[test]
fn tokens_are_opaque_uuids() {
    assert!(valid_token("cb28fc00-2c1b-4eaf-9d09-71d9d5392926"));
    assert!(!valid_token("../secret"));
    assert!(!valid_token(""));
}
#[test]
fn canonical_paths_are_confined_to_session_roots() {
    let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&root).unwrap();
    let transcript = root.join("test.jsonl");
    std::fs::write(&transcript, b"{}\n").unwrap();
    assert!(allowed_path(
        &transcript.canonicalize().unwrap(),
        std::slice::from_ref(&root)
    ));
    assert!(!allowed_path(
        Path::new("/etc/passwd"),
        std::slice::from_ref(&root)
    ));
    assert!(!allowed_path(
        &root.join("test.json"),
        std::slice::from_ref(&root)
    ));
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn tail_reader_bounds_bytes_and_drops_split_records() {
    let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("tail.jsonl");
    std::fs::write(&path, b"first\nsecond\npartial").unwrap();
    assert_eq!(read_tail(&path, 12).unwrap(), "partial");
    assert_eq!(read_tail(&path, 14).unwrap(), "second\npartial");
    assert_eq!(read_tail(&path, 100).unwrap(), "first\nsecond\npartial");
    std::fs::write(&path, b"truncated\n").unwrap();
    assert_eq!(read_tail(&path, 100).unwrap(), "truncated\n");
    std::fs::remove_dir_all(root).unwrap();
}
fn snapshot_fixture() -> (PathBuf, PathBuf, String) {
    let base = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&base).unwrap();
    // Canonical, so the macOS /var -> /private/var link does not defeat confinement.
    let base = base.canonicalize().unwrap();
    let root = base.join("bindings");
    let sessions = base.join("sessions");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&sessions).unwrap();
    std::fs::write(root.join("enabled"), b"enabled").unwrap();
    (root, sessions, uuid::Uuid::new_v4().to_string())
}
fn bind(root: &Path, token: &str, transcript: &Path) {
    let binding = serde_json::json!({"path": transcript, "sessionId": "s"});
    std::fs::write(root.join(format!("{token}.json")), binding.to_string()).unwrap();
}
#[test]
fn snapshot_waits_until_enabled_bound_and_written() {
    let (root, sessions, token) = snapshot_fixture();
    let roots = [sessions.clone()];
    assert!(read_snapshot(&root, &roots, &token, None)
        .unwrap()
        .is_none());
    // The CLI announces its transcript before creating it.
    let transcript = sessions.join("t.jsonl");
    bind(&root, &token, &transcript);
    assert!(read_snapshot(&root, &roots, &token, None)
        .unwrap()
        .is_none());
    std::fs::write(&transcript, b"{\"a\":1}\n").unwrap();
    let first = read_snapshot(&root, &roots, &token, None).unwrap().unwrap();
    assert_eq!(first.data.as_deref(), Some("{\"a\":1}\n"));
    let same = read_snapshot(&root, &roots, &token, Some(&first.revision))
        .unwrap()
        .unwrap();
    assert!(same.data.is_none(), "unchanged revision skips the read");
    std::fs::remove_file(root.join("enabled")).unwrap();
    assert!(read_snapshot(&root, &roots, &token, None)
        .unwrap()
        .is_none());
    std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
}
#[test]
fn snapshot_refuses_transcripts_outside_session_roots() {
    let (root, sessions, token) = snapshot_fixture();
    let outside = root.parent().unwrap().join("secret.jsonl");
    std::fs::write(&outside, b"{}\n").unwrap();
    bind(&root, &token, &outside);
    let err = read_snapshot(&root, &[sessions], &token, None)
        .err()
        .unwrap();
    assert!(format!("{err:?}").contains("outside"));
    std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
}
#[test]
fn forgetting_and_disabling_remove_bindings_only() {
    let (root, sessions, token) = snapshot_fixture();
    bind(&root, &token, &sessions.join("t.jsonl"));
    remove_binding(&root, &token).unwrap();
    remove_binding(&root, &token).unwrap(); // idempotent
    assert!(!root.join(format!("{token}.json")).exists());
    bind(&root, &token, &sessions.join("t.jsonl"));
    std::fs::write(root.join("unrelated.json"), b"{}").unwrap();
    configure(&root, false, &root.join("claude"), &root.join("codex")).unwrap();
    assert!(!root.join(format!("{token}.json")).exists());
    assert!(!root.join("enabled").exists());
    assert!(root.join("unrelated.json").exists());
    std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
}
#[test]
fn enabling_leaves_already_configured_cli_files_untouched() {
    let (root, _sessions, _token) = snapshot_fixture();
    let base = root.parent().unwrap().to_path_buf();
    let (claude, codex) = (base.join("claude"), base.join("codex"));
    configure(&root, true, &claude, &codex).unwrap();
    let settings = claude.join("settings.json");
    let hooks = codex.join("hooks.json");
    assert!(std::fs::read_to_string(&settings)
        .unwrap()
        .contains("terminal-transcript-hook.cjs"));
    // Rewrite both compactly: a second enable must not reformat (i.e. rewrite) them.
    for path in [&settings, &hooks] {
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        std::fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    }
    let before = (
        std::fs::read(&settings).unwrap(),
        std::fs::read(&hooks).unwrap(),
    );
    configure(&root, true, &claude, &codex).unwrap();
    assert_eq!(
        before,
        (
            std::fs::read(&settings).unwrap(),
            std::fs::read(&hooks).unwrap()
        )
    );
    std::fs::remove_dir_all(base).unwrap();
}
