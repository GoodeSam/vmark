//! # Quit, attempt by attempt
//!
//! Purpose: decide whether a quit request starts (or restarts) the coordinated
//! quit, and ask each document window to run its close flow.
//!
//! Key decisions:
//!   - A window that has not signalled `ready` has no listener for
//!     `app:quit-requested` yet. Emitting to it loses the request: the window
//!     stays a quit target forever and the quit never finishes. The request is
//!     queued on the readiness queue menu events use and delivered when the
//!     window mounts. It is NOT treated as having nothing to save — a window
//!     still booting may be about to claim a dragged-out tab or restore a
//!     hot-exit session, and only its frontend knows.
//!   - A quit in progress swallows repeated requests only for
//!     [`QUIT_RETRY_AFTER`]. The flag used to swallow them for the life of the
//!     process, so a quit that stalled — a request that reached no listener, a
//!     frontend that never answered — left Cmd+Q dead. A later request now
//!     asks every remaining window again. Asking again is safe: the frontend
//!     joins a close flow that is already running, and a request still queued
//!     for a window is not queued twice.
//!   - Nothing is force-closed on a retry. A window that never becomes ready
//!     still holds the quit open; destroying it could discard a payload only
//!     it can claim, and that trade is the user's to make.
//!
//! @coordinates-with quit.rs — owns the quit flags and the target set
//! @coordinates-with menu_events.rs — the readiness queue
//! @module quit::broadcast

use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Runtime, WebviewWindow};

use crate::menu_events::{self, Delivery};

/// The event a document window's frontend answers by running its close flow.
pub(super) const QUIT_REQUESTED_EVENT: &str = "app:quit-requested";

/// How long a quit in progress swallows repeated quit requests.
///
/// Long enough to absorb the duplicates one gesture produces (the menu item
/// and the OS exit request it triggers) and for a healthy quit to finish or
/// be visibly waiting on a save prompt; short enough that a user who sees
/// nothing happen and quits again is answered.
pub(super) const QUIT_RETRY_AFTER: Duration = Duration::from_secs(10);

/// When the quit in progress was last started. Lives beside `QUIT_IN_PROGRESS`
/// (a static because `cancel_quit` and `is_quit_in_progress` are reached with
/// no app handle), and is only ever written together with it.
static QUIT_STARTED_AT: Mutex<Option<Instant>> = Mutex::new(None);

/// What a quit request amounts to, given the quit already under way (if any).
#[derive(Debug, PartialEq, Eq)]
pub(super) enum QuitAttempt {
    /// No quit was in progress; this request starts one.
    Fresh,
    /// A quit has been in progress for [`QUIT_RETRY_AFTER`] or longer; this
    /// request asks every remaining window again.
    Retry,
    /// A quit started moments ago; this request is a duplicate of it.
    AlreadyRunning,
}

/// Claim the quit for a request arriving at `now`.
pub(super) fn claim_quit_attempt(now: Instant) -> QuitAttempt {
    let mut started = QUIT_STARTED_AT.lock().unwrap_or_else(|p| p.into_inner());
    if !super::QUIT_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        *started = Some(now);
        return QuitAttempt::Fresh;
    }
    match *started {
        // `saturating`: the two instants are taken on different threads, and
        // one a hair older than the start is a duplicate, not a panic.
        Some(at) if now.saturating_duration_since(at) < QUIT_RETRY_AFTER => {
            QuitAttempt::AlreadyRunning
        }
        _ => {
            *started = Some(now);
            QuitAttempt::Retry
        }
    }
}

/// Forget the attempt with the quit it belonged to, and withdraw the request
/// from every window it was still waiting for: a window that finishes
/// starting after the quit was called off must not be closed by it.
pub(super) fn forget_quit_attempt() {
    *QUIT_STARTED_AT.lock().unwrap_or_else(|p| p.into_inner()) = None;
    menu_events::withdraw_deferred(QUIT_REQUESTED_EVENT);
}

/// Ask each document window to run its close flow: now if its frontend is
/// listening, when it signals `ready` otherwise. On a failed emit, returns
/// the label it failed for; the caller cancels the quit.
pub(super) fn request_quit_of<R: Runtime>(
    windows: &[(String, WebviewWindow<R>)],
) -> Result<(), (String, tauri::Error)> {
    for (label, window) in windows {
        match menu_events::deliver_when_ready(window, QUIT_REQUESTED_EVENT) {
            Ok(Delivery::Emitted) => {}
            Ok(Delivery::Deferred) => log::info!(
                "[quit] '{label}' is still starting; it will be asked to quit when it is ready"
            ),
            Err(error) => return Err((label.clone(), error)),
        }
    }
    Ok(())
}

/// Abort a coordinated quit because a window never received
/// `app:quit-requested`: that window would stay in `QUIT_TARGETS` forever and
/// the quit could not finish. Cancelling resets all quit state so the user can
/// retry at once (safest for unsaved data: no window is force-closed).
pub(super) fn abort_quit_on_emit_failure(label: &str, err: impl std::fmt::Display) {
    log::error!(
        "[quit] Failed to emit app:quit-requested to '{label}': {err} — cancelling coordinated quit"
    );
    super::cancel_quit();
}

#[cfg(test)]
#[path = "quit_broadcast.test.rs"]
mod tests;
