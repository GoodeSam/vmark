// WI-RA5.3 — the record phase, split out of the runner: the copy of a step's
// output sent to the frontend is cut on a character boundary.
//
//! Unit tests for `step_record.rs`. What a recorded step does to the run —
//! outputs, events, the first failure — is exercised through whole runs in
//! `runner_flow.test.rs`.

use super::*;

#[test]
fn test_truncate_utf8_safe_ascii() {
    let s = "hello world";
    assert_eq!(truncate_utf8_safe(s, 100), s);
}

#[test]
fn test_truncate_utf8_safe_cjk() {
    let s = "你好世界测试数据";
    // Each CJK char is 3 bytes. 8 chars = 24 bytes.
    let result = truncate_utf8_safe(s, 10);
    // Should truncate at char boundary, not panic
    assert!(result.contains("..."));
    assert!(!result.is_empty());
}
