//! WI-LX2.3 — restore and a run exclude each other through the runner's one
//! concurrency flag.
//!
//! A restore writes the same files a `save-file` step writes, so the two must
//! never overlap: a restore is refused while a run holds the flag, a run is
//! refused while a restore holds it, and the flag is released however the
//! restore ends. Driven on the managed state directly — the command itself is
//! a thin shell that resolves the app-data directory.

use super::*;
use crate::command_error::ErrorCode;
use std::sync::atomic::Ordering;
use tempfile::tempdir;

#[tokio::test]
async fn restore_is_refused_while_a_run_holds_the_flag() {
    let state = WorkflowRunnerState::default();
    state.running.store(true, Ordering::SeqCst);
    let app_data = tempdir().unwrap();

    let err = restore_with_claim(&state, app_data.path(), "snap-x")
        .await
        .unwrap_err();
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(err.i18n_key(), Some("errors.workflow.restoreWhileRunning"));
    assert!(
        state.running.load(Ordering::SeqCst),
        "a refused restore must not release a live run's flag"
    );
}

#[test]
fn a_run_cannot_be_admitted_while_a_restore_holds_the_flag() {
    let state = WorkflowRunnerState::default();
    let claim = state.claim_for_restore().expect("idle: the restore claims");
    assert!(
        state.claim_and_publish("run-during-restore").is_none(),
        "a run must not start mid-restore"
    );
    drop(claim);
    assert!(!state.running.load(Ordering::SeqCst), "dropping releases");
    assert!(state.claim_and_publish("run-after-restore").is_some());
}

#[tokio::test]
async fn the_flag_is_released_when_the_restore_fails() {
    let state = WorkflowRunnerState::default();
    let app_data = tempdir().unwrap();
    let err = restore_with_claim(&state, app_data.path(), "snap-missing")
        .await
        .unwrap_err();
    assert_eq!(err.code(), ErrorCode::NotFound);
    assert!(!state.running.load(Ordering::SeqCst));
}

#[tokio::test]
async fn a_successful_restore_releases_the_flag_and_reports() {
    let state = WorkflowRunnerState::default();
    let app_data = tempdir().unwrap();
    let ws = tempdir().unwrap();
    let file = ws.path().join("a.md");
    std::fs::write(&file, "before").unwrap();
    super::super::snapshots::create_snapshot(
        app_data.path(),
        "ok-1",
        std::slice::from_ref(&file),
        ws.path(),
    )
    .await
    .unwrap();
    std::fs::write(&file, "after").unwrap();

    let report = restore_with_claim(&state, app_data.path(), "snap-ok-1")
        .await
        .unwrap();
    assert_eq!(report.restored, 1);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "before");
    assert!(!state.running.load(Ordering::SeqCst));
}

/// Restore is an UNDO, not a start: like `cancel_workflow`, it stays callable
/// with the engine switched off (rule 60 §12), so a user who turns the engine
/// off after a bad run can still put their files back.
#[tokio::test]
async fn restore_is_not_gated_on_the_engine_flag() {
    let state = WorkflowRunnerState::default();
    assert!(!state.engine_enabled(), "the state starts fail-closed");
    let app_data = tempdir().unwrap();
    let err = restore_with_claim(&state, app_data.path(), "snap-missing")
        .await
        .unwrap_err();
    assert_ne!(err.code(), ErrorCode::FeatureDisabled);
}

/// #72 — a restore holds `running` but is not a run. Switching the engine off
/// mid-restore used to read that flag as a live workflow: it armed
/// `cancel_requested` (which no restore observes, leaving it latched) and
/// logged a cancellation that never happened. The engine-off cancel now keys
/// on a PUBLISHED execution id, which only a run has.
#[test]
fn switching_the_engine_off_mid_restore_cancels_nothing() {
    let state = WorkflowRunnerState::default();
    state.set_engine_enabled(true);
    let claim = state.claim_for_restore().expect("idle: the restore claims");

    assert!(
        !state.apply_engine_policy(false),
        "no workflow is running, so none was asked to stop"
    );
    assert!(
        !state.cancel_requested.load(Ordering::SeqCst),
        "a restore leaves no latched cancel behind"
    );
    assert!(
        state.running.load(Ordering::SeqCst),
        "the restore still holds the flag"
    );
    drop(claim);
}

/// Spawn `id` the way `launch::spawn_run` does, then end it the way its
/// `RunningGuard` does.
fn spawn_and_finish(state: &WorkflowRunnerState, id: &str) {
    state
        .claim_and_publish(id)
        .expect("idle: the run claims")
        .expect("fresh id")
        .commit();
    state.clear_running();
}

/// Audit 20260928 #108 — a run SPAWNED after the snapshot's own may have
/// written files this snapshot predates; restoring it would undo that run's
/// work. The panel re-checks before it asks, but only the claim can make the
/// check and the restore one step, so the refusal lives here.
#[tokio::test]
async fn a_snapshot_superseded_by_a_later_spawned_run_is_refused() {
    let state = WorkflowRunnerState::default();
    let app_data = tempdir().unwrap();
    spawn_and_finish(&state, "run-a");
    spawn_and_finish(&state, "run-b");

    let err = restore_with_claim(&state, app_data.path(), "snap-run-a")
        .await
        .unwrap_err();
    assert_eq!(err.code(), ErrorCode::Conflict);
    assert_eq!(err.i18n_key(), Some("errors.workflow.restoreSuperseded"));
    assert!(
        !state.running.load(Ordering::SeqCst),
        "the refusal releases the claim"
    );
}

/// The newest spawned run's snapshot, and a snapshot from before this process
/// ran anything, are both restorable: nothing since could have written over
/// them. (No record on disk here, so "not superseded" surfaces as not-found.)
#[tokio::test]
async fn the_latest_runs_snapshot_and_an_earlier_sessions_are_not_superseded() {
    let app_data = tempdir().unwrap();
    let fresh = WorkflowRunnerState::default();
    let err = restore_with_claim(&fresh, app_data.path(), "snap-last-session")
        .await
        .unwrap_err();
    assert_eq!(err.code(), ErrorCode::NotFound);

    let state = WorkflowRunnerState::default();
    spawn_and_finish(&state, "run-a");
    let err = restore_with_claim(&state, app_data.path(), "snap-run-a")
        .await
        .unwrap_err();
    assert_eq!(err.code(), ErrorCode::NotFound);
}

/// A start refused BEFORE it spawned — invalid YAML, a failed snapshot — wrote
/// nothing, and the panel re-offers the previous run's restore after it. The
/// backend must agree, or the offer it shows would always be refused.
#[tokio::test]
async fn a_start_refused_before_spawning_does_not_supersede() {
    let state = WorkflowRunnerState::default();
    let app_data = tempdir().unwrap();
    spawn_and_finish(&state, "run-a");
    drop(state.claim_and_publish("run-refused").unwrap().unwrap()); // never committed

    let err = restore_with_claim(&state, app_data.path(), "snap-run-a")
        .await
        .unwrap_err();
    assert_eq!(err.code(), ErrorCode::NotFound, "not refused as superseded");
}
