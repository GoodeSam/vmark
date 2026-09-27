//! The user's `general.coherenceCaptureOnSave` setting, as the kernel sees it
//! (WI-LX1.4).
//!
//! Every write-driven entry into the kernel — the `coherence_capture` IPC (human
//! save, MCP `document.write` / `workspace.save`, genie apply, accepted AI
//! suggestion, history restore, explorer new-file) and the watcher-driven
//! `coherence_scan` — carries a `CapturePolicy`. The webview reads the setting
//! at the moment of the write and sends it with the request, so there is no
//! pushed copy that can lag behind the store.
//!
//! Key decisions:
//!   - **The kernel enforces it, not each caller.** Only the kernel knows whether
//!     the workspace already has a ledger, whether a path is already tracked, and
//!     whether an input must be adopted — and adoption is what stamped files the
//!     caller never named. A frontend-only check could see none of that.
//!   - **"Already has a ledger" means `.vmark/` is fully initialized**
//!     (`WorkspaceKernel::is_initialized`, the merge=union marker). Under
//!     `TrackedOnly` such a workspace keeps recording writes to documents it
//!     already tracks (registered path, or content that already carries its own
//!     `vmark:` block) — the workspace owner opted in, and the watcher scan would
//!     record those writes anyway, only less precisely. It never adopts a new
//!     document, never creates `.vmark/`, and never rewrites any file.
//!   - An input that could only be resolved by stamping it is DROPPED and the
//!     capture's confidence falls to `inferred`: an input set known to be
//!     incomplete must not be reported as exact.
//!
//! @coordinates-with capture.rs — `capture_locked` applies the policy per step
//! @coordinates-with src/services/coherence/capturePolicy.ts — the webview side
//! @module coherence/capture_policy

use super::capture::{capture_locked, CaptureReceipt, CaptureRequest};
use super::frontmatter::read_identity;
use super::scan::scan_workspace;
use super::scan_report::ScanReport;
use super::state::WorkspaceKernel;

/// What an implicit, write-driven capture may do to the workspace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CapturePolicy {
    /// Setting ON: may create `.vmark/`, adopt new documents, and stamp
    /// `vmark:` identity blocks into files.
    Adopt,
    /// Setting OFF: only follow documents an existing ledger already tracks;
    /// create nothing and rewrite nothing.
    TrackedOnly,
}

impl CapturePolicy {
    /// May this capture rewrite a file on disk to insert an identity block?
    pub fn may_stamp(self) -> bool {
        self == CapturePolicy::Adopt
    }

    /// May an implicit write proceed against this kernel at all? Under
    /// `TrackedOnly` a workspace without a ledger is left exactly as it is.
    pub fn admits(self, kernel: &WorkspaceKernel) -> bool {
        self == CapturePolicy::Adopt || kernel.is_initialized()
    }
}

/// `capture` under the user's capture-on-save setting. `Ok(None)` = declined
/// by the policy with no side effect: no `.vmark/`, no registration, no file
/// rewritten.
pub fn capture_with_policy(
    kernel: &mut WorkspaceKernel,
    req: CaptureRequest,
    policy: CapturePolicy,
) -> Result<Option<CaptureReceipt>, String> {
    if !policy.admits(kernel) {
        return Ok(None); // before the lock: acquiring it creates `.vmark/`
    }
    kernel.with_write_lock(|kernel| capture_locked(kernel, req, policy))
}

/// Under `TrackedOnly`, only a document the ledger already follows is
/// captured: its path is registered, or its content carries its own identity.
pub(super) fn admits_output(
    kernel: &WorkspaceKernel,
    req: &CaptureRequest,
    policy: CapturePolicy,
) -> Result<bool, String> {
    if policy.may_stamp() || read_identity(&req.content).is_some() {
        return Ok(true);
    }
    Ok(kernel
        .index()
        .registry_state()?
        .object_at
        .contains_key(&req.path))
}

/// The watcher-driven reconciliation pass. Under `TrackedOnly` a workspace
/// without a ledger is not scanned: the pass's first append would create
/// `.vmark/`. Nothing was reconciled, so the report is incomplete (and so can
/// never drive a deletion).
pub fn scan_on_change(
    kernel: &mut WorkspaceKernel,
    policy: CapturePolicy,
) -> Result<ScanReport, String> {
    if !policy.admits(kernel) {
        return Ok(ScanReport::default());
    }
    scan_workspace(kernel)
}

#[cfg(test)]
#[path = "capture_policy.test.rs"]
mod tests;
