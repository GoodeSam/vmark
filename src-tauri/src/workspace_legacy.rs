//! Migration from the in-workspace `.vmark` config formats.
//!
//! Purpose: releases up to 0.4.17 kept a workspace's config inside the workspace
//! itself — first as a plain `.vmark` file, then as
//! `.vmark/vmark.code-workspace`. Config now lives in app data
//! (`workspace.rs`); this module reads the two old shapes once, so the first
//! open after an upgrade keeps the user's excludes, tabs, AI settings and
//! identity, and removes the old file once the new one is durably written.
//!
//! Sunset: delete this file, its `mod` line and the migration branch of
//! `read_workspace_config` once no supported upgrade path starts below 0.4.18.
//! Nothing else depends on it.
//!
//! A `#[path]` child of workspace.rs.

use super::{WorkspaceConfig, WorkspaceIdentity};
use serde::Deserialize;
use std::fs;
use std::path::Path;

/// VS Code-compatible workspace file — legacy `.vmark/vmark.code-workspace`.
#[derive(Debug, Deserialize)]
struct LegacyWorkspaceFile {
    #[serde(default)]
    settings: LegacyWorkspaceSettings,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyWorkspaceSettings {
    #[serde(rename = "vmark.excludeFolders", default)]
    exclude_folders: Vec<String>,
    #[serde(rename = "vmark.showHiddenFiles", default)]
    show_hidden_files: bool,
    #[serde(rename = "vmark.lastOpenTabs", default)]
    last_open_tabs: Vec<String>,
    #[serde(rename = "vmark.ai", default)]
    ai: Option<serde_json::Value>,
    #[serde(rename = "vmark.identity", default)]
    identity: Option<WorkspaceIdentity>,
}

/// Ancient legacy workspace configuration (plain `.vmark` file).
#[derive(Debug, Deserialize)]
struct AncientLegacyConfig {
    #[serde(default)]
    version: u32,
    #[serde(rename = "excludeFolders", default)]
    exclude_folders: Vec<String>,
    #[serde(rename = "lastOpenTabs", default)]
    last_open_tabs: Vec<String>,
    #[serde(default)]
    ai: Option<serde_json::Value>,
}

/// Strip `.vmark` from a legacy exclude list — the directory no longer exists.
pub(super) fn clean_excludes(folders: Vec<String>) -> Vec<String> {
    folders.into_iter().filter(|f| f != ".vmark").collect()
}

/// Try to read config from legacy `.vmark/` directory or ancient `.vmark` file.
/// Returns `Ok(Some(config))` if found, `Ok(None)` if no legacy exists. Both branches
/// spread `WorkspaceConfig::default()` and name only the fields the legacy format
/// carried, so a field added later cannot be migrated inconsistently between them.
pub(super) fn migrate_from_legacy(root_path: &str) -> Result<Option<WorkspaceConfig>, String> {
    let root = Path::new(root_path);
    let dot_vmark = root.join(".vmark");

    // 1. Try .vmark/vmark.code-workspace (directory format)
    if dot_vmark.is_dir() {
        let ws_file_path = dot_vmark.join("vmark.code-workspace");
        if ws_file_path.exists() {
            let content = fs::read_to_string(&ws_file_path)
                .map_err(|e| format!("Failed to read legacy workspace file: {e}"))?;
            let ws: LegacyWorkspaceFile = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse legacy workspace file: {e}"))?;

            return Ok(Some(WorkspaceConfig {
                exclude_folders: clean_excludes(ws.settings.exclude_folders),
                show_hidden_files: ws.settings.show_hidden_files,
                last_open_tabs: ws.settings.last_open_tabs,
                ai: ws.settings.ai,
                identity: ws.settings.identity,
                ..WorkspaceConfig::default()
            }));
        }
    }

    // 2. Try .vmark as a plain file (ancient format)
    if dot_vmark.is_file() {
        let content = fs::read_to_string(&dot_vmark)
            .map_err(|e| format!("Failed to read ancient .vmark: {e}"))?;
        let ancient: AncientLegacyConfig = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse ancient .vmark: {e}"))?;

        return Ok(Some(WorkspaceConfig {
            // A file predating the `version` key deserializes to 0 — a schema version
            // we never emitted. Clamp to the v1 it is, rather than persisting 0.
            version: ancient.version.max(1),
            exclude_folders: clean_excludes(ancient.exclude_folders),
            last_open_tabs: ancient.last_open_tabs,
            ai: ancient.ai,
            ..WorkspaceConfig::default()
        }));
    }

    Ok(None)
}

/// Best-effort cleanup of legacy `.vmark/` in a workspace root.
/// Removes workspace file, then tries to remove the directory (only if empty).
pub(super) fn cleanup_old_vmark(root_path: &str) {
    let root = Path::new(root_path);
    let dot_vmark = root.join(".vmark");

    if dot_vmark.is_dir() {
        // Remove known file
        let _ = fs::remove_file(dot_vmark.join("vmark.code-workspace"));
        // Try rmdir (fails if not empty — that's fine)
        let _ = fs::remove_dir(&dot_vmark);
    } else if dot_vmark.is_file() {
        let _ = fs::remove_file(&dot_vmark);
    }
}
