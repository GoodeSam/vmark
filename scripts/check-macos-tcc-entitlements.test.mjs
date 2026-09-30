/**
 * The macOS app bundle must declare the privacy-protected resources that
 * programs run in its integrated terminal ask for, and the MCP sidecar must not.
 *
 * VMark ships with the Hardened Runtime, and macOS treats the app as the
 * "responsible process" for everything its terminal spawns. A resource the app
 * never declared is denied WITHOUT a prompt: FFmpeg recording from VMark's
 * terminal wrote all-zero samples and TCC logged the denial against `app.vmark`
 * (#1483). The same held for the camera and for Apple Events (`osascript`), so
 * the app declares all three — the subset of what iTerm2 and Ghostty declare
 * that terminal programs realistically use.
 *
 * Each entitlement needs its usage description in Info.plist as well: with the
 * entitlement but no description, macOS terminates the process on first access
 * instead of asking the user.
 *
 * The sidecar (`vmark-mcp-server`) opens no device and scripts no app. The
 * Tauri bundler re-signs every `externalBin` with the app's entitlements
 * (crates/tauri-bundler `macos/app.rs`, `sign.rs`), but copies
 * `bundle.macOS.files` without signing and signs the app without `--deep`. So
 * the macOS release passes src-tauri/tauri.macos-release.conf.json, which
 * places the sidecar release.yml pre-signed with sidecar-entitlements.plist.
 * This file pins that wiring; scripts/verify-macos-bundle-entitlements.sh checks
 * the signed artifact itself, in release.yml before publishing and in
 * release-smoke.yml after.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** Keys whose value is `<true/>` in a flat plist dict. */
function trueKeys(xml) {
  const plain = xml.replace(/<!--[\s\S]*?-->/g, "");
  return [...plain.matchAll(/<key>([^<]+)<\/key>\s*<true\s*\/>/g)].map((m) => m[1]);
}

/** Keys whose value is a non-empty `<string>` in a flat plist dict. */
function stringKeys(xml) {
  const plain = xml.replace(/<!--[\s\S]*?-->/g, "");
  return [...plain.matchAll(/<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g)]
    .filter((m) => m[2].trim() !== "")
    .map((m) => m[1]);
}

/** Resource entitlement → the Info.plist usage description macOS requires with it. */
const TCC_RESOURCES = {
  "com.apple.security.device.audio-input": "NSMicrophoneUsageDescription",
  "com.apple.security.device.camera": "NSCameraUsageDescription",
  "com.apple.security.automation.apple-events": "NSAppleEventsUsageDescription",
};

/** Code-signing exceptions V8 needs, on both the app and the sidecar. */
const RUNTIME_EXCEPTIONS = [
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.disable-library-validation",
];

const PRIVACY_PREFIXES = [
  "com.apple.security.device.",
  "com.apple.security.automation.",
  "com.apple.security.personal-information.",
];
const isPrivacy = (k) => PRIVACY_PREFIXES.some((p) => k.startsWith(p));

const OVERLAY = "src-tauri/tauri.macos-release.conf.json";
const STAGED = "binaries/macos-release/vmark-mcp-server";

const tauriConf = JSON.parse(read("src-tauri/tauri.conf.json"));
const appEntitlementsPath = tauriConf.bundle?.macOS?.entitlements;

/** The build-tauri job's steps, parsed — so a commented-out step does not count. */
const buildSteps = parseYaml(read(".github/workflows/release.yml")).jobs["build-tauri"].steps;
const stepIndex = (name) => {
  const i = buildSteps.findIndex((s) => s.name === name);
  expect(i, `release.yml build-tauri has no step named "${name}"`).toBeGreaterThanOrEqual(0);
  return i;
};
const step = (name) => buildSteps[stepIndex(name)];

describe("macOS TCC declarations for the integrated terminal", () => {
  it("signs the app bundle with its own entitlements file, not the sidecar's", () => {
    expect(appEntitlementsPath).toBe("app-entitlements.plist");
  });

  it("declares every terminal-facing resource on the app, with its usage description", () => {
    const app = trueKeys(read(join("src-tauri", appEntitlementsPath)));
    const described = stringKeys(read("src-tauri/Info.plist"));
    for (const [entitlement, description] of Object.entries(TCC_RESOURCES)) {
      expect(app, `app entitlements lack ${entitlement}`).toContain(entitlement);
      expect(described, `${entitlement} needs a non-empty ${description} in Info.plist`).toContain(description);
    }
  });

  it("gives the app exactly these privacy entitlements, plus the runtime exceptions", () => {
    const app = trueKeys(read(join("src-tauri", appEntitlementsPath)));
    expect(app.filter(isPrivacy).sort()).toEqual(Object.keys(TCC_RESOURCES).sort());
    for (const key of RUNTIME_EXCEPTIONS) expect(app).toContain(key);
  });

  it("keeps the sidecar's own entitlements to the runtime exceptions", () => {
    const sidecar = trueKeys(read("src-tauri/sidecar-entitlements.plist"));
    expect(sidecar.filter(isPrivacy)).toEqual([]);
    for (const key of RUNTIME_EXCEPTIONS) expect(sidecar).toContain(key);
  });
});

describe("the macOS release ships the sidecar with its own signature", () => {
  it("keeps externalBin for dev, Windows and Linux", () => {
    expect(tauriConf.bundle.externalBin).toContain("binaries/vmark-mcp-server");
  });

  it("the release overlay drops externalBin and places the pre-signed sidecar via files", () => {
    const overlay = JSON.parse(read(OVERLAY));
    expect(overlay.bundle.externalBin).toEqual([]);
    expect(overlay.bundle.macOS.files).toEqual({ "MacOS/vmark-mcp-server": STAGED });
  });

  it("resolves the layout from the checked-out tree, on macOS, right after checkout", () => {
    const layout = step("Resolve macOS bundle layout");
    expect(layout.id).toBe("layout");
    expect(layout.if).toBe("matrix.platform == 'macos-latest'");
    expect(stepIndex("Resolve macOS bundle layout")).toBe(stepIndex("Checkout") + 1);
    expect(layout.run).toContain(`OVERLAY=${OVERLAY}`);
    expect(layout.run).toContain("VERIFIER=scripts/verify-macos-bundle-entitlements.sh");
    expect(layout.run).toContain('echo "config=--config $OVERLAY" >> "$GITHUB_OUTPUT"');
  });

  it("passes the layout config to the build before the matrix's --target", () => {
    expect(step("Build Tauri app").with.args).toBe("${{ steps.layout.outputs.config }} ${{ matrix.args }}");
  });

  it("signs the sidecar with sidecar-entitlements.plist and stages it where the overlay reads it", () => {
    const sign = step("Sign sidecar with JIT entitlements (macOS)");
    expect(sign.run).toContain("--entitlements src-tauri/sidecar-entitlements.plist");
    expect(sign.run).toContain(`cp "$SIDECAR_PATH" src-tauri/${STAGED}`);
    expect(stepIndex("Sign sidecar with JIT entitlements (macOS)")).toBeLessThan(stepIndex("Build Tauri app"));
  });

  it("verifies the signed bundle after the build and before the DMG is notarized", () => {
    const verify = step("Verify bundle entitlements (macOS)");
    expect(verify.if).toBe("matrix.platform == 'macos-latest' && steps.layout.outputs.verify == 'true'");
    const commands = verify.run.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    expect(commands).toContain('scripts/verify-macos-bundle-entitlements.sh "src-tauri/target/$TARGET/release/bundle/macos/VMark.app"');
    const at = stepIndex("Verify bundle entitlements (macOS)");
    expect(at).toBeGreaterThan(stepIndex("Build Tauri app"));
    expect(at).toBeLessThan(stepIndex("Notarize and staple DMG (macOS)"));
  });
});

/** App locale (src/locales) → the macOS .lproj that localizes Info.plist for it. */
const LPROJ = { en: "en", de: "de", es: "es", fr: "fr", it: "it", ja: "ja", ko: "ko", "pt-BR": "pt-BR", "zh-CN": "zh-Hans", "zh-TW": "zh-Hant" };

/** `"key" = "value";` pairs of an .strings file. */
function stringsPairs(text) {
  return Object.fromEntries([...text.matchAll(/^"([^"]+)"\s*=\s*"((?:[^"\\]|\\.)*)";\s*$/gm)].map((m) => [m[1], m[2]]));
}

describe("the permission prompts are localized like the app", () => {
  const appLocales = readdirSync(join(ROOT, "src/locales"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("__"))
    .map((d) => d.name)
    .sort();
  const files = tauriConf.bundle.macOS.files;

  it("maps every app locale to an lproj", () => {
    expect(appLocales).toEqual(Object.keys(LPROJ).sort());
  });

  it.each(Object.entries(LPROJ))("%s: bundles InfoPlist.strings with all three descriptions", (_locale, lproj) => {
    const source = files[`Resources/${lproj}.lproj/InfoPlist.strings`];
    expect(source, `bundle.macOS.files lacks Resources/${lproj}.lproj/InfoPlist.strings`).toBeTruthy();
    const pairs = stringsPairs(read(join("src-tauri", source)));
    for (const description of Object.values(TCC_RESOURCES)) {
      expect(pairs[description]?.trim(), `${lproj}: ${description}`).toBeTruthy();
    }
  });

  it("the English strings match Info.plist word for word", () => {
    const plist = read("src-tauri/Info.plist").replace(/<!--[\s\S]*?-->/g, "");
    const en = stringsPairs(read(join("src-tauri", files["Resources/en.lproj/InfoPlist.strings"])));
    for (const description of Object.values(TCC_RESOURCES)) {
      const m = plist.match(new RegExp(`<key>${description}</key>\\s*<string>([^<]*)</string>`));
      expect(en[description]).toBe(m[1].replace(/&apos;/g, "'"));
    }
  });
});
