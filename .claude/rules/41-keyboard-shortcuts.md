---
paths:
  - "src/stores/settingsStore/shortcut*"
  - "src/services/keybinding/**"
  - "src/hooks/useKeybindingRouter.ts"
  - "src/hooks/useGenieShortcuts.ts"
  - "src-tauri/src/menu/**"
  - "src-tauri/locales/**"
  - "website/guide/shortcuts.md"
---

# 41 - Keyboard Shortcuts

## Three surfaces, one gate

| Surface | Format |
|---|---|
| `src/stores/settingsStore/shortcutDefinitions.ts` — source of truth | `defaultKey: "Alt-Mod-l"`, plus `menuId` for menu-backed entries |
| Rust menu builder `src-tauri/src/menu/localized/*.rs` (`accel(...)`) and its contract mirror `localized.test.rs` | `"Alt+CmdOrCtrl+L"` |
| `website/guide/shortcuts.md` | `Alt + Mod + L` |

`pnpm lint:keybinding-manifest` derives the synced set (every `menuId` entry,
minus dynamically bound ones) and fails on any drift between the three. Encoded
exceptions: `undo`/`redo`/`quit` are not customizable; headings are documented
as the range "Mod + 1 through Mod + 6"; `aiPrompts`/`search-genies` is bound at
runtime by `useGenieShortcuts`. Do not reintroduce a hand-written
`keybindingManifest.ts` (`check-deleted-names.mjs` forbids it).

Changing a menu-backed shortcut: update all three surfaces, and
`src-tauri/locales/en.yml` (plus other locales) if a menu label changes. Then run
`pnpm lint:keybinding-manifest` and `cargo check --manifest-path src-tauri/Cargo.toml`.

## Pitfalls

- **Duplicates**: two menu items with one accelerator — only one fires. Check
  with `grep -oE 'defaultKey: "[^"]*"' src/stores/settingsStore/shortcutDefinitions.ts | sort | uniq -c | sort -rn`.
- **Frontend interception**: window keydown goes through `useKeybindingRouter`
  (bindings in `src/services/keybinding/keybindingDefinitions.ts`). A binding
  that consumes the event there stops the menu event from firing.
- Backtick escaping: ProseMirror ``"Ctrl-`"``, Tauri ``"Ctrl+`"``.

## Conventions

| Pattern | Use for |
|---|---|
| `Mod+Key` | Common actions (Save, Open, New, Close) |
| `Mod+Shift+Key` | Variants (Save As, New Window) |
| `Alt+Mod+Key` | View toggles, block formatting |
| `Alt+Mod+Shift+Key` | Less common actions |
| `F1`–`F12` | Mode toggles (F7 status bar, F8 focus, F9 typewriter) |

Prefer mnemonics: `Alt+Mod+L` Lines, `Alt+Mod+Q` Quote, `Alt+Mod+C` Code.
