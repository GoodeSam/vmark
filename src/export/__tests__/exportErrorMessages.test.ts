// @vitest-environment node
// The RENDERED export-folder error sentences, in real locale bundles.
//
// `exportErrorsLocalized.test.ts` proves every sentence goes through i18n, but
// it does so with a marker `t`, which cannot see what the user actually reads.
// Two defects lived in that gap: a nested reason that already ends with a full
// stop was followed by the template's own separator (`..` in English, `。。`
// in Chinese), and file lists were joined with a hardcoded English `", "`.
// Here `t` interpolates the SHIPPED dialog bundles, so the assertions are about
// the exact text.
import { describe, it, expect, vi, beforeEach } from "vitest";

import en from "@/locales/en/dialog.json";
import zhCN from "@/locales/zh-CN/dialog.json";
import ja from "@/locales/ja/dialog.json";

const bundles: Record<string, Record<string, string>> = { en, "zh-CN": zhCN, ja };

const i18n = vi.hoisted(() => ({
  language: "en",
  t: (_key: string, _opts?: Record<string, unknown>): string => "",
}));

vi.mock("@/i18n", () => ({ default: i18n }));

import {
  filesNotRestoredMessage,
  foldersLeftMessage,
  notAFileMessage,
  publishFailedMessage,
  restoredMessage,
} from "../exportErrorMessages";

function useLocale(lang: string): void {
  i18n.language = lang;
  i18n.t = (key: string, opts?: Record<string, unknown>) => {
    const local = key.replace(/^dialog:/, "");
    const template = bundles[lang][local];
    if (template === undefined) throw new Error(`missing ${lang} key ${local}`);
    return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts?.[name]));
  };
}

beforeEach(() => useLocale("en"));

describe("publish failure with a nested sentence as its reason", () => {
  it("English: a reason that ends with a full stop is not followed by a second one", () => {
    const text = publishFailedMessage("/out", notAFileMessage("/out/index.html"), restoredMessage());
    expect(text).not.toMatch(/\.\s*\./);
    expect(text).toBe(
      "Export to /out could not be published: /out/index.html is a directory, not a file this export may replace. " +
        "Move or rename it, or export to a different folder. " +
        "Nothing else was changed — the folder was restored to its previous contents.",
    );
  });

  it("English: an OS reason without a full stop still gets exactly one", () => {
    const text = publishFailedMessage("/out", "EACCES: permission denied", restoredMessage());
    expect(text).toContain("EACCES: permission denied. Nothing else");
  });

  it.each(["zh-CN", "ja"])("%s: no doubled 。 after a nested sentence", (lang) => {
    useLocale(lang);
    const text = publishFailedMessage("/out", notAFileMessage("/out/index.html"), restoredMessage());
    expect(text).not.toContain("。。");
    expect(text).toContain(notAFileMessage("/out/index.html"));
  });
});

describe("rollback lists are formatted for the locale", () => {
  const entries = ["/out/a, b.html (EACCES, locked)", "/out/c.html (EBUSY)", "/out/d.html (ENOENT)"];

  it("English: every entry is quoted, so a comma INSIDE an entry cannot read as a separator", () => {
    expect(filesNotRestoredMessage(entries)).toBe(
      "These files could not be restored: “/out/a, b.html (EACCES, locked)”, “/out/c.html (EBUSY)”, and “/out/d.html (ENOENT)”.",
    );
  });

  it("Chinese: quoted entries joined with the Chinese enumeration comma", () => {
    useLocale("zh-CN");
    const text = filesNotRestoredMessage(entries);
    expect(text).toContain("“/out/a, b.html (EACCES, locked)”、“/out/c.html (EBUSY)”");
    expect(text).not.toContain("”, “");
  });

  it("Japanese: corner-bracket quotes and 、", () => {
    useLocale("ja");
    expect(filesNotRestoredMessage(entries)).toContain(
      "「/out/a, b.html (EACCES, locked)」、「/out/c.html (EBUSY)」",
    );
  });

  it("a single entry is quoted too", () => {
    expect(foldersLeftMessage(["/out/assets"])).toBe(
      "Your files were restored, but these folders the export created are still there: “/out/assets”.",
    );
  });
});
