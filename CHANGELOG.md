# Changelog

All notable changes to VMark are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and VMark uses
[Semantic Versioning](https://semver.org/).

Each release's section is its release notes: the release workflow publishes it
as the GitHub release body and as the "what's new" text of the in-app update
card, and refuses to release a version that has no section here. Write the
section as part of the version bump (`.claude/rules/40-version-bump.md`).

## [Unreleased]

### Added

- Settings → About has a **Third-party notices** link that opens the license
  notices of the open-source software bundled with VMark.
- The update card shows the new version's release notes instead of a link to
  them.

## [0.9.91] - 2026-10-01

### Fixed

- Source mode: editing a footnote definition no longer loses the editor's
  focus, and footnote previews stay out of the way while text is selected
  ([#1491](https://github.com/xiaolai/vmark/issues/1491)).

## [0.9.90] - 2026-10-01

### Added

- Terminal: Claude Code and Codex replies that contain a Markdown table or a
  Mermaid diagram can be rendered beside the terminal. Turn it on with
  Settings → Terminal → Automatic transcript rendering (off by default).

### Fixed

- Moving the terminal panel between top and bottom, or left and right, no
  longer restarts every running shell.

## [0.9.89] - 2026-09-30

### Fixed

- macOS: programs run in the integrated terminal can ask for the microphone,
  the camera and Apple Events. Recording tools such as FFmpeg previously got
  silence with no permission prompt
  ([#1483](https://github.com/xiaolai/vmark/issues/1483)).

## [0.9.88] - 2026-09-30

### Changed

- Documents with many formulas open and scroll faster: inline math renders as
  it nears the viewport, KaTeX fonts load while the editor is still empty, and
  images decode off the main thread.
- Find and replace, and list handling in long documents, take time linear in
  the document's size.

### Fixed

- The editor keeps block sizes steady while idle, so the view no longer jumps
  ([#1472](https://github.com/xiaolai/vmark/issues/1472)).
- Switching back to a tab restores the reading position by block, and the view
  holds still when formulas finish rendering above it.
- An edited formula re-renders at once, without flashing its source.
- Printing exports the document's Markdown even when the live editor went away
  during the export.
- Terminal: every new shell starts on a reset terminal, clipboard writes from
  programs (OSC 52) are bounded, and "press any key" after a program exits
  waits until its last lines are shown.

### Security

- Raised the `markdown-it` version floor past GHSA-253c-mchw-3w2r.

[Unreleased]: https://github.com/xiaolai/vmark/compare/v0.9.91...HEAD
[0.9.91]: https://github.com/xiaolai/vmark/releases/tag/v0.9.91
[0.9.90]: https://github.com/xiaolai/vmark/releases/tag/v0.9.90
[0.9.89]: https://github.com/xiaolai/vmark/releases/tag/v0.9.89
[0.9.88]: https://github.com/xiaolai/vmark/releases/tag/v0.9.88
