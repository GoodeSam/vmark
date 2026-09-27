import footnote from "markdown-it-footnote";
import { vitepressMarkmapPreview } from "vitepress-markmap-preview";
import type { UserConfig } from "vitepress";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "../../../package.json"), "utf-8")
);

// VitePress's default heading slug, plus one step: recompose (NFC) at the end.
// The default decomposes with NFKD and strips only Latin combining marks, so a
// Hangul syllable stays split into jamo and a kana with ゛/゜ into base + mark —
// and a hand-written `#한국어-제목` link can never match the generated id.
// Latin output is unchanged: its marks are already stripped before NFC runs.
const rControl = /[\u0000-\u001f]/g;
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const rCombining = /[\u0300-\u036F]/g;
const slugify = (str: string): string =>
  str
    .normalize("NFKD")
    .replace(rCombining, "")
    .replace(rControl, "")
    .replace(rSpecial, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase()
    .normalize("NFC");

export const shared: UserConfig = {
  title: "VMark",
  description: "The plain-text workspace where humans and AI collaborate",

  vite: {
    define: {
      __VMARK_VERSION__: JSON.stringify(pkg.version),
    },
  },
  lastUpdated: true,
  appearance: false, // We use our own theme switcher

  markdown: {
    anchor: { slugify },
    config: (md: any) => {
      md.use(footnote);
      vitepressMarkmapPreview(md);
    },
  },

  head: [
    [
      "link",
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
    ["meta", { name: "theme-color", content: "#4a6fa5" }],
    ["meta", { name: "mobile-web-app-capable", content: "yes" }],
    [
      "meta",
      { name: "apple-mobile-web-app-status-bar-style", content: "black" },
    ],
  ],

  mermaid: {
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  },
};
