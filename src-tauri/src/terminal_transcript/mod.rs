//! Exact terminal-to-transcript bindings, delivered by CLI SessionStart hooks.
//! Reads are bounded, canonical-root confined, and never touch PTY output.
use crate::command_error::CommandError;
use serde::Serialize;
use serde_json::{json, Value};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Runtime, State};
mod config;
use config::add_hook;
#[cfg(test)]
mod tests;
/// Serializes CLI config writes; a newer request supersedes queued older ones.
#[derive(Default)]
pub struct TranscriptConfigState(Arc<ConfigGate>);
#[derive(Default)]
struct ConfigGate {
    lock: Mutex<()>,
    revision: AtomicU64,
}
const LIMIT: u64 = 2 * 1024 * 1024;
fn valid_token(token: &str) -> bool {
    uuid::Uuid::parse_str(token).is_ok()
}
fn directory<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, CommandError> {
    app.path()
        .app_local_data_dir()
        .map(|p| p.join("terminal-transcripts"))
        .map_err(|e| CommandError::io(e.to_string()))
}
/// Allocate an opaque binding for this shell, even if preview is currently off.
#[tauri::command]
pub fn terminal_transcript_prepare() -> String {
    uuid::Uuid::new_v4().to_string()
}
/// Install additive CLI hooks, or deactivate installed hooks without deleting user config.
#[tauri::command]
pub async fn terminal_transcript_configure<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, TranscriptConfigState>,
    enabled: bool,
) -> Result<(), CommandError> {
    let root = directory(&app)?;
    let gate = Arc::clone(&state.0);
    let generation = gate.revision.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .lock
            .lock()
            .map_err(|e| CommandError::internal(e.to_string()))?;
        if generation != gate.revision.load(Ordering::SeqCst) {
            return Ok(());
        }
        let (claude, codex) = cli_roots()?;
        configure(&root, enabled, &claude, &codex)
    })
    .await
    .map_err(|e| CommandError::internal(e.to_string()))?
}
fn configure(root: &Path, enabled: bool, claude: &Path, codex: &Path) -> Result<(), CommandError> {
    std::fs::create_dir_all(root).map_err(|e| CommandError::io(e.to_string()))?;
    let marker = root.join("enabled");
    if !enabled {
        if marker.exists() {
            std::fs::remove_file(marker).map_err(|e| CommandError::io(e.to_string()))?;
        }
        return prune_bindings(root);
    }
    let script = root.join("terminal-transcript-hook.cjs");
    std::fs::write(
        &script,
        include_str!("../../resources/terminal-transcript-hook.cjs"),
    )
    .map_err(|e| CommandError::io(e.to_string()))?;
    let command = if cfg!(windows) {
        format!("node \"{}\"", script.display())
    } else {
        format!("node '{}'", script.to_string_lossy().replace('\'', "'\\''"))
    };
    // Parse and validate BOTH before writing either, so malformed config is preserved.
    let paths = [claude.join("settings.json"), codex.join("hooks.json")];
    let mut configs = Vec::new();
    for path in &paths {
        let mut value: Value = if path.exists() {
            serde_json::from_slice(
                &std::fs::read(path).map_err(|e| CommandError::io(e.to_string()))?,
            )
            .map_err(|e| CommandError::invalid_input(e.to_string()))?
        } else {
            json!({})
        };
        if add_hook(&mut value, &command)? {
            configs.push((path, value));
        }
    }
    for (path, value) in configs {
        std::fs::create_dir_all(path.parent().unwrap())
            .map_err(|e| CommandError::io(e.to_string()))?;
        config::write_atomic(
            path,
            &serde_json::to_vec_pretty(&value)
                .map_err(|e| CommandError::internal(e.to_string()))?,
        )?;
    }
    std::fs::write(marker, b"enabled").map_err(|e| CommandError::io(e.to_string()))?;
    Ok(())
}
/// The Claude and Codex config roots, honouring their override variables.
fn cli_roots() -> Result<(PathBuf, PathBuf), CommandError> {
    let home =
        dirs::home_dir().ok_or_else(|| CommandError::not_found("Home directory unavailable"))?;
    Ok((
        config_root("CLAUDE_CONFIG_DIR", home.join(".claude")),
        config_root("CODEX_HOME", home.join(".codex")),
    ))
}
fn config_root(key: &str, fallback: PathBuf) -> PathBuf {
    std::env::var_os(key)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or(fallback)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSnapshot {
    revision: String,
    data: Option<String>,
}
/// A missing binding is a normal waiting state. Caller supplies no filesystem path.
#[tauri::command]
pub async fn terminal_transcript_read<R: Runtime>(
    app: AppHandle<R>,
    token: String,
    revision: Option<String>,
) -> Result<Option<TranscriptSnapshot>, CommandError> {
    if !valid_token(&token) {
        return Err(CommandError::invalid_input("Invalid transcript token"));
    }
    let root = directory(&app)?;
    let (claude, codex) = cli_roots()?;
    let roots = [claude.join("projects"), codex.join("sessions")];
    tauri::async_runtime::spawn_blocking(move || {
        read_snapshot(&root, &roots, &token, revision.as_deref())
    })
    .await
    .map_err(|e| CommandError::internal(e.to_string()))?
}
/// Delete a shell's binding when its session closes or its shell is replaced.
#[tauri::command]
pub async fn terminal_transcript_forget<R: Runtime>(
    app: AppHandle<R>,
    token: String,
) -> Result<(), CommandError> {
    if !valid_token(&token) {
        return Err(CommandError::invalid_input("Invalid transcript token"));
    }
    let root = directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || remove_binding(&root, &token))
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?
}
fn remove_binding(root: &Path, token: &str) -> Result<(), CommandError> {
    match std::fs::remove_file(root.join(format!("{token}.json"))) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(CommandError::io(e.to_string())),
        _ => Ok(()),
    }
}
/// Disabling drops every binding; enabled shells re-bind on their next CLI start.
fn prune_bindings(root: &Path) -> Result<(), CommandError> {
    let entries = std::fs::read_dir(root).map_err(|e| CommandError::io(e.to_string()))?;
    for entry in entries {
        let path = entry.map_err(|e| CommandError::io(e.to_string()))?.path();
        let is_binding = path.extension().is_some_and(|ext| ext == "json")
            && path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .is_some_and(valid_token);
        if is_binding {
            std::fs::remove_file(&path).map_err(|e| CommandError::io(e.to_string()))?;
        }
    }
    Ok(())
}
fn allowed_path(path: &Path, roots: &[PathBuf]) -> bool {
    path.extension().is_some_and(|ext| ext == "jsonl")
        && roots
            .iter()
            .any(|root| root.canonicalize().is_ok_and(|root| path.starts_with(root)))
}
fn read_snapshot(
    root: &Path,
    roots: &[PathBuf],
    token: &str,
    previous: Option<&str>,
) -> Result<Option<TranscriptSnapshot>, CommandError> {
    if !root.join("enabled").exists() {
        return Ok(None);
    }
    let binding = root.join(format!("{token}.json"));
    let bytes = match std::fs::read(&binding) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(CommandError::io(e.to_string())),
    };
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|e| CommandError::invalid_input(e.to_string()))?;
    let path = value["path"]
        .as_str()
        .ok_or_else(|| CommandError::invalid_input("Missing transcript path"))?;
    // The CLI announces its transcript before writing it: absent is still waiting.
    let path = match Path::new(path).canonicalize() {
        Ok(path) => path,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(CommandError::io(e.to_string())),
    };
    if !allowed_path(&path, roots) {
        return Err(CommandError::permission_denied(
            "Transcript outside CLI session directories",
        ));
    }
    let meta = std::fs::metadata(&path).map_err(|e| CommandError::io(e.to_string()))?;
    let revision = format!(
        "{}:{:?}:{}:{:?}",
        path.display(),
        value["sessionId"],
        meta.len(),
        meta.modified()
    );
    if Some(revision.as_str()) == previous {
        return Ok(Some(TranscriptSnapshot {
            revision,
            data: None,
        }));
    }
    Ok(Some(TranscriptSnapshot {
        revision,
        data: Some(read_tail(&path, LIMIT)?),
    }))
}
fn read_tail(path: &Path, limit: u64) -> Result<String, CommandError> {
    let mut file = std::fs::File::open(path).map_err(|e| CommandError::io(e.to_string()))?;
    let meta = file
        .metadata()
        .map_err(|e| CommandError::io(e.to_string()))?;
    if !meta.is_file() {
        return Err(CommandError::invalid_input(
            "Transcript must be a regular file",
        ));
    }
    let start = meta.len().saturating_sub(limit);
    let mut at_boundary = start == 0;
    if start > 0 {
        file.seek(SeekFrom::Start(start - 1))
            .map_err(|e| CommandError::io(e.to_string()))?;
        let mut preceding = [0u8; 1];
        file.read_exact(&mut preceding)
            .map_err(|e| CommandError::io(e.to_string()))?;
        at_boundary = preceding[0] == b'\n';
    }
    file.seek(SeekFrom::Start(start))
        .map_err(|e| CommandError::io(e.to_string()))?;
    let mut bytes = Vec::new();
    file.take(limit)
        .read_to_end(&mut bytes)
        .map_err(|e| CommandError::io(e.to_string()))?;
    if !at_boundary {
        if let Some(i) = bytes.iter().position(|b| *b == b'\n') {
            bytes.drain(..=i);
        } else {
            bytes.clear();
        }
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
