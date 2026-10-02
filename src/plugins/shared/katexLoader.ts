import type { KatexOptions } from "katex";

export type KatexModule = typeof import("katex");
export type { KatexOptions };

let katexModule: KatexModule | null = null;
let katexLoadPromise: Promise<KatexModule> | null = null;

export async function loadKatex(): Promise<KatexModule> {
  if (katexModule) return katexModule;
  if (katexLoadPromise) return katexLoadPromise;

  katexLoadPromise = import("katex").then((mod) => {
    katexModule = mod;
    return mod;
  });

  return katexLoadPromise;
}

export function getKatexModule(): KatexModule | null {
  return katexModule;
}

/**
 * Check if KaTeX module has been loaded.
 */
export function isKatexLoaded(): boolean {
  return katexModule !== null;
}
