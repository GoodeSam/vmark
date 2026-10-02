// WI-RA11.3 — differential oracle: the search as it was before the walk and
// the per-file scan were split, kept only to prove the split changes no
// result. Deleted once the fixture test pins the same values on its own.

use super::fixture_tests::{fixture, Case, CASES};
use super::matching::{build_regex, matches_extensions, search_line, should_skip_dir};
use super::*;
use std::path::{Path, PathBuf};

/// The pre-split binary probe: its own open, one read, NUL in the first 8 KiB.
fn legacy_is_binary(path: &Path) -> bool {
    let Ok(file) = fs::File::open(path) else {
        return true;
    };
    use std::io::Read;
    let mut buf = [0u8; matching::BINARY_CHECK_LEN];
    let Ok(n) = (&file).read(&mut buf) else {
        return true;
    };
    buf[..n].contains(&0)
}

/// The pre-split `search_sync_with_deadline`, body unchanged.
fn legacy_search(case: &Case, root_dir: &Path, deadline: Instant) -> Result<SearchOutcome, String> {
    let searched = root_dir.join(case.subdir);
    let root_path = searched.to_str().unwrap();
    let query = case.query;
    let (case_sensitive, whole_word, use_regex, markdown_only) = (
        case.case_sensitive,
        case.whole_word,
        case.use_regex,
        case.markdown_only,
    );
    let extensions: Vec<String> = case.extensions.iter().map(|e| e.to_string()).collect();
    let exclude_folders: Vec<String> = case.exclude_folders.iter().map(|e| e.to_string()).collect();

    let re = build_regex(query, case_sensitive, whole_word, use_regex)?;
    let root = PathBuf::from(root_path);

    // Fail fast if root is unreadable (not silently return empty)
    if !root.is_dir() {
        return Err(format!("Workspace root is not a directory: {}", root_path));
    }
    fs::read_dir(&root).map_err(|e| format!("Cannot read workspace root: {}", e))?;

    let mut results: Vec<FileSearchResult> = Vec::new();
    let mut total_matches: usize = 0;
    let mut complete = true;

    // Walk directory tree
    let mut dirs_to_visit: Vec<PathBuf> = vec![root.clone()];

    while let Some(dir) = dirs_to_visit.pop() {
        if results.len() >= MAX_FILES || total_matches >= MAX_MATCHES || Instant::now() >= deadline
        {
            complete = false; // directories remain unvisited
            break;
        }

        let Ok(entries) = fs::read_dir(&dir) else {
            complete = false; // this directory's files were never seen
            continue;
        };

        let mut subdirs: Vec<PathBuf> = Vec::new();
        let mut files: Vec<PathBuf> = Vec::new();

        const DEADLINE_CHECK_STRIDE: usize = 256;

        for (i, entry) in entries.flatten().enumerate() {
            if i % DEADLINE_CHECK_STRIDE == 0 && Instant::now() >= deadline {
                complete = false; // remaining entries were never enumerated
                break;
            }
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };

            // Skip symlinks to prevent directory traversal outside workspace
            if path
                .symlink_metadata()
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false)
            {
                continue;
            }

            if path.is_dir() {
                if !should_skip_dir(name, &exclude_folders) {
                    subdirs.push(path);
                }
            } else if path.is_file() {
                // Skip hidden files
                if name.starts_with('.') {
                    continue;
                }
                if markdown_only && !matches_extensions(&path, &extensions) {
                    continue;
                }
                files.push(path);
            }
        }

        // Sort subdirs for deterministic ordering
        subdirs.sort();
        dirs_to_visit.extend(subdirs);

        // Search each file
        for file_path in files {
            if results.len() >= MAX_FILES
                || total_matches >= MAX_MATCHES
                || Instant::now() >= deadline
            {
                complete = false; // remaining files were never scanned
                break;
            }

            if legacy_is_binary(&file_path) {
                continue;
            }

            // Skip files larger than MAX_FILE_SIZE to prevent memory pressure
            if let Ok(meta) = fs::metadata(&file_path) {
                if meta.len() > MAX_FILE_SIZE {
                    complete = false; // an eligible file went unscanned
                    continue;
                }
            }

            // Re-check the deadline before an expensive blocking read.
            if Instant::now() >= deadline {
                complete = false;
                break;
            }

            let Ok(content) = fs::read_to_string(&file_path) else {
                complete = false; // an eligible file went unscanned
                continue;
            };

            let mut file_matches: Vec<LineMatch> = Vec::new();

            for (line_idx, line) in content.lines().enumerate() {
                if total_matches >= MAX_MATCHES {
                    complete = false; // remaining lines were never scanned
                    break;
                }
                // Cheap periodic deadline check on very long files.
                if line_idx % DEADLINE_CHECK_STRIDE == 0 && Instant::now() >= deadline {
                    complete = false;
                    break;
                }

                if let Some(mut line_match) = search_line(line, (line_idx + 1) as u32, &re) {
                    line_match
                        .match_ranges
                        .truncate(MAX_MATCHES - total_matches);
                    total_matches += line_match.match_ranges.len();
                    file_matches.push(line_match);
                }
            }

            if !file_matches.is_empty() {
                let relative = file_path
                    .strip_prefix(&root)
                    .unwrap_or(&file_path)
                    .to_string_lossy()
                    .replace('\\', "/");

                results.push(FileSearchResult {
                    path: file_path.to_string_lossy().to_string(),
                    relative_path: relative,
                    matches: file_matches,
                });
            }
        }
    }

    if Instant::now() >= deadline {
        complete = false;
    }

    Ok(SearchOutcome { results, complete })
}

/// The whole outcome, field for field and in order, as the frontend receives it.
fn wire(outcome: &Result<SearchOutcome, String>) -> serde_json::Value {
    match outcome {
        Ok(outcome) => serde_json::to_value(outcome).unwrap(),
        Err(message) => serde_json::json!({ "error": message }),
    }
}

#[test]
fn the_split_search_returns_exactly_what_the_original_did() {
    let dir = fixture();
    let far = Instant::now() + Duration::from_secs(60);
    for case in CASES {
        assert_eq!(
            wire(&case.run(dir.path(), far)),
            wire(&legacy_search(case, dir.path(), far)),
            "case {:?}",
            case.name
        );
    }
}

#[test]
fn the_split_search_agrees_with_the_original_on_a_spent_budget() {
    let dir = fixture();
    let past = Instant::now() - Duration::from_secs(1);
    for case in CASES {
        assert_eq!(
            wire(&case.run(dir.path(), past)),
            wire(&legacy_search(case, dir.path(), past)),
            "case {:?}",
            case.name
        );
    }
}

#[test]
fn the_split_search_agrees_with_the_original_on_the_caps() {
    // More matching files than MAX_FILES, and one file with more matching
    // lines than MAX_MATCHES: both caps cut the scan short.
    let dir = tempfile::tempdir().unwrap();
    for i in 0..(MAX_FILES + 10) {
        fs::write(dir.path().join(format!("f{i:03}.md")), "probe\n").unwrap();
    }
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(
        dir.path().join("sub").join("many.md"),
        "probe probe probe\n".repeat(MAX_MATCHES),
    )
    .unwrap();
    let far = Instant::now() + Duration::from_secs(60);
    let case = Case {
        name: "caps",
        subdir: "",
        query: "probe",
        case_sensitive: false,
        whole_word: false,
        use_regex: false,
        markdown_only: false,
        extensions: &[],
        exclude_folders: &[],
    };
    assert_eq!(
        wire(&case.run(dir.path(), far)),
        wire(&legacy_search(&case, dir.path(), far))
    );
    let only_sub = Case {
        subdir: "sub",
        ..case
    };
    assert_eq!(
        wire(&only_sub.run(dir.path(), far)),
        wire(&legacy_search(&only_sub, dir.path(), far))
    );
}

#[test]
fn the_split_search_agrees_with_the_original_on_a_bad_root_and_a_bad_pattern() {
    let dir = fixture();
    let far = Instant::now() + Duration::from_secs(60);
    let missing = Case {
        subdir: "no-such-dir",
        ..Case::plain("missing root", "World")
    };
    assert_eq!(
        wire(&missing.run(dir.path(), far)),
        wire(&legacy_search(&missing, dir.path(), far))
    );
    let a_file = Case {
        subdir: "a.md",
        ..Case::plain("root is a file", "World")
    };
    assert_eq!(
        wire(&a_file.run(dir.path(), far)),
        wire(&legacy_search(&a_file, dir.path(), far))
    );
    let bad_regex = Case {
        use_regex: true,
        ..Case::plain("bad regex", "[unclosed")
    };
    assert_eq!(
        wire(&bad_regex.run(dir.path(), far)),
        wire(&legacy_search(&bad_regex, dir.path(), far))
    );
}
