// WI-RA5.2 — a step's `if:` decides whether it runs: `failure()` and `always()`
// are reachable, `success()` is implied when no status function is named, and
// a cancel still stops every step.
//
//! The runner, run. Whole workflows go through `run_workflow_sequential` on a
//! mock Tauri runtime, and the assertions are on what the frontend is told:
//! each step's `workflow:step-update` events, in order, and the
//! `workflow:complete` that ends the run.
//!
//! A step fails here the way one fails for a user: `action/read-file` on a
//! path that does not exist.

// `tauri::test::MockRuntime` does not exist on Windows (Cargo.toml scopes the
// `test` feature off it); gated like every mock-runtime suite in this crate.
#![cfg(not(target_os = "windows"))]

use super::run_workflow_sequential;
use crate::coherence::capture_policy::CapturePolicy;
use crate::workflow::approval::ApprovalRegistry;
use crate::workflow::genie_step::ProviderConfig;
use crate::workflow::types::RawWorkflow;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Listener;

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

/// One `workflow:step-update`, as the frontend receives it.
#[derive(Debug, Clone, PartialEq)]
struct StepEvent {
    id: String,
    status: String,
    error: Option<String>,
}

/// A finished run, as the frontend saw it.
struct Finished {
    result: Result<String, String>,
    events: Vec<StepEvent>,
    /// The status of every `workflow:complete` — there must be exactly one.
    completions: Vec<String>,
    /// The step ids an approval was asked for, in order.
    approvals_asked: Vec<String>,
    workspace: tempfile::TempDir,
}

impl Finished {
    /// Every status `id` reported, in order (`running` first when it ran).
    fn statuses(&self, id: &str) -> Vec<&str> {
        self.events
            .iter()
            .filter(|e| e.id == id)
            .map(|e| e.status.as_str())
            .collect()
    }

    /// The error text on the last event `id` reported.
    fn error(&self, id: &str) -> Option<&str> {
        self.events
            .iter()
            .rev()
            .find(|e| e.id == id)
            .and_then(|e| e.error.as_deref())
    }

    fn saved(&self, name: &str) -> Option<String> {
        std::fs::read_to_string(self.workspace.path().join(name)).ok()
    }
}

/// When the user's cancel arrives.
#[derive(Clone, Copy, Default)]
enum Cancel {
    #[default]
    Never,
    BeforeTheFirstStep,
    /// The moment this step reports success — the events are delivered
    /// synchronously, so the very next step is the first to see the flag.
    WhenStepSucceeds(&'static str),
}

/// Everything around a run except its YAML.
#[derive(Default)]
struct Setup {
    cancel: Cancel,
    /// How the approval dialog answers, the moment it is asked. `None` leaves
    /// a request unanswered.
    approve: Option<bool>,
    /// The provider and genies directory `genie/*` steps need.
    provider: Option<ProviderConfig>,
    genies: Option<std::path::PathBuf>,
}

async fn run(yaml: &str) -> Finished {
    run_with(yaml, Setup::default()).await
}

fn json(payload: &str) -> serde_json::Value {
    serde_json::from_str(payload).expect("a JSON event payload")
}

fn text(value: &serde_json::Value) -> String {
    value.as_str().unwrap_or_default().to_string()
}

async fn run_with(yaml: &str, setup: Setup) -> Finished {
    let app = mock_app();
    let workspace = tempfile::tempdir().expect("workspace");
    let flag = Arc::new(AtomicBool::new(matches!(
        setup.cancel,
        Cancel::BeforeTheFirstStep
    )));
    let events = Arc::new(Mutex::new(Vec::new()));
    let completions = Arc::new(Mutex::new(Vec::new()));
    let asked = Arc::new(Mutex::new(Vec::new()));
    let registry = Arc::new(ApprovalRegistry::new());

    let (sink, trip, cancel) = (Arc::clone(&events), Arc::clone(&flag), setup.cancel);
    app.listen_any("workflow:step-update", move |event| {
        let payload = json(event.payload());
        let step = StepEvent {
            id: text(&payload["stepId"]),
            status: text(&payload["status"]),
            error: payload["error"].as_str().map(str::to_string),
        };
        if let Cancel::WhenStepSucceeds(id) = cancel {
            if step.id == id && step.status == "success" {
                trip.store(true, Ordering::SeqCst);
            }
        }
        sink.lock().expect("events lock").push(step);
    });
    let sink = Arc::clone(&completions);
    app.listen_any("workflow:complete", move |event| {
        let payload = json(event.payload());
        assert_eq!(payload["executionId"], "exec-flow");
        sink.lock()
            .expect("completions lock")
            .push(text(&payload["status"]));
    });
    let (sink, dialog, answer) = (Arc::clone(&asked), Arc::clone(&registry), setup.approve);
    app.listen_any("workflow:approval-request", move |event| {
        let payload = json(event.payload());
        let step_id = text(&payload["stepId"]);
        sink.lock().expect("asked lock").push(step_id.clone());
        if let Some(approved) = answer {
            let key = (text(&payload["executionId"]), step_id);
            assert!(
                dialog.respond(&key, approved),
                "the request is registered before it is announced"
            );
        }
    });

    let workflow: RawWorkflow = serde_yaml_ng::from_str(yaml).expect("the fixture parses");
    let result = run_workflow_sequential(
        app.handle(),
        workflow,
        HashMap::new(),
        workspace.path(),
        "exec-flow",
        &flag,
        setup.provider,
        setup.genies,
        registry,
        CapturePolicy::TrackedOnly,
    )
    .await;

    let events = events.lock().expect("events lock").clone();
    let completions = completions.lock().expect("completions lock").clone();
    let approvals_asked = asked.lock().expect("asked lock").clone();
    Finished {
        result,
        events,
        completions,
        approvals_asked,
        workspace,
    }
}

/// `boom` fails; what follows it is the subject of each test.
const BOOM: &str = "name: flow\nsteps:\n  - id: boom\n    uses: action/read-file\n    with:\n      path: missing.md\n";

fn after_boom(rest: &str) -> String {
    format!("{BOOM}{rest}")
}

// === failure() and always() are reachable ===

#[tokio::test]
async fn an_always_step_runs_after_a_failure() {
    let run = run(&after_boom(
        "  - id: cleanup\n    uses: action/save-file\n    if: always()\n    with:\n      path: cleanup.md\n      input: cleaned up\n",
    ))
    .await;

    assert_eq!(run.statuses("boom"), ["running", "error"]);
    assert_eq!(run.statuses("cleanup"), ["running", "success"]);
    assert_eq!(run.saved("cleanup.md").as_deref(), Some("cleaned up"));
    // The run still failed, and still says where.
    let err = run.result.expect_err("a failed step fails the run");
    assert!(err.contains("'boom'"), "names the failed step: {err}");
    assert_eq!(run.completions, ["failed"]);
}

#[tokio::test]
async fn a_failure_step_runs_after_a_failure() {
    let run = run(&after_boom(
        "  - id: report\n    uses: action/copy\n    if: ${{ failure() }}\n    with:\n      input: it broke\n",
    ))
    .await;
    assert_eq!(run.statuses("report"), ["running", "success"]);
    assert_eq!(run.completions, ["failed"]);
}

#[tokio::test]
async fn a_failure_step_does_not_run_when_nothing_failed() {
    let run = run(
        "name: flow\nsteps:\n  - id: fine\n    uses: action/copy\n    with:\n      input: ok\n  \
         - id: report\n    uses: action/copy\n    if: failure()\n    with:\n      input: it broke\n",
    )
    .await;
    assert_eq!(run.statuses("fine"), ["running", "success"]);
    assert_eq!(run.statuses("report"), ["skipped"]);
    assert_eq!(run.error("report"), Some("Condition not met: failure()"));
    assert_eq!(run.result, Ok("exec-flow".to_string()));
    assert_eq!(run.completions, ["completed"]);
}

// === the default is success() ===

#[tokio::test]
async fn a_step_with_no_condition_is_skipped_after_a_failure() {
    let run = run(&after_boom(
        "  - id: next\n    uses: action/save-file\n    with:\n      path: next.md\n      input: must not be written\n",
    ))
    .await;
    assert_eq!(run.statuses("next"), ["skipped"]);
    assert_eq!(run.error("next"), None);
    assert_eq!(run.saved("next.md"), None);
    assert_eq!(run.completions, ["failed"]);
}

#[tokio::test]
async fn a_condition_naming_no_status_function_implies_success() {
    // `if: X` means `success() && (X)`: true on the happy path…
    let happy = run(
        "name: flow\nsteps:\n  - id: next\n    uses: action/copy\n    if: 1 == 1\n    with:\n      input: ok\n",
    )
    .await;
    assert_eq!(happy.statuses("next"), ["running", "success"]);

    // …and skipped after a failure, however true X is on its own. The dead
    // branch is never evaluated, so a reference to the step that failed (which
    // has no output) cannot turn the skip into a second error.
    let failed = run(&after_boom(
        "  - id: plain\n    uses: action/copy\n    if: 1 == 1\n    with:\n      input: unused\n  \
         - id: reads\n    uses: action/copy\n    if: steps.boom.outputs.text != 'x'\n    with:\n      input: unused\n  \
         - id: explicit\n    uses: action/copy\n    if: success()\n    with:\n      input: unused\n",
    ))
    .await;
    for id in ["plain", "reads", "explicit"] {
        assert_eq!(failed.statuses(id), ["skipped"], "step {id}");
    }
}

#[tokio::test]
async fn a_malformed_condition_fails_loudly_even_after_a_failure() {
    let run = run(&after_boom(
        "  - id: typo\n    uses: action/copy\n    if: \"1 ==\"\n    with:\n      input: unused\n",
    ))
    .await;
    assert_eq!(run.statuses("typo"), ["error"]);
    let error = run.error("typo").unwrap_or_default();
    assert!(
        error.starts_with("Condition evaluation failed:"),
        "the step says why: {error}"
    );
}

// === needs: orders steps; the condition still decides ===

#[tokio::test]
async fn an_always_step_runs_after_the_step_it_needs_failed() {
    let run = run(&after_boom(
        "  - id: cleanup\n    uses: action/copy\n    needs: boom\n    if: always()\n    with:\n      input: cleaned\n  \
         - id: report\n    uses: action/copy\n    needs: [boom]\n    if: failure()\n    with:\n      input: it broke\n  \
         - id: next\n    uses: action/copy\n    needs: boom\n    with:\n      input: unused\n",
    ))
    .await;
    assert_eq!(run.statuses("cleanup"), ["running", "success"]);
    assert_eq!(run.statuses("report"), ["running", "success"]);
    assert_eq!(run.statuses("next"), ["skipped"]);
}

#[tokio::test]
async fn a_dependency_skipped_by_its_own_condition_is_not_a_failure() {
    let run = run(
        "name: flow\nsteps:\n  - id: gate\n    uses: action/copy\n    if: 'false'\n    with:\n      input: never\n  \
         - id: plain\n    uses: action/copy\n    needs: gate\n    with:\n      input: unused\n  \
         - id: explicit\n    uses: action/copy\n    needs: gate\n    if: success()\n    with:\n      input: unused\n  \
         - id: report\n    uses: action/copy\n    needs: gate\n    if: failure()\n    with:\n      input: unused\n  \
         - id: cleanup\n    uses: action/copy\n    needs: gate\n    if: always()\n    with:\n      input: cleaned\n",
    )
    .await;
    assert_eq!(run.statuses("gate"), ["skipped"]);
    // Nothing the skipped step feeds runs by default…
    assert_eq!(run.statuses("plain"), ["skipped"]);
    assert_eq!(run.statuses("explicit"), ["skipped"]);
    // …nothing failed, so `failure()` is false…
    assert_eq!(run.statuses("report"), ["skipped"]);
    // …and `always()` means always.
    assert_eq!(run.statuses("cleanup"), ["running", "success"]);
    assert_eq!(run.result, Ok("exec-flow".to_string()));
    assert_eq!(run.completions, ["completed"]);
}

// === after the first failure ===

#[tokio::test]
async fn the_run_names_the_first_step_that_failed() {
    let run = run(&after_boom(
        "  - id: cleanup\n    uses: action/read-file\n    if: always()\n    with:\n      path: also-missing.md\n",
    ))
    .await;
    assert_eq!(run.statuses("cleanup"), ["running", "error"]);
    let err = run.result.expect_err("the run failed");
    assert!(
        err.contains("'boom'") && !err.contains("cleanup"),
        "the first failure is the one named: {err}"
    );
    assert_eq!(run.completions, ["failed"]);
}

#[tokio::test]
async fn an_always_step_reading_a_failed_steps_output_fails_loudly() {
    let run = run(&after_boom(
        "  - id: cleanup\n    uses: action/copy\n    if: always()\n    with:\n      input: ${{ steps.boom.output }}\n",
    ))
    .await;
    assert_eq!(run.statuses("cleanup"), ["running", "error"]);
    let error = run.error("cleanup").unwrap_or_default();
    assert!(
        error.starts_with("Parameter resolution failed:"),
        "the step says why: {error}"
    );
}

/// A step that times out is a failed step, not a cancelled run: what it
/// cancels is its own in-flight work. An `always()` step after it still
/// reaches its approval dialog and runs.
#[tokio::test]
async fn an_always_step_runs_after_a_step_timed_out() {
    // A provider that accepts the connection and never answers, and a zero
    // timeout: the genie step is pending on its first poll, so it times out
    // at once — no clock is waited on.
    let silent = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let endpoint = format!("http://{}", silent.local_addr().expect("addr"));
    let genies = tempfile::tempdir().expect("genies dir");
    std::fs::write(
        genies.path().join("echo.md"),
        "---\ndescription: Echo\n---\n\n{{input}}\n",
    )
    .expect("write genie");

    let run = run_with(
        "name: flow\ndefaults:\n  model: fake-model\nsteps:\n  - id: slow\n    uses: genie/echo\n    limits:\n      timeout: \"0\"\n    with:\n      input: hello\n  \
         - id: cleanup\n    uses: action/copy\n    if: always()\n    approval: ask\n    with:\n      input: cleaned\n",
        Setup {
            approve: Some(true),
            provider: Some(ProviderConfig {
                provider: "openai-compatible".to_string(),
                api_key: Some("test-key".to_string()),
                endpoint: Some(endpoint),
                cli_path: None,
            }),
            genies: Some(genies.path().to_path_buf()),
            ..Setup::default()
        },
    )
    .await;
    drop(silent);

    assert_eq!(run.statuses("slow"), ["running", "error"]);
    assert_eq!(run.error("slow"), Some("Timed out after 0s"));
    assert_eq!(run.approvals_asked, ["cleanup"]);
    assert_eq!(run.statuses("cleanup"), ["running", "success"]);
    assert_eq!(run.completions, ["failed"]);
}

// === a cancel is stronger than always() ===

#[tokio::test]
async fn a_cancel_stops_an_always_step() {
    let run = run_with(
        "name: flow\nsteps:\n  - id: first\n    uses: action/copy\n    with:\n      input: ok\n  \
         - id: cleanup\n    uses: action/save-file\n    if: always()\n    with:\n      path: cleanup.md\n      input: must not be written\n  \
         - id: report\n    uses: action/copy\n    if: failure()\n    with:\n      input: unused\n",
        Setup {
            cancel: Cancel::WhenStepSucceeds("first"),
            ..Setup::default()
        },
    )
    .await;
    assert_eq!(run.statuses("first"), ["running", "success"]);
    for id in ["cleanup", "report"] {
        assert_eq!(run.statuses(id), ["skipped"], "step {id}");
        assert_eq!(run.error(id), Some("Workflow cancelled"), "step {id}");
    }
    assert_eq!(run.saved("cleanup.md"), None);
    let err = run.result.expect_err("a cancelled run is not a success");
    assert!(err.contains("cleanup (cancelled)"), "{err}");
    assert_eq!(run.completions, ["cancelled"]);
}

#[tokio::test]
async fn a_cancel_before_the_first_step_runs_nothing() {
    let run = run_with(
        "name: flow\nsteps:\n  - id: first\n    uses: action/copy\n    if: always()\n    with:\n      input: unused\n  \
         - id: second\n    uses: action/copy\n    with:\n      input: unused\n",
        Setup {
            cancel: Cancel::BeforeTheFirstStep,
            ..Setup::default()
        },
    )
    .await;
    assert_eq!(run.statuses("first"), ["skipped"]);
    assert_eq!(run.statuses("second"), ["skipped"]);
    assert_eq!(run.completions, ["cancelled"]);
}
