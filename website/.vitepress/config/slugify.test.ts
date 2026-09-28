// @vitest-environment node
/**
 * The site's heading slugifier: CJK ids recomposed, everything else exactly
 * what VitePress produces — and the vendored upstream copy pinned against the
 * vitepress actually installed, since VitePress does not export it.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { slugify, vitepressSlugify } from "./slugify";

const WEBSITE = resolve(import.meta.dirname, "../..");
const requireFromSite = createRequire(join(WEBSITE, "package.json"));

const CORPUS = [
  "Getting Started", "Café Déjà vu", "1. Introduction", "  --Mixed__case!!  ", "API: `invoke()` & friends",
  "한국어 제목", "がぎぐげご パピプ", "ｶﾞ 半角", "中文标题（全角）", "Straße ǅ ﬁ", "tab\there", "",
  // A BACKSLASH is one of upstream's separators. A vendored copy that lost
  // one escape (`|\;` → `|\;`-minus-one) matched `;` twice and `\` never,
  // and every other string here still agreed with upstream.
  "a\\b", "C:\\Users\\me", "trailing\\",
];

describe("slugify", () => {
  it("keeps a Hangul heading as composed syllables, so a typed #한국어-제목 matches", () => {
    expect(slugify("한국어 제목")).toBe("한국어-제목");
    expect(slugify("한국어 제목")).toBe("한국어 제목".normalize("NFC").replace(" ", "-"));
    expect(vitepressSlugify("한국어 제목")).not.toBe("한국어-제목"); // upstream leaves jamo
  });

  it("keeps voiced and semi-voiced kana composed", () => {
    expect(slugify("がぎぐ パピプ")).toBe("がぎぐ-パピプ");
    expect([...slugify("が")]).toHaveLength(1);
  });

  it("leaves every Latin, digit-led and punctuation-heavy slug exactly as VitePress makes it", () => {
    for (const s of ["Getting Started", "Café Déjà vu", "1. Introduction", "  --Mixed__case!!  ", "API: `invoke()` & friends"]) {
      expect(slugify(s), s).toBe(vitepressSlugify(s));
    }
    expect(slugify("Café Déjà vu")).toBe("cafe-deja-vu");
    expect(slugify("1. Introduction")).toBe("_1-introduction");
    expect(slugify("a\\b")).toBe("a-b");
  });

  it("differs from upstream ONLY by the final NFC step", () => {
    for (const s of CORPUS) expect(slugify(s), s).toBe(vitepressSlugify(s).normalize("NFC"));
  });
});

describe("the vendored copy matches the installed vitepress", () => {
  it("agrees with the slugify bundled in node_modules/vitepress on every corpus string", () => {
    const dist = join(dirname(requireFromSite.resolve("vitepress/package.json")), "dist/node");
    const source = readdirSync(dist).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(dist, f), "utf8"))
      .find((text) => text.includes("const slugify = (str) =>"));
    expect(source, "vitepress no longer bundles `const slugify = (str) =>` — re-vendor config/slugify.ts from the new release").toBeDefined();
    const grab = (name: string) => {
      const m = new RegExp(`const ${name} = (.+);\\n`).exec(source!);
      expect(m, `upstream ${name} not found`).not.toBeNull();
      return m![1];
    };
    // Evaluating the upstream function TEXT is the point of a parity pin.
    const upstream = new Function("rControl", "rSpecial", "rCombining", `return ${grab("slugify")};`)(
      new Function(`return ${grab("rControl")}`)(), new Function(`return ${grab("rSpecial")}`)(), new Function(`return ${grab("rCombining")}`)(),
    ) as (s: string) => string;
    for (const s of CORPUS) expect(vitepressSlugify(s), s).toBe(upstream(s));
  });
});

describe("anchors, permalinks and the table of contents agree", () => {
  it("renders the same NFC id for the heading, its permalink and its TOC entry, and suffixes a duplicate", async () => {
    const vitepress = await import(pathToFileURL(requireFromSite.resolve("vitepress")).href);
    const md = await vitepress.createMarkdownRenderer(WEBSITE, { anchor: { slugify } });
    const html: string = md.render("[[toc]]\n\n## 한국어 제목\n\n## 한국어 제목\n\n## Café\n");
    const ids = [...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["한국어-제목", "한국어-제목-1", "cafe"]);
    for (const id of ids) {
      expect(html).toContain(`class="header-anchor" href="#${id}"`);
      expect(html).toContain(`<a href="#${id}">`);
    }
  });
});
