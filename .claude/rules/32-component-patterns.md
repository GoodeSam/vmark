---
paths:
  - "**/*.css"
  - "src/**/*.tsx"
  - "src/styles/**"
---

# 32 - Component Patterns

The shared stylesheets in `src/styles/` are the reference implementation; read
them rather than copying CSS from here.

## Use the canonical components before writing a new class

| Need | Use | Defined in |
|---|---|---|
| Text button | `.vm-btn` (+ `--primary`, `--cta`, `--plain`, `--danger`, `--compact`, `--pill`) | `button-shared.css` |
| Dropdown / `<select>` | `.vm-select` inside a `.vm-select-field` wrapper (the wrapper draws the chevron) | `select-shared.css` |
| Icon button in a popup | `.popup-icon-btn` (+ `--primary`, `--danger`) | `icon-button-shared.css` |
| Icon button elsewhere | `.vm-icon-btn` (+ `--sm` 24 / `--lg` 28 / `--bordered` / `--primary` / `--danger`) | `icon-button-shared.css` |
| Tab-strip add/close | `TabStripButton` (`src/components/shared/`) | `icon-button-shared.css` |
| Editor toolbar button | `.universal-toolbar-btn` | `universal-toolbar.css` |
| Anchored popup surface | `.popup-container` | `popup-shared.css` |
| Modal/finder overlay | `.vm-overlay` + `.vm-overlay__panel` | `overlay-shared.css` |
| Context menu | `.vm-menu` | `overlay-shared.css` |
| Text input | `.vm-input` (+ `--field`, `--bare`, `--mono`) | `input-shared.css` |
| Panel + header + rows | `.vm-panel` | `panel-shared.css` |
| Chip / pill / kbd hint | `.vm-chip` | `panel-shared.css` |
| Toggle switch | `.vm-switch` | `panel-shared.css` |

- **Never write a new `*-btn` class.** `pnpm lint:bespoke-buttons` ratchets the
  count down and also diffs each button's token choices against `.vm-btn`
  (shape drift). Clear drift by migrating to `.vm-btn`, promoting a real variant
  onto it, or `/* button-shape-ok: <reason> */` in the rule body.
- Never a bare `<select>` — WebKit draws native chrome over author styles.
- **Current-tab idiom** (status-bar pills, `.browser-workspace-tab.active`) is
  the NEGATIVE treatment — `--text-color` fill, `--bg-color` text — marked
  `ui-ok(state): current-tab`. Hover stays the ordinary R6 vocabulary. Selected
  LIST rows use `--accent-bg`.

## The ui-consistency gate

`pnpm lint:ui-consistency` checks CSS and JSX: type scale (C3), overlay shells
compose `.popup-container`/`.vm-overlay__panel`/`.vm-menu` (C4), `--font-sans`
only under document selectors (C5), icon sizes (C7), ≥24px hit targets (C8),
state vocabulary (C9), visible focus (C10), bar-height/z-index literals (C11),
floating over content (C12). C9 also reads INK: a selected, checked, pressed or
current state — `.active`, BEM `--active`, `[aria-checked|pressed|current|selected]`
— may not colour its label with `--accent-primary`/`--primary-color`; accent goes
on the fill and on icons/indicators. Exemptions: `ui-ok(<check>): <reason>`
(reason required; `ui-ok(state)` for icon-only controls whose glyph IS the
indicator, `ui-ok(float)` below). The baseline ratchets down only.

## Layout

- Full-height side panels dock in-flow via `EditorArea`'s `sidePanel` or
  `panel` slot; never `position: fixed` over the editor. Fixed is for small,
  transient cards, menus and modals.
- A control that belongs to a pane goes in the pane's chrome, IN FLOW (a header
  row, a docked slot) — never `position: absolute` over the pane's content. The
  split-pane mode toggle floated over the panes and lay across the HTML trust
  bar, the read-only banner and source text. C12 flags any positioned element at
  or above `--z-bar` outside the overlay families; the legitimate ones (layer
  owners in the z-table below, a control over a pannable canvas, transient drag
  feedback) carry `ui-ok(float): <why it may cover content>`.
- Overlap is geometry, and static lint cannot prove its absence: chrome that
  shares a surface gets a `*.webkit.test.ts` asserting bounding boxes and
  `elementFromPoint` in a real engine, rendering the PRODUCTION component — not
  a hand-built copy of its DOM, which drifts (`SplitPaneFrame` +
  `SplitPaneEditor/splitPaneLayout.webkit.test.tsx`).
- New surfaces are mounted by editing App.tsx's `<AppShell>`; `lint:shell-slots`
  holds the identity list. Bundle related surfaces behind one mount
  (`CoherenceOverlays.tsx`) rather than appending names.
- Each component's styles live in ONE file. Popup styles live in their plugin's
  CSS, never in `editor.css`.

## Popups

- `.popup-container`: fixed, `--z-popup`, 6px padding, 1px `--border-color`,
  `--radius-lg`, `--popup-shadow`, 0.1s fade-in. Inline editor popups stay
  inside `EditorContainer`; position is computed from the selection.
- Popup inputs: borderless, transparent, 12px, `--font-ui` (`--font-mono` for
  URLs/paths), focus = caret only (declared per rule 33).
- Popup/toolbar icon buttons: transparent, `--hover-bg` on hover,
  `opacity: 0.4` disabled, focus = flat 2px bar (rule 33), 14px icons in
  popups, 18px in the toolbar. Cursor: `var(--cursor-interactive, default)`.

## Other patterns

- Tables scroll horizontally inside `.table-scroll-container`; never clip them
  with `overflow-x: hidden` on an ancestor.
- Frame ownership: when a wrapper exists (`.code-block-wrapper`), it owns
  background, border and radius; children (`pre`) are flat.
- Scrollbars: global 10px, dense lists use `.vm-scroll--thin`; colors are
  `--border-color` / `--md-char-color`.

## Z-index

| Layer | Z-index | Components |
|-------|---------|------------|
| Base | 0–10 | Content, sidebar panels, resize handles |
| Floating | 50–60 | Inline previews |
| Bars | 100–102 | StatusBar/FindBar/TitleBar (100), Toolbar (102) |
| Toolbar dropdown | 103 | UniversalToolbar dropdown |
| Context/preview | 1000 | File/tab context menus, spellcheck, Mermaid preview |
| MCP status | 1200 | StatusBar MCP overlay |
| Inline popups | 9999 | Link, image, wiki-link, math, heading, footnote, Genie picker; modal portals |
| Table context | 10000 | Table context menu |

Use the `--z-*` tokens (rule 31), not literals.
