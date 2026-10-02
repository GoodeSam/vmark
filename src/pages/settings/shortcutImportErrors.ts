/**
 * Purpose: turn a shortcut-import problem code into a sentence in the UI
 * language. The shortcuts store reports codes because a store has no `t()`;
 * the settings page, which shows them, translates them here.
 *
 * @coordinates-with stores/settingsStore/shortcuts.ts — ShortcutImportError
 * @coordinates-with ShortcutsSettings.tsx — the import toast
 * @module pages/settings/shortcutImportErrors
 */
import i18n from "@/i18n";
import type { ShortcutImportError } from "@/stores/settingsStore/shortcuts";

/** One translated line for one import problem. */
export function describeShortcutImportError(error: ShortcutImportError): string {
  switch (error.code) {
    case "invalidFormat":
      return i18n.t("settings:shortcuts.importErrorInvalidFormat");
    case "invalidKey":
      return i18n.t("settings:shortcuts.importErrorInvalidKey", { id: error.id });
    case "unknownShortcut":
      return i18n.t("settings:shortcuts.importErrorUnknownShortcut", { id: error.id });
    case "parse":
      return i18n.t("settings:shortcuts.importErrorParse", { detail: error.detail });
  }
}
