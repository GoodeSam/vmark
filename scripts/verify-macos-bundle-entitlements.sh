#!/usr/bin/env bash
# Verify the entitlements a built VMark.app actually carries — the signed
# artifact, not the plists that were meant to produce it.
#
# Usage: scripts/verify-macos-bundle-entitlements.sh <path/to/VMark.app>
#
# The app must declare the privacy resources that programs run in its
# integrated terminal ask for (microphone, camera, Apple Events; #1483), and the
# MCP sidecar at Contents/MacOS/vmark-mcp-server must carry none of them. The
# Tauri bundler re-signs every `externalBin` with the app's entitlements, so the
# macOS release ships the sidecar through `bundle.macOS.files` instead
# (src-tauri/tauri.macos-release.conf.json), keeping the signature release.yml
# gave it with src-tauri/sidecar-entitlements.plist. A change that brought back
# the re-sign would look identical to success; this is what notices.
#
# Fails closed: a missing binary, an unreadable signature or any mismatch exits 1.
set -euo pipefail

APP="${1:?usage: $0 <path/to/VMark.app>}"
SIDECAR="$APP/Contents/MacOS/vmark-mcp-server"

fail() { echo "FAIL: $*" >&2; exit 1; }

[ -d "$APP" ] || fail "no app bundle at $APP"
[ -x "$SIDECAR" ] || fail "no executable sidecar at $SIDECAR"

# Keys set to true in a binary's signed entitlements, one per line.
entitlements() {
  local xml
  xml="$(codesign -d --entitlements - --xml "$1" 2>/dev/null)" || fail "cannot read the signature of $1"
  [ -n "$xml" ] || fail "$1 is signed without entitlements"
  printf '%s' "$xml" | plutil -convert json -o - - | /usr/bin/python3 -c \
    'import json,sys; print("\n".join(k for k,v in json.load(sys.stdin).items() if v is True))'
}

APP_KEYS="$(entitlements "$APP")"
SIDECAR_KEYS="$(entitlements "$SIDECAR")"

for key in \
  com.apple.security.device.audio-input \
  com.apple.security.device.camera \
  com.apple.security.automation.apple-events; do
  grep -qxF "$key" <<<"$APP_KEYS" || fail "app lacks $key"
done

for key in \
  com.apple.security.cs.allow-jit \
  com.apple.security.cs.allow-unsigned-executable-memory \
  com.apple.security.cs.disable-library-validation; do
  grep -qxF "$key" <<<"$APP_KEYS" || fail "app lacks $key"
  grep -qxF "$key" <<<"$SIDECAR_KEYS" || fail "sidecar lacks $key (V8 needs it)"
done

PRIVACY="$(grep -E '^com\.apple\.security\.(device|automation|personal-information)\.' <<<"$SIDECAR_KEYS" || true)"
[ -z "$PRIVACY" ] || fail "sidecar carries privacy entitlements it never uses: $(echo "$PRIVACY" | tr '\n' ' ')"

# Captured first: `codesign | grep -q` under pipefail fails whenever grep exits
# on its first match and codesign dies of SIGPIPE.
SIDECAR_SIG="$(codesign -dv "$SIDECAR" 2>&1)" || fail "cannot read the signature of $SIDECAR"
grep -q 'flags=.*runtime' <<<"$SIDECAR_SIG" || fail "sidecar is not signed with the hardened runtime"
codesign --verify --deep --strict "$APP" || fail "codesign --verify --deep --strict rejected $APP"

echo "OK: $APP — app declares microphone, camera and Apple Events; sidecar keeps only its runtime exceptions"
