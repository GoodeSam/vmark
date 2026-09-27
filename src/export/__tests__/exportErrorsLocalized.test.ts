// @vitest-environment node
// The export-folder errors are the DETAIL line of the export-failed dialog, so
// they are user-facing copy and must go through i18n like every other string.
// They used to be composed in English inside the lock, publish and staging
// modules, which left a translated dialog with an English sentence in it.
//
// `@/i18n` is replaced by a marker `t` here: a message that still builds its
// prose in English never contains the marker, so each case fails until the
// sentence is looked up by key — with the paths passed as parameters rather
// than spliced into the prose.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { dirs, fail, files, resetFs } from "./exportFsHarness";

const t = vi.hoisted(() =>
  vi.fn((key: string, opts?: Record<string, unknown>) => `⟦${key}⟧${opts ? JSON.stringify(opts) : ""}`),
);

vi.mock("@/i18n", () => ({ default: { t } }));
vi.mock("@tauri-apps/plugin-fs", async () => (await import("./exportFsHarness")).createFsMock());
vi.mock("@/utils/debug", () => ({ exportWarn: vi.fn() }));

import { openStage, EXPORT_LOCK_NAME, EXPORT_LOCK_WAIT_MS } from "../exportStaging";

const DEST = "/users/me/Report";
const LOCK = `${DEST}/${EXPORT_LOCK_NAME}`;

const stageFile = (root: string, relative: string, content = `staged ${relative}`) => {
  const path = `${root}/${relative}`;
  dirs.add(path.slice(0, path.lastIndexOf("/")));
  files.set(path, content);
};

/** The message a rejected promise carries, or null if it resolved. */
const rejection = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: Error) => e.message,
  );

/** The params `t` was last called with for `key`. */
const paramsFor = (key: string) => {
  const call = [...t.mock.calls].reverse().find(([k]) => k === key);
  expect(call, `t("${key}") was never called`).toBeDefined();
  return call![1] as Record<string, unknown>;
};

beforeEach(() => {
  resetFs();
  t.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("export-folder errors are localized", () => {
  it("the lock-busy refusal names the folder and the lock file through i18n", async () => {
    vi.useFakeTimers();
    dirs.add(DEST);
    files.set(LOCK, JSON.stringify({ acquiredAt: Date.now(), owner: "another-window" }));

    const outcome = rejection(openStage(DEST));
    await vi.advanceTimersByTimeAsync(EXPORT_LOCK_WAIT_MS + 1_000);

    expect(await outcome).toContain("⟦dialog:exportError.lockBusy⟧");
    expect(paramsFor("dialog:exportError.lockBusy")).toEqual({ destination: DEST, lock: LOCK });
  });

  it("the takeover refusal is localized", async () => {
    dirs.add(DEST);
    const stage = await openStage(DEST);
    stageFile(stage.root, "index.html");
    stage.track("index.html");
    files.set(LOCK, JSON.stringify({ acquiredAt: Date.now(), owner: "another-window" }));

    expect(await rejection(stage.publish())).toContain("⟦dialog:exportError.takenOver⟧");
    expect(paramsFor("dialog:exportError.takenOver")).toEqual({ destination: DEST });
  });

  it("a directory in the way, and the restored folder, are both localized", async () => {
    dirs.add(DEST);
    dirs.add(`${DEST}/index.html`);
    const stage = await openStage(DEST);
    stageFile(stage.root, "index.html");
    stage.track("index.html");

    const message = await rejection(stage.publish());

    expect(message).toContain("⟦dialog:exportError.publishFailed⟧");
    const params = paramsFor("dialog:exportError.publishFailed");
    expect(params.destination).toBe(DEST);
    expect(params.reason).toContain("⟦dialog:exportError.notAFile⟧");
    expect(params.rollback).toContain("⟦dialog:exportError.rollbackRestored⟧");
    expect(paramsFor("dialog:exportError.notAFile")).toEqual({ path: `${DEST}/index.html` });
  });

  it("a backup kept aside is named through i18n, inside the not-restored list", async () => {
    dirs.add(DEST);
    files.set(`${DEST}/index.html`, "old index");
    const stage = await openStage(DEST);
    for (const rel of ["index.html", "standalone.html"]) {
      stageFile(stage.root, rel);
      stage.track(rel);
    }
    fail.renameTo = `${DEST}/standalone.html`;
    fail.copyTo = `${DEST}/index.html`;
    const { rename } = await import("@tauri-apps/plugin-fs");
    const real = vi.mocked(rename).getMockImplementation()!;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(from).includes("/.replaced/index.html")) throw new Error("EACCES restore");
      return real(from, to);
    });

    const message = await rejection(stage.publish());
    vi.mocked(rename).mockImplementation(real);

    expect(message).toContain("⟦dialog:exportError.rollbackFilesNotRestored⟧");
    expect(String(paramsFor("dialog:exportError.rollbackFilesNotRestored").files)).toContain(
      "⟦dialog:exportError.backupKeptAt⟧",
    );
    expect(paramsFor("dialog:exportError.backupKeptAt")).toMatchObject({
      path: `${DEST}/index.html`,
      backup: `${stage.root}/.replaced/index.html`,
    });
  });

  it("a backup that is gone too is named through i18n", async () => {
    dirs.add(DEST);
    files.set(`${DEST}/index.html`, "old index");
    const stage = await openStage(DEST);
    for (const rel of ["index.html", "standalone.html"]) {
      stageFile(stage.root, rel);
      stage.track(rel);
    }
    fail.renameTo = `${DEST}/standalone.html`;
    const backup = `${stage.root}/.replaced/index.html`;
    const { rename } = await import("@tauri-apps/plugin-fs");
    const real = vi.mocked(rename).getMockImplementation()!;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(to) === `${DEST}/standalone.html`) files.delete(backup);
      return real(from, to);
    });

    await rejection(stage.publish());
    vi.mocked(rename).mockImplementation(real);

    expect(paramsFor("dialog:exportError.backupGone")).toMatchObject({
      path: `${DEST}/index.html`,
      backup,
    });
  });

  it("folders left behind are named through i18n", async () => {
    dirs.add(DEST);
    const stage = await openStage(DEST);
    for (const rel of ["assets/x.css", "index.html"]) {
      stageFile(stage.root, rel);
      stage.track(rel);
    }
    fail.renameTo = `${DEST}/index.html`;
    fail.removeOf = `${DEST}/assets`;

    await rejection(stage.publish());

    expect(paramsFor("dialog:exportError.rollbackFoldersLeft")).toEqual({ folders: `${DEST}/assets` });
  });
});
