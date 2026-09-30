//! Additive, idempotent hook configuration. Invalid user config is never replaced.
use crate::command_error::CommandError;
use serde_json::{json, Value};
use std::path::Path;
/// Returns whether the config changed — callers write the file only then, so an
/// already-configured CLI file is never rewritten (or reformatted).
pub(super) fn add_hook(config: &mut Value, command: &str) -> Result<bool, CommandError> {
    let object = config
        .as_object_mut()
        .ok_or_else(|| CommandError::invalid_input("CLI configuration must be an object"))?;
    let hooks = object
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| CommandError::invalid_input("CLI hooks must be an object"))?;
    let groups = hooks
        .entry("SessionStart")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .ok_or_else(|| CommandError::invalid_input("SessionStart hooks must be an array"))?;
    if groups.iter().any(|group| {
        group["hooks"]
            .as_array()
            .is_some_and(|hooks| hooks.iter().any(|hook| hook["command"] == command))
    }) {
        return Ok(false);
    }
    groups.push(json!({"hooks":[{"type":"command", "command": command, "timeout": 5}]}));
    Ok(true)
}
pub(super) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|e| CommandError::io(e.to_string()))?;
    {
        use std::io::Write;
        file.write_all(bytes)
            .map_err(|e| CommandError::io(e.to_string()))?;
    }
    if let Ok(meta) = std::fs::metadata(path) {
        std::fs::set_permissions(&temporary, meta.permissions())
            .map_err(|e| CommandError::io(e.to_string()))?;
    }
    drop(file);
    std::fs::rename(&temporary, path).map_err(|e| {
        let _ = std::fs::remove_file(&temporary);
        CommandError::io(e.to_string())
    })
}
