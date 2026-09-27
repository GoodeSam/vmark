// WI-LX1.4 — `general.coherenceCaptureOnSave` honoured on every write path.
//
// The setting reaches the kernel as a `CapturePolicy` on each request. Under
// `TrackedOnly` (setting OFF) no write path may create `.vmark/` or stamp a
// `vmark:` identity block into any file — the output OR an adopted input — and
// an existing ledger keeps following only the documents it already tracks.
// `Adopt` (setting ON) is the pre-existing behaviour, pinned so it cannot drift.

use super::*;
use crate::coherence::capture::{capture, CaptureInputSpec, CaptureRequest};
use crate::coherence::edge_kind::OriginEdgeKind;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{
    Agent, AgentType, Confidence, InputRole, Intent, Transformation, WriterId,
};
use std::path::Path;

fn workspace() -> (tempfile::TempDir, WorkspaceKernel) {
    let dir = tempfile::tempdir().unwrap();
    let kernel = WorkspaceKernel::open(dir.path(), WriterId(uuid::Uuid::from_u128(7))).unwrap();
    (dir, kernel)
}

fn write_file(root: &Path, rel: &str, content: &str) {
    let abs = root.join(rel);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    std::fs::write(abs, content).unwrap();
}

fn read_file(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap()
}

fn request(path: &str, content: &str, rewrite_identity: bool) -> CaptureRequest {
    CaptureRequest {
        path: path.into(),
        content: content.into(),
        inputs: vec![],
        agent: Agent {
            kind: AgentType::Human,
            id: None,
        },
        intent: Intent {
            kind: "editor-save".into(),
            summary: "manual save".into(),
            prompt_hash: None,
        },
        confidence: Confidence::Exact,
        rewrite_identity,
        idem: None,
    }
}

fn input(path: &str) -> CaptureInputSpec {
    CaptureInputSpec {
        path: Some(path.into()),
        object_id: None,
        revision: None,
        role: InputRole::Direct,
        kind: OriginEdgeKind::Dependency,
    }
}

/// Make `.vmark/` exist by an explicit opt-in capture of an unrelated file.
fn with_existing_ledger(dir: &Path, kernel: &mut WorkspaceKernel) {
    write_file(dir, "seed.md", "seed\n");
    capture(kernel, request("seed.md", "seed\n", true)).unwrap();
    assert!(kernel.is_initialized());
}

fn transformation_of(kernel: &WorkspaceKernel, entry: uuid::Uuid) -> Transformation {
    let read = kernel.ledger().read_all().unwrap();
    let env = read.entries.iter().find(|e| e.id == entry).unwrap();
    serde_json::from_value(env.body.clone()).unwrap()
}

// ── Fresh workspace: nothing is created, nothing is stamped ─────────────

#[test]
fn tracked_only_disk_write_in_a_fresh_workspace_creates_nothing() {
    // Human save, MCP document.write / workspace.save and history restore all
    // arrive as a disk write (rewrite_identity = true).
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "scene.md", "# Scene\n");
    let out = capture_with_policy(
        &mut kernel,
        request("scene.md", "# Scene\n", true),
        CapturePolicy::TrackedOnly,
    )
    .unwrap();
    assert!(out.is_none(), "no ledger and no opt-in: not captured");
    assert!(
        !dir.path().join(".vmark").exists(),
        ".vmark/ must not be created"
    );
    assert_eq!(
        read_file(dir.path(), "scene.md"),
        "# Scene\n",
        "file not stamped"
    );
}

#[test]
fn tracked_only_live_buffer_capture_in_a_fresh_workspace_creates_nothing() {
    // Genie apply and accepted AI suggestions capture the buffer
    // (rewrite_identity = false).
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "scene.md", "before\n");
    let out = capture_with_policy(
        &mut kernel,
        request("scene.md", "after (buffer)\n", false),
        CapturePolicy::TrackedOnly,
    )
    .unwrap();
    assert!(out.is_none());
    assert!(!dir.path().join(".vmark").exists());
}

#[test]
fn tracked_only_explorer_new_file_in_a_fresh_workspace_creates_nothing() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "new.md", "");
    let out = capture_with_policy(
        &mut kernel,
        request("new.md", "", false),
        CapturePolicy::TrackedOnly,
    )
    .unwrap();
    assert!(out.is_none());
    assert!(!dir.path().join(".vmark").exists());
}

#[test]
fn tracked_only_write_with_inputs_in_a_fresh_workspace_stamps_no_input() {
    // An MCP write carries the session's read set; adopting an input used to
    // rewrite THAT file too.
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "notes.md", "notes\n");
    write_file(dir.path(), "ch1.md", "chapter\n");
    let mut req = request("ch1.md", "chapter\n", true);
    req.inputs = vec![input("notes.md")];
    let out = capture_with_policy(&mut kernel, req, CapturePolicy::TrackedOnly).unwrap();
    assert!(out.is_none());
    assert!(!dir.path().join(".vmark").exists());
    assert_eq!(read_file(dir.path(), "notes.md"), "notes\n");
    assert_eq!(read_file(dir.path(), "ch1.md"), "chapter\n");
}

#[test]
fn tracked_only_ignores_identity_bearing_content_in_a_fresh_workspace() {
    // Content that already carries `vmark:` (copied from elsewhere) is still
    // not a reason to create `.vmark/` without the opt-in.
    let (dir, mut kernel) = workspace();
    let text = "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7\n---\nbody\n";
    write_file(dir.path(), "copied.md", text);
    let out = capture_with_policy(
        &mut kernel,
        request("copied.md", text, true),
        CapturePolicy::TrackedOnly,
    )
    .unwrap();
    assert!(out.is_none());
    assert!(!dir.path().join(".vmark").exists());
}

// ── Existing ledger: follow what is tracked, adopt nothing new ──────────

#[test]
fn tracked_only_follows_a_tracked_document_without_stamping_it() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "scene.md", "v1\n");
    let r1 = capture(&mut kernel, request("scene.md", "v1\n", true)).unwrap();
    // The editor buffer never carries the identity block in-session.
    write_file(dir.path(), "scene.md", "v2\n");
    let r2 = capture_with_policy(
        &mut kernel,
        request("scene.md", "v2\n", true),
        CapturePolicy::TrackedOnly,
    )
    .unwrap()
    .expect("a tracked document is still captured");
    assert_eq!(r2.object, r1.object, "same object, no fresh identity");
    assert!(r2.content_with_identity.is_none(), "no rewrite reported");
    assert_eq!(
        read_file(dir.path(), "scene.md"),
        "v2\n",
        "disk left as written"
    );
    assert_eq!(kernel.index().heads(&r1.object).unwrap(), vec![r2.revision]);
}

#[test]
fn tracked_only_skips_an_untracked_document_in_an_existing_ledger() {
    let (dir, mut kernel) = workspace();
    with_existing_ledger(dir.path(), &mut kernel);
    write_file(dir.path(), "fresh.md", "fresh\n");
    let out = capture_with_policy(
        &mut kernel,
        request("fresh.md", "fresh\n", true),
        CapturePolicy::TrackedOnly,
    )
    .unwrap();
    assert!(out.is_none(), "an untracked document is not adopted");
    assert_eq!(read_file(dir.path(), "fresh.md"), "fresh\n");
    let registry = kernel.index().registry_state().unwrap();
    assert!(!registry.object_at.contains_key("fresh.md"));
}

#[test]
fn tracked_only_records_a_document_that_already_carries_identity() {
    let (dir, mut kernel) = workspace();
    with_existing_ledger(dir.path(), &mut kernel);
    let text = "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7\n---\nbody\n";
    write_file(dir.path(), "copied.md", text);
    let r = capture_with_policy(
        &mut kernel,
        request("copied.md", text, true),
        CapturePolicy::TrackedOnly,
    )
    .unwrap()
    .expect("identity already present: nothing to stamp, so it is tracked");
    assert_eq!(
        r.object.0.to_string(),
        "018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7"
    );
    assert!(r.content_with_identity.is_none());
    assert_eq!(read_file(dir.path(), "copied.md"), text);
}

#[test]
fn tracked_only_drops_an_unidentified_input_and_downgrades_confidence() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "ch1.md", "v1\n");
    capture(&mut kernel, request("ch1.md", "v1\n", true)).unwrap();
    write_file(dir.path(), "notes.md", "notes\n");
    write_file(dir.path(), "ch1.md", "v2\n");
    let mut req = request("ch1.md", "v2\n", true);
    req.inputs = vec![input("notes.md")];
    let r = capture_with_policy(&mut kernel, req, CapturePolicy::TrackedOnly)
        .unwrap()
        .expect("the tracked output is still captured");
    assert_eq!(
        read_file(dir.path(), "notes.md"),
        "notes\n",
        "input never stamped"
    );
    let t = transformation_of(&kernel, r.entry_id.unwrap());
    assert!(t.inputs.is_empty(), "the untracked input is not invented");
    assert_eq!(
        t.confidence,
        Confidence::Inferred,
        "an input set known to be incomplete is not exact"
    );
}

#[test]
fn tracked_only_keeps_a_tracked_input_and_exact_confidence() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "notes.md", "notes\n");
    let notes = capture(&mut kernel, request("notes.md", "notes\n", true)).unwrap();
    write_file(dir.path(), "ch1.md", "v1\n");
    capture(&mut kernel, request("ch1.md", "v1\n", true)).unwrap();
    let mut req = request("ch1.md", "v2\n", true);
    req.inputs = vec![input("notes.md")];
    write_file(dir.path(), "ch1.md", "v2\n");
    let r = capture_with_policy(&mut kernel, req, CapturePolicy::TrackedOnly)
        .unwrap()
        .unwrap();
    let t = transformation_of(&kernel, r.entry_id.unwrap());
    assert_eq!(t.inputs.len(), 1);
    assert_eq!(t.inputs[0].object, notes.object);
    assert_eq!(t.confidence, Confidence::Exact);
}

#[test]
fn tracked_only_adopts_an_identified_input_without_rewriting_it() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "ch1.md", "v1\n");
    capture(&mut kernel, request("ch1.md", "v1\n", true)).unwrap();
    let notes = "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c8\n---\nnotes\n";
    write_file(dir.path(), "notes.md", notes);
    write_file(dir.path(), "ch1.md", "v2\n");
    let mut req = request("ch1.md", "v2\n", true);
    req.inputs = vec![input("notes.md")];
    let r = capture_with_policy(&mut kernel, req, CapturePolicy::TrackedOnly)
        .unwrap()
        .unwrap();
    assert_eq!(read_file(dir.path(), "notes.md"), notes);
    let t = transformation_of(&kernel, r.entry_id.unwrap());
    assert_eq!(t.inputs.len(), 1);
    assert_eq!(t.confidence, Confidence::Exact);
}

// ── Adopt (setting ON) is unchanged ─────────────────────────────────────

#[test]
fn adopt_creates_the_ledger_and_stamps_as_before() {
    let (dir, mut kernel) = workspace();
    write_file(dir.path(), "notes.md", "notes\n");
    write_file(dir.path(), "scene.md", "# Scene\n");
    let mut req = request("scene.md", "# Scene\n", true);
    req.inputs = vec![input("notes.md")];
    let r = capture_with_policy(&mut kernel, req, CapturePolicy::Adopt)
        .unwrap()
        .expect("opt-in capture");
    assert!(dir.path().join(".vmark/ledger").is_dir());
    assert!(read_file(dir.path(), "scene.md").contains("vmark:"));
    assert!(
        read_file(dir.path(), "notes.md").contains("vmark:"),
        "input adopted"
    );
    assert!(r.content_with_identity.is_some());
}

#[test]
fn policy_wire_names_are_stable() {
    // The webview sends these strings; renaming either silently breaks the IPC.
    let adopt: CapturePolicy = serde_json::from_str("\"adopt\"").unwrap();
    let tracked: CapturePolicy = serde_json::from_str("\"tracked-only\"").unwrap();
    assert_eq!(adopt, CapturePolicy::Adopt);
    assert_eq!(tracked, CapturePolicy::TrackedOnly);
    assert!(serde_json::from_str::<CapturePolicy>("\"on\"").is_err());
}

// ── Scan-on-change: a write-triggered pass creates nothing either ───────

#[test]
fn tracked_only_scan_in_a_fresh_workspace_creates_nothing() {
    let (dir, mut kernel) = workspace();
    let text = "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c9\n---\nbody\n";
    write_file(dir.path(), "copied.md", text);
    let report = scan_on_change(&mut kernel, CapturePolicy::TrackedOnly).unwrap();
    assert_eq!(report.adopted, 0);
    assert!(!report.complete, "nothing was reconciled");
    assert!(!dir.path().join(".vmark").exists());
}

#[test]
fn adopt_scan_in_a_fresh_workspace_still_adopts_identified_files() {
    let (dir, mut kernel) = workspace();
    let text = "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21ca\n---\nbody\n";
    write_file(dir.path(), "copied.md", text);
    let report = scan_on_change(&mut kernel, CapturePolicy::Adopt).unwrap();
    assert_eq!(report.adopted, 1);
    assert!(dir.path().join(".vmark").is_dir());
}

#[test]
fn tracked_only_scan_runs_normally_once_a_ledger_exists() {
    let (dir, mut kernel) = workspace();
    with_existing_ledger(dir.path(), &mut kernel);
    let text = "---\nvmark:\n  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21cb\n---\nbody\n";
    write_file(dir.path(), "copied.md", text);
    let report = scan_on_change(&mut kernel, CapturePolicy::TrackedOnly).unwrap();
    assert_eq!(
        report.adopted, 1,
        "identity already on disk: adopting stamps nothing"
    );
    assert_eq!(read_file(dir.path(), "copied.md"), text);
}
