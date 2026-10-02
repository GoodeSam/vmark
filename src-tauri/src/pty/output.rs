//! The read side of a PTY master, and the handle that interrupts it.
//!
//! Purpose: let a session stop its reader thread at any moment. A plain
//! blocking `read` on the master returns only when every process holding the
//! slave side has closed it — so an orphan that keeps the terminal open (a
//! `nohup`-ed job, a shell that ignores the hangup) pins the thread, and with
//! it every master descriptor, for as long as the orphan lives.
//!
//! Key decisions:
//!   - Unix waits on two descriptors — the master and a wake socket — and reads
//!     only once the master is readable. The wake socket is written exactly
//!     when the session wants the reader gone.
//!   - `select`, not `poll` or kqueue: it is the one multiplexer that has
//!     always worked on pty masters on macOS (libuv, tmux and OpenSSH all fall
//!     back to it there). Its descriptor-number ceiling is checked when the
//!     pair is created, so a descriptor it cannot watch is an error at spawn
//!     time rather than undefined behaviour later.
//!   - The master is NOT put in non-blocking mode. That flag lives on the open
//!     file description the writer shares, and a large paste relies on the
//!     write blocking until the foreground process reads.
//!   - Windows has no equivalent wait on a ConPTY pipe; there the read ends
//!     when the console closes, as before, and the interrupt is a no-op.
//!
//! @coordinates-with pty/session.rs — creates the pair, owns the `Interrupter`
//! @coordinates-with pty/reader.rs — drives the `OutputSource`
//! @module pty/output

use portable_pty::MasterPty;
use std::io;

/// What one read of the master produced.
pub(super) enum Chunk {
    /// This many bytes were written into the buffer.
    Data(usize),
    /// Every holder of the slave side has closed it.
    Eof,
    /// The session asked the reader to stop.
    Interrupted,
}

/// Build the reader's source and the session's handle to interrupt it.
pub(super) fn channel(master: &dyn MasterPty) -> io::Result<(OutputSource, Interrupter)> {
    platform::channel(master)
}

pub(super) use platform::{Interrupter, OutputSource};

#[cfg(unix)]
mod platform {
    use super::{Chunk, MasterPty};
    use std::fs::File;
    use std::io::{self, Read, Write};
    use std::os::fd::{AsRawFd, BorrowedFd, RawFd};
    use std::os::unix::net::UnixStream;
    use std::time::Duration;

    pub(in crate::pty) struct OutputSource {
        master: File,
        wake: UnixStream,
    }

    pub(in crate::pty) struct Interrupter {
        wake: UnixStream,
    }

    pub(super) fn channel(master: &dyn MasterPty) -> io::Result<(OutputSource, Interrupter)> {
        let raw = master
            .as_raw_fd()
            .ok_or_else(|| io::Error::other("PTY master exposes no descriptor"))?;
        // SAFETY: `master` is borrowed for this whole call, so `raw` is an open
        // descriptor until the duplicate below owns its own.
        let master = unsafe { BorrowedFd::borrow_raw(raw) }.try_clone_to_owned()?;
        let (wake_rx, wake_tx) = UnixStream::pair()?;
        // A full wake buffer already means "interrupted"; never block on it.
        wake_tx.set_nonblocking(true)?;
        for fd in [master.as_raw_fd(), wake_rx.as_raw_fd()] {
            if usize::try_from(fd).map_or(true, |fd| fd >= libc::FD_SETSIZE) {
                return Err(io::Error::other(
                    "too many open descriptors to watch a terminal",
                ));
            }
        }
        Ok((
            OutputSource {
                master: File::from(master),
                wake: wake_rx,
            },
            Interrupter { wake: wake_tx },
        ))
    }

    struct Ready {
        master: bool,
        wake: bool,
    }

    /// Block until `wake` — or `master`, when given — is readable, or until
    /// `timeout` elapses. Both descriptors are below `FD_SETSIZE` (`channel`
    /// checked them).
    fn wait_readable(
        master: Option<RawFd>,
        wake: RawFd,
        timeout: Option<Duration>,
    ) -> io::Result<Ready> {
        loop {
            // SAFETY: an all-zero `fd_set` is a valid empty set; `FD_ZERO`
            // then initializes it the way the platform expects.
            let mut set: libc::fd_set = unsafe { std::mem::zeroed() };
            // SAFETY: `set` is a live `fd_set`, and every descriptor added is
            // open and below `FD_SETSIZE`.
            unsafe {
                libc::FD_ZERO(&mut set);
                libc::FD_SET(wake, &mut set);
                if let Some(master) = master {
                    libc::FD_SET(master, &mut set);
                }
            }
            let mut interval = timeout.map(|timeout| libc::timeval {
                tv_sec: timeout.as_secs() as libc::time_t,
                tv_usec: timeout.subsec_micros() as libc::suseconds_t,
            });
            let interval = interval
                .as_mut()
                .map_or(std::ptr::null_mut(), |interval| interval as *mut _);
            let highest = master.map_or(wake, |master| master.max(wake));
            // SAFETY: `set` and `interval` outlive the call, and the write and
            // error sets are null, which `select` accepts.
            let ready = unsafe {
                libc::select(
                    highest + 1,
                    &mut set,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    interval,
                )
            };
            if ready < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(error);
            }
            // SAFETY: `set` was filled in by the `select` call above.
            return Ok(unsafe {
                Ready {
                    master: master.is_some_and(|master| libc::FD_ISSET(master, &set)),
                    wake: libc::FD_ISSET(wake, &set),
                }
            });
        }
    }

    impl OutputSource {
        /// Read the next chunk of output. An interrupt wins over pending
        /// output: the session is going away and nobody will read it.
        pub(in crate::pty) fn read(&mut self, buf: &mut [u8]) -> io::Result<Chunk> {
            loop {
                let ready =
                    wait_readable(Some(self.master.as_raw_fd()), self.wake.as_raw_fd(), None)?;
                if ready.wake {
                    return Ok(Chunk::Interrupted);
                }
                if !ready.master {
                    continue;
                }
                return match self.master.read(buf) {
                    Ok(0) => Ok(Chunk::Eof),
                    Ok(n) => Ok(Chunk::Data(n)),
                    // Linux reports a fully closed slave side as EIO.
                    Err(e) if e.raw_os_error() == Some(libc::EIO) => Ok(Chunk::Eof),
                    Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                    Err(e) => Err(e),
                };
            }
        }

        /// Wait for `timeout`; true when the session interrupted the wait.
        pub(in crate::pty) fn interrupted_within(&self, timeout: Duration) -> io::Result<bool> {
            Ok(wait_readable(None, self.wake.as_raw_fd(), Some(timeout))?.wake)
        }
    }

    impl Interrupter {
        /// Make the reader's current and every later wait return
        /// `Interrupted`. Never blocks; safe to call more than once.
        pub(in crate::pty) fn interrupt(&self) {
            match (&self.wake).write(&[1]) {
                Ok(_) => {}
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => {}
                // The reader is already gone and took its end with it.
                Err(e) if e.kind() == io::ErrorKind::BrokenPipe => {}
                Err(e) => log::warn!("[pty] cannot interrupt reader: {e}"),
            }
        }
    }
}

#[cfg(not(unix))]
mod platform {
    use super::{Chunk, MasterPty};
    use std::io::{self, Read};
    use std::time::Duration;

    pub(in crate::pty) struct OutputSource {
        reader: Box<dyn Read + Send>,
    }

    pub(in crate::pty) struct Interrupter;

    pub(super) fn channel(master: &dyn MasterPty) -> io::Result<(OutputSource, Interrupter)> {
        let reader = master.try_clone_reader().map_err(io::Error::other)?;
        Ok((OutputSource { reader }, Interrupter))
    }

    impl OutputSource {
        pub(in crate::pty) fn read(&mut self, buf: &mut [u8]) -> io::Result<Chunk> {
            loop {
                return match self.reader.read(buf) {
                    Ok(0) => Ok(Chunk::Eof),
                    Ok(n) => Ok(Chunk::Data(n)),
                    Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                    Err(e) => Err(e),
                };
            }
        }

        pub(in crate::pty) fn interrupted_within(&self, timeout: Duration) -> io::Result<bool> {
            std::thread::sleep(timeout);
            Ok(false)
        }
    }

    impl Interrupter {
        pub(in crate::pty) fn interrupt(&self) {}
    }
}

// Unix-only: the tests open real ptys.
#[cfg(all(test, unix))]
#[path = "output.test.rs"]
mod tests;
