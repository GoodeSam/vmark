---
paths:
  - "**/*.css"
  - "src/**/*.tsx"
  - "src/theme/**"
---

# 34 - Dark Theme

- Selector: `.dark-theme` (`.dark` allowed for Tailwind). Never `[data-theme=…]`;
  migrate any you touch.
- Tokens (`--bg-color`, `--text-color`, `--border-color`, `--hover-bg`,
  `--accent-bg`, `--error-color`, …) are already theme-aware — no override
  needed. Values come from the typed catalog via `useTheme.ts` (rule 31).
- Override under `.dark-theme` only for: raw `rgba()` with a different opacity,
  shadows/glows (`--popup-shadow-dark`), or contrast fixes. Prefer adding a
  token over hardcoding rgba in both themes.
- Alert blocks: use `--alert-*-dark` with
  `color-mix(in srgb, var(--alert-note-dark) 8%, transparent)` backgrounds.
- Text on an inverted surface: `var(--bg-color)`, never `white`.
- Verify both themes visually (`dev-docs/css-reference.md` when present); text
  ≥ 4.5:1 (`pnpm lint:theme-contrast` measures the catalog), focus visible,
  shadows still read.
