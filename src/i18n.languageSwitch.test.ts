// WI-RA21.4 — the last requested language wins.
//
// src/i18n.ts follows `general.language` in the settings store. It skipped a
// request equal to the last COMMITTED language, so switching away and straight
// back — "ja", then "en" while Japanese was still loading — dropped the second
// request: Japanese finished loading and the UI stayed Japanese while the
// setting said English.
//
// The real i18n module (unmocked here) and the real i18next; the settings
// store is a stand-in whose subscribers the test drives, as the global setup
// mocks the store's dependencies.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("@/i18n");

type Listener = (state: { general: { language: string } }) => void;
const settings = vi.hoisted(() => ({ listeners: [] as Listener[] }));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ general: { language: "en" } }),
    subscribe: (listener: Listener) => {
      settings.listeners.push(listener);
      return () => undefined;
    },
  },
}));

/** The user picks `language` in Settings. */
function choose(language: string): void {
  for (const listener of settings.listeners) listener({ general: { language } });
}

async function loadI18n() {
  vi.resetModules();
  settings.listeners.length = 0;
  // i18next is one instance per process (a node_modules singleton that module
  // resets do not re-evaluate): start every case from English, as the
  // stand-in settings store says.
  const { default: i18next } = await import("i18next");
  if (i18next.isInitialized) await i18next.changeLanguage("en");
  const { default: i18n } = await import("./i18n");
  const changes = vi.spyOn(i18n, "changeLanguage");
  /** Wait for every switch requested so far to settle. */
  const settled = async () => {
    await Promise.allSettled(changes.mock.results.map((r) => r.value as Promise<unknown>));
  };
  return { i18n, changes, settled };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("i18n follows the last requested language", () => {
  it("switching back to the current language while another is loading lands on the current one", async () => {
    const { i18n, settled } = await loadI18n();
    expect(i18n.language).toBe("en");

    choose("ja"); // starts loading Japanese
    choose("en"); // back before it finishes
    await settled();

    expect(i18n.language).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("the last of several rapid switches wins", async () => {
    const { i18n, settled } = await loadI18n();

    choose("ja");
    choose("zh-CN");
    choose("de");
    await settled();

    expect(i18n.language).toBe("de");
  });

  it("a repeated emission of the same language does not request it twice", async () => {
    const { changes, settled } = await loadI18n();

    choose("ko");
    choose("ko");
    await settled();

    expect(changes.mock.calls.map((c) => c[0])).toEqual(["ko"]);
  });

  it("a switch that failed is retried by the next settings emission", async () => {
    const { changes, settled } = await loadI18n();
    changes.mockRejectedValueOnce(new Error("Missing locale: ./locales/ja/common.json"));

    choose("ja");
    await settled();
    choose("ja"); // any later write to settings re-emits the same language

    expect(changes.mock.calls.map((c) => c[0])).toEqual(["ja", "ja"]);
    await settled();
  });

  it("an unchanged language triggers no switch at all", async () => {
    const { changes } = await loadI18n();

    choose("en");

    expect(changes).not.toHaveBeenCalled();
  });
});
