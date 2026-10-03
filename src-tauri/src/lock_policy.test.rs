// WI-RA7C.1 — a poisoned lock is recovered or refused loudly, never dropped in
// silence: the refusal helper logs, and a source-scan gate fails on every
// shape that turns a `PoisonError` into "nothing to do".

use super::lock_or_refuse;
use crate::source_scan::{production_files, Production};
use std::sync::{Mutex, PoisonError};

/// Poison `mutex`: a thread panics while holding it. Shared by every test
/// that proves a site survives a poisoned lock.
pub(crate) fn poison<T: Send>(mutex: &Mutex<T>) {
    let panicked = std::thread::scope(|scope| {
        scope
            .spawn(|| {
                let _guard = mutex.lock().unwrap_or_else(PoisonError::into_inner);
                panic!("poisoning the mutex (expected by this test)");
            })
            .join()
    });
    assert!(
        panicked.is_err() && mutex.is_poisoned(),
        "premise: poisoned"
    );
}

/// A fresh mutex holding `value`, already poisoned.
pub(crate) fn poisoned<T: Send>(value: T) -> Mutex<T> {
    let mutex = Mutex::new(value);
    poison(&mutex);
    mutex
}

#[test]
fn a_healthy_lock_is_handed_out() {
    let mutex = Mutex::new(7);
    assert_eq!(lock_or_refuse(&mutex, "a counter").map(|g| *g), Some(7));
}

#[test]
fn a_poisoned_lock_is_refused_and_the_refusal_is_logged() {
    let mutex = poisoned(7);
    let mut refused = false;
    let lines = crate::peer_text::log_capture::captured_logs(|| {
        refused = lock_or_refuse(&mutex, "the test registry").is_none();
    });
    assert!(refused);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert!(lines[0].contains("the test registry") && lines[0].contains("poisoned"));
}

// ── The gate ────────────────────────────────────────────────────────────────

/// Byte offsets in `code` (already blanked by `source_scan`) where a lock's
/// `Result` is consumed in a way that drops the poison silently.
fn silent_lock_sites(code: &str) -> Vec<usize> {
    let call = r"\.\s*(?:lock|read|write)\s*\(\s*\)";
    let shapes = [
        // `if let Ok(g) = m.lock()`, `while let Ok(..)`, `let Ok(g) = m.lock() … else`
        format!(r"\blet\s+Ok\s*\([^=]*?\)\s*=\s*[^;{{]*?{call}"),
        // `match m.lock() { … }`
        format!(r"\bmatch\s+[^{{;]*?{call}[^{{;]*\{{"),
        // `m.lock().ok()`, `.map(..)`, `.unwrap_or(..)` … — poison becomes a default
        format!(
            r"{call}\s*\.\s*(?:ok|err|map|map_or|map_or_else|and_then|is_ok|is_err|unwrap_or|unwrap_or_default)\s*\("
        ),
    ];
    let mut sites: Vec<usize> = shapes
        .iter()
        .flat_map(|shape| {
            regex::Regex::new(shape)
                .expect("gate regex")
                .find_iter(code)
                .map(|m| m.start())
                .collect::<Vec<_>>()
        })
        .collect();
    // `let r = m.lock();` and then `match r` / `if let Ok(..) = r`.
    let held = regex::Regex::new(&format!(r"\blet\s+(?:mut\s+)?(\w+)\s*=\s*[^;]*?{call}\s*;"))
        .expect("held regex");
    for found in held.captures_iter(code) {
        let name = regex::escape(&found[1]);
        let after = &code[found.get(0).expect("match").end()..];
        let used = regex::Regex::new(&format!(
            r"^\s*(?:match\s+{name}\b|if\s+let\s+(?:Ok|Err)\s*\([^)]*\)\s*=\s*{name}\b)"
        ))
        .expect("use regex");
        if used.is_match(after) {
            sites.push(found.get(0).expect("match").start());
        }
    }
    sites.sort_unstable();
    sites.dedup();
    sites
}

fn silent(source: &str) -> usize {
    let code = crate::source_scan::blank_test_items(
        &crate::source_scan::blank_comments_and_literals(source),
    );
    silent_lock_sites(&code).len()
}

#[test]
fn the_gate_sees_every_silent_shape() {
    for source in [
        "if let Ok(mut g) = CACHE.lock() { *g = 1; }",
        "let Ok(reg) = state.registry.lock() else { return false; };",
        "let Ok(policy) = state.ai_policy.lock().map(|p| *p) else { return; };",
        "while let Ok(g) = m.lock() { break; }",
        "match cell().write() { Ok(mut g) => *g = v, Err(e) => log::error!(\"{e}\") }",
        "match state.registry.lock() {\n Ok(reg) => reg,\n Err(_) => return None,\n }",
        "let x = SNAPSHOT.lock().ok().and_then(|s| s.get(0).cloned());",
        "let n = self.inner.lock().map(|r| r.len()).unwrap_or(0);",
        "let held = m\n    .lock()\n    .is_ok();",
        "let locked = state.registry.lock();\n match locked { Ok(r) => r, Err(_) => return }",
    ] {
        assert!(silent(source) >= 1, "not flagged: {source}");
    }
}

#[test]
fn the_gate_accepts_recovery_loud_refusal_and_non_lock_code() {
    for source in [
        "let g = CACHE.lock().unwrap_or_else(PoisonError::into_inner);",
        "let g = CACHE.lock().unwrap_or_else(|p| p.into_inner());",
        "let reg = state.registry.lock().map_err(lock_failure)?;",
        "let policy = state.ai_policy.lock().map_err(lock_failure).map(|p| *p)?;",
        "let guard = bridge.lock().await;",
        "let sessions = state.sessions.read().await;",
        "let Some(reg) = lock_or_refuse(&state.registry, \"browser registry\") else { return; };",
        "if let Ok(n) = file.read(&mut buf) { total += n; }",
        "match &*self.lock_state() { State::Gone(c) => *c, _ => 0 }",
        "// if let Ok(g) = CACHE.lock() {}",
        "let s = \"if let Ok(g) = CACHE.lock() {}\";",
        "#[cfg(test)]\nfn probe() -> bool { CACHE.lock().is_ok() }",
    ] {
        assert_eq!(silent(source), 0, "flagged: {source}");
    }
}

#[test]
fn no_production_code_drops_a_poisoned_lock_silently() {
    let files: Vec<Production> = production_files();
    let offenders: Vec<String> = files
        .iter()
        .flat_map(|file| {
            silent_lock_sites(&file.code)
                .into_iter()
                .map(|at| file.locate(at))
                .collect::<Vec<_>>()
        })
        .collect();
    assert!(
        offenders.is_empty(),
        "{} site(s) drop a poisoned lock silently — recover with \
         `unwrap_or_else(PoisonError::into_inner)` or refuse loudly with \
         `lock_policy::lock_or_refuse` / `map_err` (see lock_policy.rs):\n{}",
        offenders.len(),
        offenders.join("\n")
    );
}
