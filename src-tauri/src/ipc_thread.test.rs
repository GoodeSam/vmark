// WI-RA11.5 — commands that touch the disk, the user database or other
// processes must not run on the IPC thread. A non-`async` Tauri command runs
// inline on the thread that delivered the message, so a slow disk, a network
// home directory or a stuck `where.exe` stalls every IPC call behind it.
//
// Source scan: each named command must either be an `async fn` that hands its
// work to the blocking pool (directly or through a helper that does), or a sync
// fn registered as `#[tauri::command(async)]`, which Tauri runs on its async
// runtime instead of the IPC thread (used where other Rust code calls the
// function synchronously from its own blocking task).

use std::path::Path;

/// (file, command) pairs that do blocking work.
const BLOCKING_COMMANDS: &[(&str, &str)] = &[
    ("workspace.rs", "read_workspace_config"),
    ("workspace.rs", "write_workspace_config"),
    ("watcher.rs", "start_watching"),
    ("shell_env.rs", "get_login_shell_path"),
    ("shell_env.rs", "get_default_shell"),
    ("shell_env.rs", "list_available_shells"),
];

/// Calls that move work onto the blocking pool.
const OFF_THREAD: &[&str] = &["spawn_blocking(", "config_io("];

fn source(file: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join(file);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

/// The declaration of `fn name` up to the brace that closes its body.
fn function(source: &str, name: &str) -> Option<String> {
    let start = source.find(&format!("fn {name}"))?;
    let decl_start = source[..start].rfind('\n').map_or(0, |i| i + 1);
    let open = start + source[start..].find('{')?;
    let mut depth = 0usize;
    for (i, ch) in source[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(source[decl_start..=open + i].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

/// The `#[tauri::command…]` attribute line directly above `fn name`.
fn attribute_of<'a>(source: &'a str, name: &str) -> Option<&'a str> {
    let start = source.find(&format!("fn {name}"))?;
    let decl_start = source[..start].rfind('\n').map_or(0, |i| i + 1);
    source[..decl_start]
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(str::trim)
        .filter(|line| line.starts_with("#[tauri::command"))
}

#[test]
fn the_attribute_reader_sees_the_line_above_the_fn() {
    let text =
        "/// doc\n#[tauri::command(async)]\npub fn a() {}\n#[tauri::command]\npub fn b() {}\n";
    assert_eq!(attribute_of(text, "a"), Some("#[tauri::command(async)]"));
    assert_eq!(attribute_of(text, "b"), Some("#[tauri::command]"));
}

#[test]
fn blocking_commands_are_async_and_leave_the_ipc_thread() {
    let mut offenders = Vec::new();
    for (file, name) in BLOCKING_COMMANDS {
        let text = source(file);
        let body = function(&text, name).unwrap_or_else(|| panic!("{file}: no fn {name}"));
        let is_async = body
            .lines()
            .next()
            .is_some_and(|line| line.contains("async fn"));
        let off_thread = OFF_THREAD.iter().any(|call| body.contains(call));
        if !(is_async && off_thread)
            && attribute_of(&text, name) != Some("#[tauri::command(async)]")
        {
            offenders.push(format!("{file}::{name}"));
        }
    }
    assert!(
        offenders.is_empty(),
        "commands doing blocking work on the IPC thread: {offenders:?}"
    );
}

#[test]
fn the_workspace_config_helper_itself_uses_the_blocking_pool() {
    let text = source("workspace.rs");
    let helper = function(&text, "config_io").expect("workspace.rs: no fn config_io");
    assert!(helper.contains("spawn_blocking("));
}
