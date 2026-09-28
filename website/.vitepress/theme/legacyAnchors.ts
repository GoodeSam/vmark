/**
 * Purpose: keep deep links written before the site's slugs were recomposed
 * (NFC) working.
 *
 * Heading ids used to be VitePress's NFKD output, so a Korean or voiced-kana
 * heading's id was the DECOMPOSED string; links copied then — from the address
 * bar, or pasted elsewhere — carry that form. The new id is exactly the NFC of
 * the old one (config/slugify.ts appends `.normalize("NFC")` and nothing
 * else), so an unmatched fragment whose NFC form names a heading is that
 * heading.
 *
 * @coordinates-with website/.vitepress/config/slugify.ts — the NFC step this undoes for old links
 * @coordinates-with website/.vitepress/theme/index.ts — calls it on load and on hash changes
 * @module website/.vitepress/theme/legacyAnchors
 */

/**
 * The id a legacy `hash` should land on, or null when there is nothing to do:
 * no fragment, a fragment that already matches, one that does not decode, or
 * one whose NFC form matches nothing either.
 */
export function legacyFragmentTarget(hash: string, hasId: (id: string) => boolean): string | null {
  if (!hash || hash === "#") return null;
  let id: string;
  try {
    id = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return null;
  }
  if (hasId(id)) return null;
  const composed = id.normalize("NFC");
  return composed !== id && hasId(composed) ? composed : null;
}

/** Re-point the current page's legacy fragment at its heading; the browser scrolls, no history entry is added. */
export function redirectLegacyFragment(): void {
  const target = legacyFragmentTarget(window.location.hash, (id) => document.getElementById(id) !== null);
  if (target !== null) window.location.replace(`#${encodeURIComponent(target)}`);
}
