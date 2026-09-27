// @vitest-environment node
// WI-LX1.4 — the capture-on-save setting, read at the moment of each write and
// mapped onto the kernel's wire vocabulary (`coherence/capture_policy.rs`).

import { beforeEach, describe, expect, it } from "vitest";
import { currentCapturePolicy } from "./capturePolicy";
import { useSettingsStore } from "@/stores/settingsStore";

function setCaptureOnSave(on: boolean) {
  useSettingsStore.getState().updateGeneralSetting("coherenceCaptureOnSave", on);
}

beforeEach(() => setCaptureOnSave(false));

describe("currentCapturePolicy", () => {
  it("ships tracked-only: the setting defaults off", () => {
    expect(currentCapturePolicy()).toBe("tracked-only");
  });

  it("is adopt while the setting is on", () => {
    setCaptureOnSave(true);
    expect(currentCapturePolicy()).toBe("adopt");
  });

  it("reads the store on every call, so a toggle applies to the very next write", () => {
    setCaptureOnSave(true);
    expect(currentCapturePolicy()).toBe("adopt");
    setCaptureOnSave(false);
    expect(currentCapturePolicy()).toBe("tracked-only");
  });
});
