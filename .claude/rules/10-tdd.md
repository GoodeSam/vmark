---
paths:
  - "src/**"
  - "src-tauri/src/**"
  - "server/**"
  - "scripts/**"
  - ".claude/hooks/**"
---

# 10 - TDD Workflow

**RED → GREEN → REFACTOR.** Never skip RED: a test you never saw fail proves
nothing. Coverage floors in `vitest.config.ts` are ratchet-only and enforced by
`pnpm test:coverage` (inside `check:all`); relaxing one needs a written
justification in the commit message.

| Category | Tests required? |
|----------|-----------------|
| Stores, hooks, utils, Rust commands, business logic | Always |
| Bug fixes | Always — a regression test that fails before the fix |
| Edge cases | Always — empty, null, boundaries |
| Components | Case-by-case — behavior (clicks, ARIA), not rendering |
| ProseMirror plugins | Case-by-case — transforms and state, not PM integration |
| CSS-only, docs, config, type-only | No |

## Pattern catalog (copy from these files)

| Kind | Example | Key points |
|------|---------|------------|
| Store | `src/stores/__tests__/revisionStore.test.ts` | call actions via `getState()`; reset state in `beforeEach` |
| Plugin | `src/plugins/multiCursor/__tests__/multiCursorPlugin.test.ts` | minimal schema + `createState()`; assert transaction effects |
| Hook | `src/hooks/useGenieShortcuts.lifecycle.test.tsx` | `renderHook`; mock Tauri; assert register/cleanup |
| Component | `src/components/Editor/UniversalToolbar/UniversalToolbar.test.tsx` | query by role/name; `userEvent`, not `fireEvent`; `vi.hoisted()` for early mocks |
| Utils | `src/utils/fileSizeThresholds.test.ts` | table-driven `it.each`; no mocks |

## Anti-patterns

Code before tests; "renders without crashing"; asserting implementation details;
mocking your own logic instead of boundaries (APIs, filesystem); snapshot tests
for logic; `any` in test types.

Shared helpers: `src/test/setup.ts` (global mocks), `src/test/popupTestUtils.ts`.
