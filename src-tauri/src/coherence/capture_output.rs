//! The output side of a capture: which identity the written document carries
//! (and whether the file is rewritten to hold it), and the live-buffer disk-lag
//! bookkeeping that follows the append.
//!
//! Split out of `capture.rs` for size; `capture_locked` owns the ordering.
//!
//! @coordinates-with capture.rs — `capture_locked` calls both helpers
//! @module coherence/capture_output

use super::capture::CaptureRequest;
use super::capture_policy::CapturePolicy;
use super::frontmatter::{assign_identity, read_identity, FileIdentity};
use super::state::WorkspaceKernel;
use super::types::{Envelope, ObjectId, RevisionId};
use crate::atomic_replace::atomic_replace;

/// The output's identity and the content to record: read from the content;
/// for identity-less content REUSE the object registered at this path (editor
/// buffers do not carry the identity block in-session — minting a fresh id per
/// save would churn identity, §2.1/I3); only a genuinely unknown path mints a
/// new id. The file is rewritten atomically with the identity block only when
/// the request and the policy both allow it; the third value is that rewrite.
pub(super) fn output_identity(
    kernel: &mut WorkspaceKernel,
    req: &CaptureRequest,
    policy: CapturePolicy,
) -> Result<(String, FileIdentity, Option<String>), String> {
    if let Some(fi) = read_identity(&req.content) {
        return Ok((req.content.clone(), fi, None));
    }
    let registry = kernel.index().registry_state()?;
    let newly_adopted = !registry.object_at.contains_key(&req.path);
    if newly_adopted && super::frontmatter::has_malformed_frontmatter(&req.content) {
        let env = Envelope::create(
            "diagnostic",
            kernel.writer(),
            serde_json::json!({
                "code": "malformed-frontmatter",
                "message": "unterminated frontmatter fence — treated as content, identity block added above it (spec §2.1)",
                "path": req.path,
            }),
        );
        kernel.append_and_apply(&env)?;
    }
    let (content, fi) = match registry.object_at.get(&req.path) {
        Some(existing) => {
            let schema = registry.schema_of.get(existing).cloned().flatten();
            let content = super::canonical::insert_identity(
                &req.content,
                &existing.0.to_string(),
                schema.as_deref(),
            );
            (
                content,
                FileIdentity {
                    id: *existing,
                    schema,
                },
            )
        }
        None => assign_identity(&req.content, None),
    };
    if !(req.rewrite_identity && policy.may_stamp()) {
        return Ok((content, fi, None));
    }
    let abs = super::paths::resolve_workspace_rel(kernel.root(), &req.path)?;
    let parent = abs
        .parent()
        .ok_or_else(|| format!("output path has no parent: {}", req.path))?
        .to_path_buf();
    atomic_replace(&abs, &parent, content.as_bytes())
        .map_err(|e| format!("identity rewrite failed: {e:?}"))?;
    Ok((content.clone(), fi, Some(content)))
}

/// Buffer-lag bookkeeping (spec §2.3 vs. the live-buffer design): with
/// rewrite_identity=false the DISK legitimately still holds the parent content;
/// record those hashes so scan skips exactly that state and nothing else
/// (A → B → A external edits still mint). A real disk write clears the lag.
pub(super) fn record_disk_lag(
    kernel: &mut WorkspaceKernel,
    object: &ObjectId,
    rewrite_identity: bool,
    parents: &[RevisionId],
) -> Result<(), String> {
    if rewrite_identity {
        return kernel.index_mut().clear_disk_lag(object);
    }
    let mut lag = Vec::new();
    for parent in parents {
        if let Some(h) = kernel.index().content_hash_of(object, parent)? {
            lag.push(h);
        }
    }
    kernel.index_mut().set_disk_lag(object, &lag)
}
