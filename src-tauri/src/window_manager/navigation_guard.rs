//! Which URLs an app webview may navigate to.
//!
//! Purpose: a webview that hosts the app's own UI must only ever show the
//! app's own pages. Without a rule, a plain click on a link in a rendered
//! preview — or a form posted from one — replaces the editor with whatever the
//! document chose, inside the app's chrome and with the editor state gone.
//! The frontend intercepts those clicks; this is the backstop that holds when
//! it does not.
//!
//! Key decisions:
//!   - It is a PLUGIN hook, not a per-window `on_navigation`. The `main`
//!     window is created by Tauri from `tauri.conf.json`, so it has no
//!     `WebviewWindowBuilder` to hang a handler on, and it is the window the
//!     rule matters most for. Tauri consults every plugin's hook for every
//!     webview at navigation time, however the webview was created.
//!   - The decision cannot see WHICH FRAME is navigating. On macOS and Linux
//!     the runtime asks for a sub-frame navigation exactly as it asks for a
//!     main-frame one, with only the URL. So the allowed set is the app's own
//!     origin plus what the app itself frames — the same set the CSP's
//!     `frame-src` names — and nothing a document could choose. A test pins
//!     the two together: widening `frame-src` fails until this agrees.
//!   - `asset:` is NOT allowed, although it is the app's own protocol. It
//!     serves any granted local file, images and media load from it as
//!     subresources (never a navigation), and an HTML file lying next to a
//!     hostile document would otherwise open full-frame in the app's window.
//!   - A dev build is wider, because it enforces no CSP at all (the page comes
//!     from the dev server, which sends none): the Knowledge Base frame on its
//!     loopback port and the video embeds load there today, and denying them
//!     would break features only a dev build can show.
//!   - The PDF renderer's throwaway windows are not governed. They hold no
//!     capability, show no app UI, and exist to load one staged file; their
//!     own one-shot navigation logic is the policy there.
//!   - The embedded browser's pages are not Tauri webviews, so no hook here
//!     reaches them and their navigation policy is untouched.
//!
//! @coordinates-with app_plugins.rs — registers the plugin
//! @coordinates-with trusted_html/protocol.rs — the trusted-preview scheme
//! @coordinates-with pdf_export/renderer — the ungoverned render windows
//! @module window_manager/navigation_guard

use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{Manager, Runtime, Url};

use crate::peer_text::peer_text;
use crate::trusted_html::protocol::SCHEME as TRUSTED_SCHEME;

/// Host of every custom-protocol URL where protocols are schemes.
const PROTOCOL_HOST: &str = "localhost";

/// The label prefix `pdf_export::renderer` gives its throwaway windows off
/// macOS. Spelled here because that constant is private to two `cfg`-gated
/// modules; a test holds the two spellings together.
const RENDER_WINDOW_LABEL_PREFIX: &str = "pdf-render-";

/// The video providers the editor embeds, each also reachable under `www.`.
/// The frontend's allow-list (`VIDEO_EMBED_DOMAIN_RE`) is the source of truth;
/// a test holds this copy to it.
const DEV_EMBED_DOMAINS: [&str; 4] = [
    "youtube.com",
    "youtube-nocookie.com",
    "player.vimeo.com",
    "player.bilibili.com",
];

/// What this build's own pages are served from.
#[derive(Clone, Copy, Debug)]
pub(crate) struct AppOrigins<'a> {
    /// The dev server, in a dev build; `None` in a release build.
    pub dev_url: Option<&'a Url>,
    /// Whether custom protocols are reached over `http://<scheme>.localhost`
    /// (Windows, Android) rather than `<scheme>://localhost`.
    pub http_custom_protocols: bool,
}

/// `about:blank` and `about:srcdoc`: what an empty or `srcdoc` frame loads.
fn is_inert_about_page(url: &Url) -> bool {
    url.scheme() == "about" && matches!(url.path(), "blank" | "srcdoc") && url.query().is_none()
}

/// `http://<name>.localhost` on its default port, or `https://` when allowed.
fn is_http_protocol_origin(url: &Url, name: &str, allow_https: bool) -> bool {
    let scheme_ok = url.scheme() == "http" || (allow_https && url.scheme() == "https");
    scheme_ok
        && url.port().is_none()
        && url
            .host_str()
            .and_then(|host| host.strip_suffix(".localhost"))
            == Some(name)
}

/// The origin a release build's own pages have.
fn is_release_app_page(url: &Url, http_custom_protocols: bool) -> bool {
    if http_custom_protocols {
        // `https` too: a window may opt into it, and `.localhost` never
        // resolves off the machine.
        is_http_protocol_origin(url, "tauri", true)
    } else {
        url.scheme() == "tauri" && url.host_str() == Some(PROTOCOL_HOST) && url.port().is_none()
    }
}

/// The trusted HTML preview's frame, in this platform's form.
fn is_trusted_preview_frame(url: &Url, http_custom_protocols: bool) -> bool {
    if http_custom_protocols {
        is_http_protocol_origin(url, TRUSTED_SCHEME, false)
    } else {
        url.scheme() == TRUSTED_SCHEME
    }
}

/// What only a dev build frames: the Knowledge Base content server on a
/// loopback port, and the video embeds.
fn is_dev_only_frame(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    match url.scheme() {
        "http" if host == "127.0.0.1" => true,
        "http" | "https" => DEV_EMBED_DOMAINS.contains(&host.strip_prefix("www.").unwrap_or(host)),
        _ => false,
    }
}

/// Whether an app webview may navigate to `url`.
pub(crate) fn navigation_allowed(url: &Url, origins: AppOrigins<'_>) -> bool {
    if is_inert_about_page(url) {
        return true;
    }
    // No page the app loads is ever addressed with credentials.
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    if is_trusted_preview_frame(url, origins.http_custom_protocols) {
        return true;
    }
    match origins.dev_url {
        Some(dev_url) => url.origin() == dev_url.origin() || is_dev_only_frame(url),
        None => is_release_app_page(url, origins.http_custom_protocols),
    }
}

/// Whether the webview labelled `label` is governed by this guard.
fn governs(label: &str) -> bool {
    !label.starts_with(RENDER_WINDOW_LABEL_PREFIX)
}

/// The plugin that applies [`navigation_allowed`] to every app webview.
pub(crate) fn plugin<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("vmark-navigation-guard")
        .on_navigation(|webview, url| {
            let label = webview.label();
            if !governs(label) {
                return true;
            }
            let config = webview.app_handle().config();
            let origins = AppOrigins {
                dev_url: config.build.dev_url.as_ref().filter(|_| tauri::is_dev()),
                http_custom_protocols: cfg!(any(windows, target_os = "android")),
            };
            let allowed = navigation_allowed(url, origins);
            if !allowed {
                // Scheme and host only: the rest of a URL can carry a token or
                // a path, and all of it is text the document chose.
                log::warn!(
                    "[navigation] blocked {}: {} on {}",
                    peer_text(label),
                    peer_text(url.scheme()),
                    peer_text(url.host_str().unwrap_or("")),
                );
            }
            allowed
        })
        .build()
}

#[cfg(test)]
#[path = "navigation_guard.test.rs"]
mod tests;
