//! Resolving a capture's declared inputs to concrete objects and revisions.
//!
//! Split out of `capture.rs` for size. Input resolution is the step that decides
//! WHAT a capture depends on; the parent owns the append that records it.
//!
//! @coordinates-with capture.rs — the module this was split from
//! @module coherence/capture_input

use super::adopt::{adopt_from_disk, adopt_identified_from_disk};
use super::capture::CaptureInputSpec;

use super::state::WorkspaceKernel;
use super::types::{Confidence, InputRef, ObjectId, RevisionId};

/// Resolve every input of a capture. An input `resolve_input` declined (it
/// would have had to be stamped) is dropped, and an `exact` capture whose input
/// set is therefore known to be incomplete is lowered to `inferred` (WI-LX1.4).
pub(super) fn resolve_inputs(
    kernel: &mut WorkspaceKernel,
    specs: &[CaptureInputSpec],
    may_stamp: bool,
    confidence: Confidence,
) -> Result<(Vec<InputRef>, Confidence), String> {
    let mut inputs = Vec::with_capacity(specs.len());
    let mut dropped = false;
    for spec in specs {
        match resolve_input(kernel, spec, may_stamp)? {
            Some(input) => inputs.push(input),
            None => dropped = true,
        }
    }
    let confidence = if dropped && confidence == Confidence::Exact {
        Confidence::Inferred
    } else {
        confidence
    };
    Ok((inputs, confidence))
}

/// Resolve one input spec per the plan contract: caller revision wins but
/// is validated (object membership — reject on mismatch, no fallback);
/// otherwise current head; uncaptured input files are adopted.
///
/// `may_stamp = false` (capture-on-save OFF, WI-LX1.4): an uncaptured input is
/// adopted only when its file already carries a `vmark:` block. One that would
/// have to be stamped is left alone and reported as `None` — the caller drops
/// it and lowers the capture's confidence.
fn resolve_input(
    kernel: &mut WorkspaceKernel,
    spec: &CaptureInputSpec,
    may_stamp: bool,
) -> Result<Option<InputRef>, String> {
    let Some(object) = resolve_object(kernel, spec, may_stamp)? else {
        return Ok(None);
    };
    let revision = resolve_revision(kernel, &object, spec.revision.as_ref())?;
    Ok(Some(InputRef {
        object,
        revision,
        role: spec.role,
        // Carry the spec's kind (defaults to dependency); Extract-Canon is the
        // only path that sets conformance today (Phase 4).
        kind: spec.kind,
    }))
}

/// The input's object: named outright, registered at its path, or adopted from
/// disk — by stamping only when `may_stamp`, else only if the file already
/// carries its own identity. `None` = it could only have been stamped.
fn resolve_object(
    kernel: &mut WorkspaceKernel,
    spec: &CaptureInputSpec,
    may_stamp: bool,
) -> Result<Option<ObjectId>, String> {
    match (spec.object_id, &spec.path) {
        (Some(id), _) => Ok(Some(id)),
        (None, Some(path)) => match kernel.index().registry_state()?.object_at.get(path) {
            Some(id) => Ok(Some(*id)),
            None if may_stamp => Ok(Some(adopt_from_disk(kernel, path)?.0)),
            None => Ok(adopt_identified_from_disk(kernel, path)?.map(|(id, _)| id)),
        },
        (None, None) => Err("input needs a path or an object_id".into()),
    }
}

/// The caller's revision, validated to belong to `object` (reject on mismatch,
/// no fallback); otherwise the object's single current head.
fn resolve_revision(
    kernel: &WorkspaceKernel,
    object: &ObjectId,
    requested: Option<&RevisionId>,
) -> Result<RevisionId, String> {
    if let Some(rev) = requested {
        if kernel.index().content_hash_of(object, rev)?.is_none() {
            return Err(format!(
                "input revision {} does not belong to object {}",
                rev.as_str(),
                object.0
            ));
        }
        return Ok(rev.clone());
    }
    let heads = kernel.index().heads(object)?;
    match heads.as_slice() {
        [only] => Ok(only.clone()),
        [] => Err(format!("input object {} has no revisions", object.0)),
        _ => Err(format!(
            "input object {} is diverged (multiple heads) — pass an explicit revision",
            object.0
        )),
    }
}
