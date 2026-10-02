//! Unit tests for the workflow expression resolver (see `expressions.rs`).
//! Split into a sibling file (included via `#[path]`) to keep the production
//! file under the size gate.

use super::*;

fn outputs(pairs: &[(&str, &[(&str, &str)])]) -> WorkflowOutputs {
    pairs
        .iter()
        .map(|(id, fields)| {
            (
                (*id).to_string(),
                fields
                    .iter()
                    .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
                    .collect(),
            )
        })
        .collect()
}

fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect()
}

// === ${{ steps.X.outputs.Y }} ===

#[test]
fn resolves_steps_outputs_field() {
    let o = outputs(&[("first", &[("text", "ok"), ("score", "9")])]);
    let r = resolve("${{ steps.first.outputs.score }}", &o, &HashMap::new()).unwrap();
    assert_eq!(r, "9");
}

#[test]
fn unknown_step_errors() {
    let r = resolve(
        "${{ steps.ghost.outputs.text }}",
        &HashMap::new(),
        &HashMap::new(),
    );
    assert!(matches!(r, Err(ExprError::UnknownStep(_))));
}

#[test]
fn missing_field_errors() {
    let o = outputs(&[("first", &[("text", "ok")])]);
    let r = resolve("${{ steps.first.outputs.score }}", &o, &HashMap::new());
    assert!(
        matches!(r, Err(ExprError::MissingField { ref step, ref field }) if step == "first" && field == "score")
    );
}

// === ${{ steps.X.output }} sugar ===

#[test]
fn resolves_steps_output_sugar() {
    let o = outputs(&[("first", &[("text", "default")])]);
    let r = resolve("${{ steps.first.output }}", &o, &HashMap::new()).unwrap();
    assert_eq!(r, "default");
}

// === ${{ env.NAME }} ===

#[test]
fn resolves_env() {
    let r = resolve(
        "${{ env.HOME }}",
        &HashMap::new(),
        &env(&[("HOME", "/home/x")]),
    )
    .unwrap();
    assert_eq!(r, "/home/x");
}

#[test]
fn unknown_env_errors() {
    let r = resolve("${{ env.MISSING }}", &HashMap::new(), &HashMap::new());
    assert!(matches!(r, Err(ExprError::UnknownEnv(_))));
}

// === legacy ${VAR} ===

#[test]
fn legacy_env_var_still_works() {
    let r = resolve(
        "path/${HOME}/file",
        &HashMap::new(),
        &env(&[("HOME", "/u")]),
    )
    .unwrap();
    assert_eq!(r, "path//u/file");
}

#[test]
fn legacy_env_alongside_expr() {
    // Both forms in the same value.
    let r = resolve(
        "${HOME}/${{ env.NAME }}",
        &HashMap::new(),
        &env(&[("HOME", "/u"), ("NAME", "alice")]),
    )
    .unwrap();
    assert_eq!(r, "/u/alice");
}

// === bare stepId.output (legacy) ===

#[test]
fn bare_alias_resolves_to_text() {
    let o = outputs(&[("read", &[("text", "file body")])]);
    let r = resolve("read.output", &o, &HashMap::new()).unwrap();
    assert_eq!(r, "file body");
}

#[test]
fn bare_alias_unknown_step_errors() {
    let r = resolve("ghost.output", &HashMap::new(), &HashMap::new());
    assert!(matches!(r, Err(ExprError::UnknownStep(_))));
}

#[test]
fn bare_alias_only_matches_whole_value() {
    // `prefix read.output` — not a whole-string alias; passes through.
    let o = outputs(&[("read", &[("text", "x")])]);
    let r = resolve("prefix read.output", &o, &HashMap::new()).unwrap();
    assert_eq!(r, "prefix read.output"); // not substituted
}

// === interleaved literal + expr ===

#[test]
fn literal_text_passes_through() {
    let r = resolve("Hello, world!", &HashMap::new(), &HashMap::new()).unwrap();
    assert_eq!(r, "Hello, world!");
}

#[test]
fn multiple_expressions_in_one_value() {
    let o = outputs(&[("a", &[("text", "alpha")]), ("b", &[("text", "beta")])]);
    let r = resolve(
        "${{ steps.a.output }} + ${{ steps.b.output }}",
        &o,
        &HashMap::new(),
    )
    .unwrap();
    assert_eq!(r, "alpha + beta");
}

#[test]
fn unsupported_expression_errors() {
    let r = resolve("${{ secrets.API_KEY }}", &HashMap::new(), &HashMap::new());
    assert!(matches!(r, Err(ExprError::Unsupported(_))));
}

// === regression: $\{NAME} inside ${{ }} doesn't false-match ===

#[test]
fn env_regex_does_not_collide_with_expr_braces() {
    let o = outputs(&[("a", &[("text", "ok")])]);
    // The body of ${{ }} contains `.` which `\w+` won't match — verify
    // the env regex doesn't try to substitute pieces of the expression.
    let r = resolve(
        "${{ steps.a.output }} ${LEGIT}",
        &o,
        &env(&[("LEGIT", "yes")]),
    )
    .unwrap();
    assert_eq!(r, "ok yes");
}
