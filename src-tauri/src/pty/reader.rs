//! The PTY reader thread (`pty_start`), split out of `pty.rs` at WI-DP4.1.
//!
//! Purpose: own the streaming half of a PTY session — pump bytes from the
//! interruptible output source to the webview over the per-session Channel,
//! and guarantee the shell is reaped and `pty:exit:{pid}` emitted on EVERY way
//! the pump can end: the shell exited, the session was stopped, the channel
//! went away, a read failed, or the pump panicked.
//!
//! Split out because `pty.rs` holds the seven other commands and this one is
//! longer than all of them together; the file-size gate flagged it and the loop
//! is the one part with real control flow to read.
//!
//! Key decisions:
//!   - The shell stays in the session (`child.rs`); this thread only reaps it.
//!     So a session can be stopped from outside without first getting this
//!     thread to notice anything.
//!   - End of output is not proof the shell exited (it can close its terminal
//!     and keep running), so the exit code is awaited with a short, capped
//!     backoff that a stop request cuts short. A shell that exits normally is
//!     reaped on the first or second check.
//!   - Every other ending terminates the shell through the same escalation as
//!     an explicit close. Running it here as well as on the stopping thread is
//!     safe: it is idempotent and serialized by the child slot.
//!
//! @coordinates-with pty.rs — re-exports `pty_start` so the command registry
//!   still resolves `pty::pty_start`
//! @coordinates-with pty/session.rs — `get_session`, `PtyExitEvent`, `Session`
//! @coordinates-with pty/output.rs — the interruptible source this pumps
//! @coordinates-with pty/child.rs — reaping and termination

use super::child::{terminate_children, HANGUP_GRACE};
use super::output::{Chunk, OutputSource};
use super::session::{get_session, PtyExitEvent, Session, StartError};
use super::{pty_internal, session_gone, PtyState};
use crate::command_error::CommandError;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

/// Cap on the backoff between exit checks once the output has ended.
const EXIT_CHECK_MAX: Duration = Duration::from_millis(100);

/// Start the reader thread for a PTY session.
/// Must be called exactly once per session, after the caller has wired the
/// `on_bytes` Channel and the `pty:exit:{pid}` listener.
/// Sends output bytes over `on_bytes` (Raw → ArrayBuffer); emits
/// `pty:exit:{pid}` once the shell is gone.
#[tauri::command]
pub async fn pty_start<R: Runtime>(
    pid: u32,
    on_bytes: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
    state: tauri::State<'_, PtyState>,
    app: AppHandle<R>,
) -> Result<(), CommandError> {
    let session = get_session(&state, pid)
        .await
        .map_err(|_| session_gone(pid))?;
    let exit_event = format!("pty:exit:{pid}");

    // An explicit thread name (`pty-reader-{pid}`) is kept for log filtering.
    session
        .start_reader(format!("pty-reader-{pid}"), move |session, source| {
            let exit_code = run_reader(pid, &session, source, |bytes| {
                // Raw → ArrayBuffer in the webview, point-to-point (no
                // `app.emit` broadcast to every window).
                on_bytes
                    .send(tauri::ipc::InvokeResponseBody::Raw(bytes))
                    .is_ok()
            });
            // Released before the exit is announced: delivering the event
            // must not be what keeps the session's descriptors open.
            drop(session);
            let _ = app.emit(&exit_event, PtyExitEvent { exit_code });
        })
        .map_err(|error| match error {
            StartError::AlreadyStarted => {
                CommandError::conflict("pty_start already called for this session")
            }
            StartError::Spawn(e) => pty_internal("failed to spawn PTY reader thread", e),
        })
}

/// How the pump stopped.
enum PumpEnd {
    /// The slave side is closed everywhere: the shell has most likely exited.
    OutputEnded,
    /// Stop requested, channel gone, or a read failed: the shell must go.
    Stopped,
}

/// Pump output until it ends, then return the shell's exit code — reaping the
/// shell on every path, so no zombie is left whichever way the pump ended.
pub(super) fn run_reader(
    pid: u32,
    session: &Session,
    mut source: OutputSource,
    send: impl Fn(Vec<u8>) -> bool,
) -> u32 {
    // The pump has no operation that should panic; catching one keeps a
    // defect in it from taking the whole process down, and still reaps.
    let pumped = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        pump(pid, session, &mut source, &send)
    }));
    let end = pumped.unwrap_or_else(|payload| {
        log::error!(
            "[task:pty-reader-{pid}] reader thread panicked: {}",
            crate::task::panic_payload_message(&payload),
        );
        PumpEnd::Stopped
    });
    if let PumpEnd::OutputEnded = end {
        if let Some(exit_code) = await_exit(session, &source) {
            return exit_code;
        }
    }
    terminate_children(&[&session.child], HANGUP_GRACE);
    session.child.try_reap().unwrap_or(1)
}

fn pump(
    pid: u32,
    session: &Session,
    source: &mut OutputSource,
    send: &impl Fn(Vec<u8>) -> bool,
) -> PumpEnd {
    // 64 KB buffer (WI-1.2): far fewer reads/sends per burst than the old
    // 4 KB, which compounds with the binary Channel (WI-1.1).
    let mut buf = vec![0u8; 65536];
    loop {
        if session.shutdown.load(Ordering::Acquire) {
            return PumpEnd::Stopped;
        }
        session.pause_ctl.wait_if_paused();
        if session.shutdown.load(Ordering::Acquire) {
            return PumpEnd::Stopped;
        }
        match source.read(&mut buf) {
            Ok(Chunk::Data(n)) => {
                // A send error means the webview or its channel is gone:
                // nobody is left to watch this shell.
                if !send(buf[..n].to_vec()) {
                    return PumpEnd::Stopped;
                }
            }
            Ok(Chunk::Eof) => return PumpEnd::OutputEnded,
            Ok(Chunk::Interrupted) => return PumpEnd::Stopped,
            // A terminal that dies on a read error leaves a diagnostic
            // (WI-4.3 / G8) instead of vanishing silently.
            Err(e) => {
                log::warn!("[pty] reader {pid} read error ({:?}): {e}", e.kind());
                return PumpEnd::Stopped;
            }
        }
    }
}

/// Wait for a shell whose output has ended to exit, and reap it. `None` when
/// a stop request arrives first (or the wait itself fails): the caller then
/// terminates the shell instead.
fn await_exit(session: &Session, source: &OutputSource) -> Option<u32> {
    let mut pause = Duration::from_millis(1);
    loop {
        if let Some(exit_code) = session.child.try_reap() {
            return Some(exit_code);
        }
        if session.shutdown.load(Ordering::Acquire) {
            return None;
        }
        match source.interrupted_within(pause) {
            Ok(false) => pause = (pause * 2).min(EXIT_CHECK_MAX),
            Ok(true) => return None,
            Err(e) => {
                log::warn!("[pty] cannot wait for the shell to exit: {e}");
                return None;
            }
        }
    }
}
