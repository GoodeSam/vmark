// @vitest-environment node
/**
 * Every locale's guide sidebar lists the SAME pages, in the same order, as
 * English's — and every link lands on a page that exists.
 *
 * The route topology used to be written out by hand in each locale config (the
 * labels are translated, the routes are not), and VitePress builds happily with a
 * page missing from a sidebar: the same five valid pages (formats, browser,
 * knowledge-base, workspace-rail, workflows) sat unlisted in every translated
 * sidebar until a parity sweep caught them by eye. The routes now come from
 * ONE list (`guideSidebar.ts`) and each locale supplies only labels; these
 * cases pin that the builder refuses a missing or stale label and that every
 * locale's result still matches English and lands on real pages.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { en } from "./en";
import { de } from "./de";
import { es } from "./es";
import { fr } from "./fr";
import { it as itLocale } from "./it";
import { ja } from "./ja";
import { ko } from "./ko";
import { ptBR } from "./pt-BR";
import { zhCN } from "./zh-CN";
import { zhTW } from "./zh-TW";
import { GUIDE_PAGES, guideSidebar } from "./guideSidebar";

const WEBSITE = resolve(import.meta.dirname, "../..");
interface Item { link?: string; items?: Item[] }
const links = (items: Item[]): string[] => items.flatMap((i) => [...(i.link ? [i.link] : []), ...(i.items ? links(i.items) : [])]);
const guideLinks = (config: { themeConfig: { sidebar: Record<string, Item[]> } }, prefix: string) =>
  links(config.themeConfig.sidebar[`${prefix}/guide/`] ?? []);

const LOCALES = { de, es, fr, it: itLocale, ja, ko, "pt-BR": ptBR, "zh-CN": zhCN, "zh-TW": zhTW };
const english = guideLinks(en, "");

/** `/ja/guide/x` → `website/ja/guide/x.md`; a trailing slash is the directory's index. */
const pageFor = (link: string) => join(WEBSITE, link.endsWith("/") ? `${link}index.md` : `${link}.md`);

describe("guideSidebar", () => {
  const labels = (drop?: string, extra?: string) => ({
    sections: { guide: "G", usersAsDevelopers: "U" },
    pages: Object.fromEntries([...GUIDE_PAGES.filter((p) => p !== drop).map((p) => [p, `L:${p}`]), ...(extra ? [[extra, "x"]] : [])]),
  });

  it("builds the canonical page list, in order, under the locale prefix", () => {
    expect(links(guideSidebar("/ja", labels() as never))).toEqual(GUIDE_PAGES.map((p) => `/ja/guide/${p}`));
    expect(links(guideSidebar("", labels() as never))[0]).toBe("/guide/");
  });

  it("refuses a locale that is missing a page's label, or labels a page that is not in the list", () => {
    expect(() => guideSidebar("/ja", labels("formats") as never)).toThrow(/\/ja: no sidebar label for guide page "formats"/);
    expect(() => guideSidebar("/ja", labels(undefined, "retired-page") as never)).toThrow(/\/ja: sidebar label for "retired-page", which is not a guide page/);
  });
});

describe("locale guide sidebars", () => {
  it("English lists a non-trivial guide whose every page exists", () => {
    expect(english.length).toBeGreaterThan(20);
    expect(english.filter((l) => !existsSync(pageFor(l)))).toEqual([]);
  });

  it.each(Object.entries(LOCALES))("%s lists English's guide pages, in English's order", (code, config) => {
    const localized = guideLinks(config, `/${code}`);
    expect(localized.map((l) => l.replace(`/${code}/`, "/"))).toEqual(english);
  });

  it.each(Object.entries(LOCALES))("%s links only to pages that exist", (code, config) => {
    expect(guideLinks(config, `/${code}`).filter((l) => !existsSync(pageFor(l)))).toEqual([]);
  });
});
