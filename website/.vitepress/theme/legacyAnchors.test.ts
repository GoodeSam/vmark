// @vitest-environment node
import { describe, it, expect } from "vitest";
import { legacyFragmentTarget } from "./legacyAnchors";

const composed = "한국어-제목";
const legacy = composed.normalize("NFD"); // what the pre-NFC slugifier emitted
const page = new Set([composed, "cafe", "がぎぐ"]);
const hasId = (id: string) => page.has(id);

describe("legacyFragmentTarget", () => {
  it("sends a decomposed Hangul fragment, percent-encoded as a browser keeps it, to the composed heading", () => {
    expect(legacyFragmentTarget(`#${encodeURIComponent(legacy)}`, hasId)).toBe(composed);
    expect(legacyFragmentTarget(`#${legacy}`, hasId)).toBe(composed);
  });

  it("sends a decomposed voiced-kana fragment to its composed heading", () => {
    expect(legacyFragmentTarget(`#${encodeURIComponent("がぎぐ".normalize("NFD"))}`, hasId)).toBe("がぎぐ");
  });

  it.each([
    ["no fragment", ""],
    ["a bare #", "#"],
    ["a fragment that already matches", "#cafe"],
    ["a fragment that matches nothing either way", `#${encodeURIComponent("없는-제목".normalize("NFD"))}`],
    ["a malformed percent-escape", "#%E0%A4%A"],
  ])("does nothing for %s", (_label, hash) => {
    expect(legacyFragmentTarget(hash, hasId)).toBeNull();
  });
});
