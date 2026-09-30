/**
 * Purpose: the site's heading slugifier — VitePress's default, plus one step.
 *
 * The default decomposes with NFKD and strips only Latin combining marks, so a
 * Hangul syllable stays split into jamo and a kana with ゛/゜ into base + mark —
 * and a hand-written `#한국어-제목` link can never match the generated id. The
 * one step is to recompose (NFC) at the end. Latin output is unchanged: its
 * marks are already stripped before NFC runs.
 *
 * VitePress does not export its slugifier, so `vitepressSlugify` is a VERBATIM
 * copy of the one bundled in vitepress 1.x, isolated here so the copy is one
 * line to compare. `slugify.test.ts` reads the INSTALLED vitepress bundle and
 * fails if the two ever disagree — an upgrade that changes upstream slugs must
 * be re-vendored deliberately, not drift silently.
 *
 * Changing this changes every anchor on the site; old decomposed fragments
 * are resolved client-side by theme/legacyAnchors.ts.
 *
 * @coordinates-with website/.vitepress/config/shared.ts — installs it as `markdown.anchor.slugify`
 * @coordinates-with website/.vitepress/theme/legacyAnchors.ts — keeps pre-NFC deep links working
 * @module website/.vitepress/config/slugify
 */

// Verbatim from upstream, control range and redundant escapes included — the
// parity test compares this text's behaviour, so it is not tidied.
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const rControl = /[\u0000-\u001f]/g;
// eslint-disable-next-line no-useless-escape -- upstream's spelling, kept verbatim
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const rCombining = /[\u0300-\u036F]/g;

/** VitePress 1.x's default heading slugifier, verbatim. */
export const vitepressSlugify = (str: string): string =>
  str
    .normalize("NFKD")
    .replace(rCombining, "")
    .replace(rControl, "")
    .replace(rSpecial, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase();

/** The site's slugifier: upstream's, recomposed so CJK ids match what an author types. */
export const slugify = (str: string): string => vitepressSlugify(str).normalize("NFC");
