//! Tests for `registry.rs` — the persisted list of user-chosen workspace roots.
//!
//! WI-LX1.1 — the list is the ONLY thing `allow_workspace_access` re-grants
//! from, so what it admits, how it matches, and what it refuses to parse are the
//! boundary itself.

use super::{GrantList, FORMAT_MARKER, MAX_ROOTS};

fn list_of(roots: &[&str]) -> GrantList {
    let mut list = GrantList::default();
    // `record` puts the newest first, so feed oldest first to get `roots` order.
    for root in roots.iter().rev() {
        list.record(root);
    }
    list
}

#[test]
fn a_listed_root_and_everything_below_it_is_covered() {
    let list = list_of(&["/work/proj"]);
    assert!(list.covers("/work/proj"));
    assert!(list.covers("/work/proj/docs/deep"));
}

#[test]
fn a_sibling_sharing_a_name_prefix_is_not_covered() {
    // Component-wise, not string-prefix: `/work/proj-evil` starts with the
    // STRING `/work/proj` and is a different folder.
    let list = list_of(&["/work/proj"]);
    assert!(!list.covers("/work/proj-evil"));
    assert!(!list.covers("/work/pro"));
}

#[test]
fn an_ancestor_of_a_listed_root_is_not_covered() {
    // Granting `/work` because `/work/proj` was chosen would hand over every
    // sibling of the folder the user actually picked.
    let list = list_of(&["/work/proj"]);
    assert!(!list.covers("/work"));
    assert!(!list.covers("/"));
}

#[test]
fn an_empty_list_covers_nothing() {
    let list = GrantList::default();
    assert!(!list.covers("/"));
    assert!(!list.covers("/work/proj"));
}

#[test]
fn a_relative_candidate_is_never_covered() {
    // Relative names resolve against a working directory nothing here chose.
    let list = list_of(&["/work/proj"]);
    assert!(!list.covers("work/proj"));
    assert!(!list.covers(""));
}

#[test]
fn record_puts_the_newest_first_and_does_not_duplicate() {
    let mut list = GrantList::default();
    assert!(list.record("/a"));
    assert!(list.record("/b"));
    assert!(list.record("/a"), "re-choosing moves an entry to the front");
    assert_eq!(list.roots(), ["/a", "/b"]);
    assert!(
        !list.record("/a"),
        "already first: nothing changed, nothing to persist"
    );
}

#[test]
fn record_refuses_a_relative_or_empty_root() {
    let mut list = GrantList::default();
    assert!(!list.record("relative/dir"));
    assert!(!list.record(""));
    assert!(list.roots().is_empty());
}

#[test]
fn the_list_is_capped_and_drops_the_oldest() {
    let mut list = GrantList::default();
    for i in 0..(MAX_ROOTS + 5) {
        list.record(&format!("/r/{i}"));
    }
    assert_eq!(list.roots().len(), MAX_ROOTS);
    assert_eq!(
        list.roots()[0],
        format!("/r/{}", MAX_ROOTS + 4),
        "newest kept"
    );
    assert!(!list.covers("/r/0"), "oldest evicted");
}

#[test]
fn bytes_round_trip() {
    let list = list_of(&["/a", "/b/c"]);
    let parsed = GrantList::parse(&list.to_bytes()).expect("own output parses");
    assert_eq!(parsed, list);
}

#[test]
fn parse_drops_entries_it_cannot_vouch_for() {
    let raw =
        serde_json::json!([FORMAT_MARKER, "/ok", "relative", "", "/ok", 7, "/also"]).to_string();
    let raw = raw.as_bytes();
    let parsed = GrantList::parse(raw).expect("valid envelope");
    assert_eq!(parsed.roots(), ["/ok", "/also"]);
}

#[test]
fn parse_caps_an_oversized_file() {
    let roots: Vec<String> = (0..(MAX_ROOTS * 2)).map(|i| format!("/r/{i}")).collect();
    let mut file = vec![serde_json::json!(FORMAT_MARKER)];
    file.extend(roots.into_iter().map(serde_json::Value::from));
    let raw = serde_json::Value::Array(file).to_string();
    let parsed = GrantList::parse(raw.as_bytes()).expect("valid envelope");
    assert_eq!(parsed.roots().len(), MAX_ROOTS);
    assert_eq!(parsed.roots()[0], "/r/0", "file order is newest first");
}

#[test]
fn parse_refuses_what_it_cannot_interpret() {
    // Failing closed means NO grants: a list this build cannot read must not be
    // half-read into a list it then trusts.
    for raw in [
        &b"not json"[..],
        br#"["vmark-workspace-grants/2","/a"]"#,
        br#"["/a","/b"]"#,
        br#"[]"#,
        br#"{"version":1,"roots":["/a"]}"#,
        br#""vmark-workspace-grants/1""#,
    ] {
        assert!(
            GrantList::parse(raw).is_err(),
            "should refuse {:?}",
            String::from_utf8_lossy(raw)
        );
    }
}

/// The store plugin (`store:default`, document windows) resolves its file name
/// against the app data directory — `load("workspace-grants.json")` lands on
/// this list — and absolute names anywhere. It can only ever write its cache,
/// a `HashMap<String, JsonValue>`, through `serde_json::to_vec_pretty`: a JSON
/// OBJECT. The list is a top-level ARRAY so that nothing the store can write
/// parses as one. This replays the plugin's own serializer with the payload a
/// script would want.
#[test]
fn nothing_the_store_plugin_can_write_parses_as_a_list() {
    let mut cache: std::collections::HashMap<String, serde_json::Value> = Default::default();
    cache.insert("version".into(), serde_json::json!(1));
    cache.insert("roots".into(), serde_json::json!(["/"]));
    cache.insert("0".into(), serde_json::json!(FORMAT_MARKER));
    let written = serde_json::to_vec_pretty(&cache).expect("the plugin's default_serialize");
    assert!(GrantList::parse(&written).is_err());
    let empty: std::collections::HashMap<String, serde_json::Value> = Default::default();
    assert!(GrantList::parse(&serde_json::to_vec_pretty(&empty).unwrap()).is_err());
}

#[test]
fn the_file_is_an_array_that_starts_with_the_marker() {
    let bytes = list_of(&["/a"]).to_bytes();
    let value: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
    assert_eq!(value, serde_json::json!([FORMAT_MARKER, "/a"]));
}

#[test]
fn absorb_keeps_this_session_first_and_the_file_behind_it() {
    // A Finder open can land before the file is loaded; loading must not drop it.
    let mut session = list_of(&["/new"]);
    session.absorb(list_of(&["/old", "/new"]));
    assert_eq!(session.roots(), ["/new", "/old"]);
}
