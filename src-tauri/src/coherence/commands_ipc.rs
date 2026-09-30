//! The `#[tauri::command]` wrappers for the core coherence surface.
//!
//! Split out of `commands.rs` for size. The seam is the IPC boundary: this file is
//! only argument marshalling and kernel lookup, while the `perform_*` functions
//! it delegates to — the real behaviour, and what the tests drive — stay in the
//! parent.
//!
//! @coordinates-with commands.rs — the module this was split from
//! @module coherence/commands_ipc

use super::command_errors::{
    classify_write, kernel_poisoned, ledger_unavailable, rejected_argument, workspace_unavailable,
};
use super::command_types::{actor_identity, CoherenceStatus, ResolveReceipt, ResolveRequest};
use super::commands::{
    perform_breakdown_in, perform_head, perform_resolve, perform_status, CoherenceState,
};
use crate::command_error::CommandError;

use super::capture::{CaptureReceipt, CaptureRequest};
use super::capture_policy::{capture_with_policy, scan_on_change, CapturePolicy};
use super::index_query::EdgeRow;
use super::scan::ScanReport;

/// `Ok(None)` = declined by `policy` (capture-on-save off and nothing to follow
/// — see `capture_policy.rs`); nothing was written.
#[tauri::command]
pub async fn coherence_capture(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    request: CaptureRequest,
    policy: CapturePolicy,
) -> Result<Option<CaptureReceipt>, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    // `capture` validates the REQUEST before any side effect (8R-9: input caps,
    // `confidence=unknown` is scan-only, unknown object), so a rejected argument
    // is the dominant caller-actionable failure.
    capture_with_policy(&mut kernel, request, policy)
        .map_err(|e| classify_write(&kernel, rejected_argument, e))
}

#[tauri::command]
pub async fn coherence_resolve(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    request: ResolveRequest,
) -> Result<ResolveReceipt, CommandError> {
    let root = std::path::PathBuf::from(&workspace_root);
    let kernel = state
        .registry
        .kernel_for(&root, state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    let actor = actor_identity(&root);
    // A resolution names an edge and a verdict; the caller's remedy for a
    // rejection is to send a different one.
    perform_resolve(&mut kernel, &request, &actor)
        .map_err(|e| classify_write(&kernel, rejected_argument, e))
}

#[tauri::command]
pub async fn coherence_breakdown(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    context: Option<uuid::Uuid>,
) -> Result<Vec<EdgeRow>, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    // Read-only projection: nothing here is an argument problem.
    perform_breakdown_in(&mut kernel, context).map_err(ledger_unavailable)
}

#[tauri::command]
pub async fn coherence_status(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
) -> Result<CoherenceStatus, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    perform_status(&mut kernel).map_err(ledger_unavailable)
}

/// Read-time head lookup (audit T5) — see `head_pin.rs`. `content` is what the
/// MCP client was served and `base_content` the saved content an unsaved buffer
/// was edited from; the revision matching either is pinned.
#[tauri::command]
pub async fn coherence_head(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    path: String,
    content: Option<String>,
    base_content: Option<String>,
) -> Result<Option<serde_json::Value>, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    kernel.ensure_available().map_err(ledger_unavailable)?; // 8R-5: never serve a half-rebuilt index
                                                            // An unknown path is NOT an error: `null` is the documented answer for "not
                                                            // a known object" (audit T5), and turning it into `not-found` would make
                                                            // every read of an untracked file look like a failure.
    perform_head(&kernel, &path, content.as_deref(), base_content.as_deref())
        .map_err(ledger_unavailable)
}

#[tauri::command]
pub async fn coherence_scan(
    state: tauri::State<'_, CoherenceState>,
    workspace_root: String,
    policy: CapturePolicy,
) -> Result<ScanReport, CommandError> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)
        .map_err(workspace_unavailable)?;
    let mut kernel = kernel.lock().map_err(|_| kernel_poisoned())?;
    // A scan walks the workspace and appends its findings; a failure is the
    // environment (unreadable tree, ledger) rather than the caller's argument,
    // which is only a workspace root the registry already accepted.
    // Watcher-driven, so it obeys the capture-on-save setting (WI-LX1.4).
    scan_on_change(&mut kernel, policy).map_err(|e| classify_write(&kernel, ledger_unavailable, e))
}
