/**
 * The user-facing sentences of a folder export that could not finish.
 *
 * Purpose: every refusal and rollback report the lock, staging and publish
 * modules throw ends up as the DETAIL line of the export-failed dialog, so it
 * is user-facing copy and goes through i18n like any other string. It used to
 * be composed in English inside those three modules, which left a translated
 * dialog carrying an English sentence. Gathering the lookups here keeps the
 * transaction modules about the filesystem, and keeps every key in one place.
 *
 * Key decisions:
 *   - Paths are PARAMETERS, never spliced into the prose, so each language can
 *     put the path where its grammar wants it.
 *   - A nested message (the rollback outcome inside the publish failure, a
 *     "kept at" note inside the not-restored list) is resolved first and passed
 *     in as a parameter; the outer sentence does not know its inner wording.
 *   - A bare `path (reason)` entry has no words to translate and stays
 *     structural in `exportPublish.ts`.
 *
 * @coordinates-with src/export/exportLock.ts — lockBusy
 * @coordinates-with src/export/exportStaging.ts — takenOver
 * @coordinates-with src/export/exportPublish.ts — the publish and rollback messages
 * @coordinates-with src/locales/en/dialog.json — the `exportError.*` keys
 * @module export/exportErrorMessages
 */

import i18n from "@/i18n";

/** Another window holds the folder's lock and never released it. */
export const lockBusyMessage = (destination: string, lock: string): string =>
  i18n.t("dialog:exportError.lockBusy", { destination, lock });

/** This export's lock was taken over while it ran, so it did not publish. */
export const takenOverMessage = (destination: string): string =>
  i18n.t("dialog:exportError.takenOver", { destination });

/** A directory sits where the export wants to write a file. */
export const notAFileMessage = (path: string): string =>
  i18n.t("dialog:exportError.notAFile", { path });

/** The publish failed; `rollback` is one of the three rollback outcomes below. */
export const publishFailedMessage = (destination: string, reason: string, rollback: string): string =>
  i18n.t("dialog:exportError.publishFailed", { destination, reason, rollback });

/** Rollback outcome: some files could not be put back. `files` is a joined list. */
export const filesNotRestoredMessage = (files: string): string =>
  i18n.t("dialog:exportError.rollbackFilesNotRestored", { files });

/** Rollback outcome: every file went back, but created folders remain. */
export const foldersLeftMessage = (folders: string): string =>
  i18n.t("dialog:exportError.rollbackFoldersLeft", { folders });

/** Rollback outcome: the folder is exactly as it was. */
export const restoredMessage = (): string => i18n.t("dialog:exportError.rollbackRestored");

/** One not-restored entry whose previous contents still exist at `backup`. */
export const backupKeptAtMessage = (path: string, backup: string, reason: string): string =>
  i18n.t("dialog:exportError.backupKeptAt", { path, backup, reason });

/** One not-restored entry whose backup has disappeared as well. */
export const backupGoneMessage = (path: string, backup: string, reason: string): string =>
  i18n.t("dialog:exportError.backupGone", { path, backup, reason });
