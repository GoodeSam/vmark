//! WI-RA7.3 — the quit request honours window readiness, and a quit that
//! stalls stops swallowing retries.
//!
//! The defect: Cmd+N then Cmd+Q during boot emitted `app:quit-requested` to a
//! window whose listeners were not registered yet. The request went nowhere,
//! the window stayed a quit target, and `QUIT_IN_PROGRESS` swallowed every
//! later Cmd+Q for the life of the process.

use std::time::{Duration, Instant};

use super::super::{cancel_quit, is_quit_in_progress, tests::TEST_LOCK};
use super::*;

/// Serialize with every other test that touches the quit statics, and start
/// from "no quit in progress".
fn quit_state() -> std::sync::MutexGuard<'static, ()> {
    let guard = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    cancel_quit();
    guard
}

// -- which request starts, restarts or duplicates a quit ----------------------

#[test]
fn the_first_request_starts_the_quit() {
    let _lock = quit_state();
    assert_eq!(claim_quit_attempt(Instant::now()), QuitAttempt::Fresh);
    assert!(is_quit_in_progress());
    cancel_quit();
}

#[test]
fn a_repeat_inside_the_retry_window_is_a_duplicate() {
    let _lock = quit_state();
    let start = Instant::now();
    assert_eq!(claim_quit_attempt(start), QuitAttempt::Fresh);

    assert_eq!(claim_quit_attempt(start), QuitAttempt::AlreadyRunning);
    let just_inside = start + QUIT_RETRY_AFTER - Duration::from_millis(1);
    assert_eq!(claim_quit_attempt(just_inside), QuitAttempt::AlreadyRunning);
    cancel_quit();
}

#[test]
fn a_quit_still_unfinished_after_the_retry_window_is_asked_again() {
    let _lock = quit_state();
    let start = Instant::now();
    assert_eq!(claim_quit_attempt(start), QuitAttempt::Fresh);

    let stalled = start + QUIT_RETRY_AFTER;
    assert_eq!(
        claim_quit_attempt(stalled),
        QuitAttempt::Retry,
        "a stalled quit must not swallow the user's next Cmd+Q"
    );
    assert!(is_quit_in_progress(), "the quit is still the same quit");

    // The retry restarts the clock: an immediate repeat is a duplicate again,
    // and a later one is honoured again.
    assert_eq!(
        claim_quit_attempt(stalled + Duration::from_secs(1)),
        QuitAttempt::AlreadyRunning
    );
    assert_eq!(
        claim_quit_attempt(stalled + QUIT_RETRY_AFTER * 3),
        QuitAttempt::Retry
    );
    cancel_quit();
}

#[test]
fn a_request_stamped_before_the_quit_started_is_a_duplicate_not_a_panic() {
    // `Instant`s are taken on different threads; one can be a hair older than
    // the start it is compared with.
    let _lock = quit_state();
    let start = Instant::now() + Duration::from_secs(5);
    assert_eq!(claim_quit_attempt(start), QuitAttempt::Fresh);
    assert_eq!(
        claim_quit_attempt(start - Duration::from_secs(5)),
        QuitAttempt::AlreadyRunning
    );
    cancel_quit();
}

#[test]
fn a_cancelled_quit_leaves_the_next_request_fresh() {
    let _lock = quit_state();
    let start = Instant::now();
    assert_eq!(claim_quit_attempt(start), QuitAttempt::Fresh);

    cancel_quit();

    assert!(!is_quit_in_progress());
    assert_eq!(claim_quit_attempt(start), QuitAttempt::Fresh);
    cancel_quit();
}

// -- who is asked, and when ----------------------------------------------------
//
// `tauri::test` does not exist on Windows (see Cargo.toml's target-specific
// dev-dependency); every mock-runtime test in this crate is gated to match.

#[cfg(not(target_os = "windows"))]
mod on_a_mock_app {
    use std::sync::{Arc, Mutex};

    use tauri::test::MockRuntime;
    use tauri::{Listener, WebviewWindow};

    use super::super::{request_quit_of, QUIT_REQUESTED_EVENT};
    use super::{cancel_quit, quit_state};
    use crate::menu;

    fn mock_app() -> tauri::App<MockRuntime> {
        tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app")
    }

    /// A document window under a label no other test uses: window readiness is
    /// recorded per label for the whole process.
    fn document_window(
        app: &tauri::App<MockRuntime>,
        label: &str,
    ) -> (String, WebviewWindow<MockRuntime>) {
        let window =
            tauri::webview::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::default())
                .visible(false)
                .build()
                .expect("build mock document window");
        (label.to_string(), window)
    }

    /// Every `app:quit-requested` payload the app's windows are sent.
    fn quit_requests(app: &tauri::App<MockRuntime>) -> Arc<Mutex<Vec<String>>> {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        app.listen_any(QUIT_REQUESTED_EVENT, move |event| {
            sink.lock()
                .expect("capture")
                .push(event.payload().to_string());
        });
        seen
    }

    fn received(requests: &Arc<Mutex<Vec<String>>>) -> Vec<String> {
        requests.lock().expect("capture").clone()
    }

    #[test]
    fn a_window_that_is_listening_is_asked_at_once() {
        let _lock = quit_state();
        let app = mock_app();
        let requests = quit_requests(&app);
        let windows = [document_window(&app, "doc-70301")];
        menu::events::mark_window_ready(app.handle(), "doc-70301");

        request_quit_of(&windows).expect("emit");

        assert_eq!(received(&requests), vec!["\"doc-70301\""]);
        menu::events::clear_window_ready("doc-70301");
    }

    #[test]
    fn a_window_still_starting_is_asked_when_it_becomes_ready_not_before() {
        let _lock = quit_state();
        let app = mock_app();
        let requests = quit_requests(&app);
        let windows = [document_window(&app, "doc-70302")];

        request_quit_of(&windows).expect("a deferred request is not a failure");
        assert!(
            received(&requests).is_empty(),
            "a request emitted before the frontend listens is a request lost"
        );

        menu::events::mark_window_ready(app.handle(), "doc-70302");
        assert_eq!(received(&requests), vec!["\"doc-70302\""]);
        menu::events::clear_window_ready("doc-70302");
    }

    #[test]
    fn asking_again_does_not_queue_a_second_request_for_a_window_still_starting() {
        let _lock = quit_state();
        let app = mock_app();
        let requests = quit_requests(&app);
        let windows = [document_window(&app, "doc-70303")];

        request_quit_of(&windows).expect("first ask");
        request_quit_of(&windows).expect("the retry");
        menu::events::mark_window_ready(app.handle(), "doc-70303");

        assert_eq!(
            received(&requests).len(),
            1,
            "one request, however often asked"
        );
        menu::events::clear_window_ready("doc-70303");
    }

    #[test]
    fn a_cancelled_quit_withdraws_its_request_from_a_window_still_starting() {
        let _lock = quit_state();
        let app = mock_app();
        let requests = quit_requests(&app);
        let windows = [document_window(&app, "doc-70304")];
        request_quit_of(&windows).expect("deferred");

        // The user cancelled a save prompt in another window.
        cancel_quit();
        menu::events::mark_window_ready(app.handle(), "doc-70304");

        assert!(
            received(&requests).is_empty(),
            "a window that finishes starting after the quit was called off must not be closed by it"
        );
        menu::events::clear_window_ready("doc-70304");
    }

    #[test]
    fn listening_and_starting_windows_are_each_handled_in_one_broadcast() {
        let _lock = quit_state();
        let app = mock_app();
        let requests = quit_requests(&app);
        let windows = [
            document_window(&app, "doc-70305"),
            document_window(&app, "doc-70306"),
        ];
        menu::events::mark_window_ready(app.handle(), "doc-70305");

        request_quit_of(&windows).expect("emit");
        assert_eq!(received(&requests), vec!["\"doc-70305\""]);

        menu::events::mark_window_ready(app.handle(), "doc-70306");
        assert_eq!(received(&requests), vec!["\"doc-70305\"", "\"doc-70306\""]);
        menu::events::clear_window_ready("doc-70305");
        menu::events::clear_window_ready("doc-70306");
    }
}
