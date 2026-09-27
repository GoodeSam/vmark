---
paths:
  - "**/*.css"
  - "src/**/*.tsx"
---

# 33 - Focus Indicators (Accessibility)

Keyboard focus must ALWAYS be visible (WCAG). Never remove focus styling
without a replacement, never `outline: none` globally on inputs, and never
combine outline + border + background on one element.

| Element | Focus pattern |
|---|---|
| Toolbar, popup and icon buttons | **Flat 2px bar** (D4, the one shape): `:focus-visible { outline: none; position: relative }` + `::after { content: ''; position: absolute; bottom: 2px; left: 4px; right: 4px; height: 2px; background: var(--accent-primary); border-radius: 1px }` |
| Text inputs in popups | Caret only — MUST be declared (below). A bordered popup input may use `background: var(--bg-tertiary)` instead |
| Dialog/settings inputs | Bottom border: `border-bottom-color: var(--primary-color)` |
| Standalone buttons | `outline: 2px solid var(--primary-color); outline-offset: 2px` |
| List items | `background: var(--accent-bg)` |
| Content widgets (checkboxes, embeds) | Outline or `box-shadow: 0 0 0 2px var(--accent-bg)` — the global reset removes outlines, so they must define their own |

**Caret-only must be declared with a reason**, or `lint:design-tokens` treats it
as a lost focus ring:

```css
/* focus: caret-only — borderless text input in a popup; the caret is the indicator */
.popup-input:focus,
.popup-input:focus-visible { outline: none; box-shadow: none; }
```

No marker is needed when a `:focus-visible` rule on the same selector paints a
background, outline, border or box-shadow.

Focus must not rely on color alone, and must be visible in dark themes. Check:
tab through every control, in light and dark, at more than one zoom level.
