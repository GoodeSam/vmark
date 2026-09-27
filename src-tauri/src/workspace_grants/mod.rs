//! Rust-owned workspace grants (WI-LX1.1).
//!
//! Purpose: decide which folders get a RECURSIVE fs + asset-protocol grant, and
//! remember them across launches. A runtime fs grant is not read-only — the fs
//! plugin accepts a runtime-granted path for every command the capability
//! permits (write, rename, remove) — so this is the widest grant the app makes.
//!
//! Key decisions:
//!   - A root is granted only when Rust can attribute it to the user: the
//!     folder picker Rust shows (`pick_workspace_folder`), a folder opened
//!     from Finder (`file_open.rs`), or a root recorded from one of those in
//!     an earlier session. `allow_workspace_access` used to grant ANY path a
//!     script handed it, `/` included; it now only re-issues a recorded root
//!     (or a folder inside one) and refuses the rest.
//!   - The record is `<app data>/workspace-grants.json`, written atomically and
//!     re-granted at launch. Launch waits at most [`LAUNCH_REGRANT_WAIT`] for it,
//!     so a recorded root on a stale mount cannot hang startup.
//!   - A recorded root is re-granted only if it still resolves to ITSELF. Tauri
//!     also inserts the canonical form of a granted path, so re-granting a name
//!     that has since become a link would grant the link's target (#250).
//!   - The list is protected against WEBVIEW-SUPPLIED writes: the fs plugin
//!     is fenced off it (the static scope covers `$HOME/**`, which holds the
//!     app data directory on macOS and Windows), and the file is created at
//!     launch so the fence also catches other spellings of its name;
//!     `atomic_write_file` and `create_file_exclusive` refuse it
//!     (`protect.rs`); and its array format is one the store plugin, which can
//!     write any path but only a JSON object, cannot produce (`registry.rs`).
//!     Not covered: a workflow `action/save-file` step whose workspace root is
//!     the app data folder (the engine is off by default), and any process
//!     running as the user — the terminal's shell, an AI provider CLI, anything
//!     outside VMark — which can edit it like any other file. An edit takes
//!     effect at the next launch.
//!
//! @coordinates-with workspace_grants/commands.rs — the two webview commands
//! @coordinates-with workspace_grants/registry.rs — the list and its file format
//! @coordinates-with workspace_grants/protect.rs — refusing writes to the list
//! @coordinates-with fs_scope.rs — `allow_fs_read_dir`, the grant itself
//! @coordinates-with file_open.rs — Finder folder opens
//! @coordinates-with app_setup.rs — `restore_at_launch`
//! @module workspace_grants

pub mod commands;
mod protect;
mod registry;

pub(crate) use protect::{refuse_list_write, refuse_root_containing_list};

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};

use crate::command_error::{CommandError, ErrorCode};
use registry::GrantList;

/// File name of the recorded roots, in the app data directory.
pub(crate) const GRANTS_FILE: &str = "workspace-grants.json";

/// How long launch waits for recorded roots to be re-granted before it carries
/// on. Local disks finish in microseconds; only an unreachable mount is slower,
/// and that root is unreadable either way.
const LAUNCH_REGRANT_WAIT: Duration = Duration::from_millis(500);

/// The recorded roots and the one-dialog-at-a-time flag. Managed by Tauri.
#[derive(Default)]
pub struct WorkspaceGrants {
    state: Mutex<GrantState>,
    picker_open: AtomicBool,
}

#[derive(Default)]
struct GrantState {
    list: GrantList,
    /// Where the list persists. `None` until launch resolves the app data
    /// directory; a choice made before then is kept in memory and merged.
    file: Option<PathBuf>,
}

/// Held while a folder dialog is open; releases the slot when dropped.
pub(crate) struct PickerFlight<'a>(&'a AtomicBool);

impl Drop for PickerFlight<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl WorkspaceGrants {
    fn lock(&self) -> std::sync::MutexGuard<'_, GrantState> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Is `canonical` a recorded root, or inside one?
    pub(crate) fn covers(&self, canonical: &str) -> bool {
        self.lock().list.covers(canonical)
    }

    /// Record a root the user chose, and persist the list. A failed write is
    /// logged, not returned: the grant already holds for this session, and the
    /// cost of losing the record is one picker confirmation next launch.
    pub(crate) fn record(&self, canonical: &str) {
        let mut state = self.lock();
        if !state.list.record(canonical) {
            return;
        }
        if let Some(file) = state.file.as_deref() {
            if let Err(e) = persist(file, &state.list) {
                log::error!("[workspace-grants] Could not save {}: {e}", file.display());
            }
        }
    }

    fn roots(&self) -> Vec<String> {
        self.lock().list.roots().to_vec()
    }

    /// Where the list persists, once launch has resolved it.
    pub(crate) fn list_file(&self) -> Option<PathBuf> {
        self.lock().file.clone()
    }

    /// Write the list if its file does not exist yet, so the fs-plugin fence
    /// (a case-sensitive glob, matched against the canonical name of an
    /// EXISTING file) covers every spelling of the name from launch on.
    fn persist_if_missing(&self) {
        let state = self.lock();
        let Some(file) = state.file.as_deref() else {
            return;
        };
        if file.exists() {
            return;
        }
        if let Err(e) = persist(file, &state.list) {
            log::error!(
                "[workspace-grants] Could not create {}: {e}",
                file.display()
            );
        }
    }

    /// Adopt `file` as the list's home, folding what it holds in behind any
    /// root chosen earlier this session. An unreadable file contributes
    /// nothing and is replaced by the next choice.
    fn load(&self, file: PathBuf) {
        let from_disk = match std::fs::read(&file) {
            Ok(bytes) => GrantList::parse(&bytes).unwrap_or_else(|e| {
                log::warn!("[workspace-grants] Ignoring {}: {e}", file.display());
                GrantList::default()
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => GrantList::default(),
            Err(e) => {
                log::warn!("[workspace-grants] Could not read {}: {e}", file.display());
                GrantList::default()
            }
        };
        let mut state = self.lock();
        state.list.absorb(from_disk);
        state.file = Some(file);
    }

    /// Claim the folder-dialog slot, or `None` while another dialog is open.
    pub(crate) fn begin_picker(&self) -> Option<PickerFlight<'_>> {
        self.picker_open
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| PickerFlight(&self.picker_open))
    }
}

fn persist(file: &Path, list: &GrantList) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    crate::app_paths::atomic_write_file(file, &list.to_bytes())
}

/// Resolve `raw` to the canonical folder it names, spelled for the frontend.
pub(crate) fn canonical_dir(raw: &Path) -> Result<String, CommandError> {
    if !raw.is_absolute() {
        return Err(CommandError::invalid_input(format!(
            "'{}' is not absolute",
            raw.display()
        )));
    }
    let canonical = raw.canonicalize().map_err(|e| {
        let code = match e.kind() {
            std::io::ErrorKind::NotFound => ErrorCode::NotFound,
            std::io::ErrorKind::PermissionDenied => ErrorCode::PermissionDenied,
            _ => ErrorCode::Io,
        };
        CommandError::new(
            code,
            format!("'{}' could not be resolved: {e}", raw.display()),
        )
    })?;
    if !canonical.is_dir() {
        return Err(CommandError::invalid_input(format!(
            "'{}' is not a folder",
            raw.display()
        )));
    }
    crate::canonical_path::canonical_string(&canonical, "workspace folder")
        .map_err(CommandError::invalid_input)
}

/// Grant `raw` because the USER chose it — the folder picker, or Finder — and
/// record it so later launches re-grant it. Returns the canonical root.
pub(crate) fn grant_chosen_root<R: Runtime>(
    app: &AppHandle<R>,
    raw: &Path,
) -> Result<String, CommandError> {
    let root = canonical_dir(raw)?;
    crate::fs_scope::allow_fs_read_dir(app, &root);
    app.state::<WorkspaceGrants>().record(&root);
    Ok(root)
}

/// At launch: load the recorded roots and re-grant them (see module docs).
pub(crate) fn restore_at_launch<R: Runtime>(app: &AppHandle<R>) {
    match crate::app_paths::app_data_dir(app) {
        Ok(dir) => restore_from(app, dir.join(GRANTS_FILE), LAUNCH_REGRANT_WAIT),
        // Nothing can be re-granted, and choices this session stay in memory.
        Err(e) => log::warn!("[workspace-grants] No app data directory: {e}"),
    }
}

/// [`restore_at_launch`] against an explicit file and wait, for tests.
pub(crate) fn restore_from<R: Runtime>(app: &AppHandle<R>, file: PathBuf, wait: Duration) {
    use tauri_plugin_fs::FsExt;
    if let Some(scope) = app.try_fs_scope() {
        if let Err(e) = scope.forbid_file(&file) {
            log::warn!("[workspace-grants] Could not fence {}: {e}", file.display());
        }
    }
    let grants = app.state::<WorkspaceGrants>();
    grants.load(file);
    grants.persist_if_missing();
    let roots = grants.roots();
    if roots.is_empty() {
        return;
    }
    let handle = app.clone();
    if !run_bounded(wait, move || regrant(&handle, &roots)) {
        log::warn!(
            "[workspace-grants] Re-granting recorded roots is still running; launch continues"
        );
    }
}

/// Re-grant each recorded root that still resolves to itself.
fn regrant<R: Runtime>(app: &AppHandle<R>, roots: &[String]) {
    for root in roots {
        match canonical_dir(Path::new(root)) {
            Ok(now) if now == *root => crate::fs_scope::allow_fs_read_dir(app, root),
            Ok(now) => {
                log::warn!("[workspace-grants] {root:?} now resolves to {now:?}; not granted")
            }
            Err(e) => log::info!("[workspace-grants] {root:?} unavailable: {}", e.message()),
        }
    }
}

/// Run `job` on its own thread and wait up to `wait` for it. Returns whether it
/// finished; if not, it keeps running and nothing waits for it.
fn run_bounded(wait: Duration, job: impl FnOnce() + Send + 'static) -> bool {
    let (done, finished) = std::sync::mpsc::channel();
    let spawned = std::thread::Builder::new()
        .name("workspace-regrant".into())
        .spawn(move || {
            job();
            let _ = done.send(());
        });
    if let Err(e) = spawned {
        log::error!("[workspace-grants] Could not start the re-grant thread: {e}");
        return false;
    }
    finished.recv_timeout(wait).is_ok()
}

#[cfg(test)]
#[path = "mod.test.rs"]
mod tests;
