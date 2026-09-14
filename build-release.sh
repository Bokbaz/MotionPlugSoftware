#!/bin/bash
# Build Motion Plug's public, runtime-only release artifacts.
#
#   ./build-release.sh             build the current version for this host
#   ./build-release.sh 0.3.1       synchronize all version sources, then build
#
# Targets:
#   MP_TARGET_PLATFORM=mac-universal  -> updater ZIP + per-user macOS PKG
#   MP_TARGET_PLATFORM=win-x64        -> updater ZIP + per-user Windows EXE
#
# The updater ZIP is platform-independent. Set MP_SKIP_UPDATE_ARCHIVE=1 when
# another CI job already owns the canonical ZIP/latest.json artifacts.

set -euo pipefail
cd "$(dirname "$0")"

NEW_VERSION="${1:-}"
if [ -n "$NEW_VERSION" ]; then
  node scripts/set-version.mjs "$NEW_VERSION"
fi

PACKAGE_VERSION="$(node -p "require('./package.json').version")"
MANIFEST_VERSION="$(sed -n 's/.*ExtensionBundleVersion="\([0-9.]*\)".*/\1/p' CSXS/manifest.xml | head -1)"
PANEL_VERSION="$(sed -n 's/.*<Extension Id="com.motionplug.panel" Version="\([0-9.]*\)".*/\1/p' CSXS/manifest.xml | head -1)"
RUNTIME_VERSION="$(sed -n "s/.*MP_VERSION = '\([0-9.]*\)'.*/\1/p" plugin/version.js | head -1)"
if [ "$PACKAGE_VERSION" != "$MANIFEST_VERSION" ] || [ "$PACKAGE_VERSION" != "$PANEL_VERSION" ] || [ "$PACKAGE_VERSION" != "$RUNTIME_VERSION" ]; then
  echo "Version mismatch: package=$PACKAGE_VERSION bundle=$MANIFEST_VERSION panel=$PANEL_VERSION runtime=$RUNTIME_VERSION" >&2
  echo "Run: npm run version:set -- $PACKAGE_VERSION" >&2
  exit 1
fi
VERSION="$PACKAGE_VERSION"

detect_target_platform() {
  case "$(uname -s):$(uname -m)" in
    Darwin:arm64|Darwin:x86_64) echo "mac-universal" ;;
    MINGW*:x86_64|MSYS*:x86_64|CYGWIN*:x86_64) echo "win-x64" ;;
    *) return 1 ;;
  esac
}

TARGET_PLATFORM="${MP_TARGET_PLATFORM:-$(detect_target_platform || true)}"
case "$TARGET_PLATFORM" in
  mac-universal|win-x64) ;;
  *)
    echo "Unsupported release target: ${TARGET_PLATFORM:-unknown}" >&2
    echo "Set MP_TARGET_PLATFORM to mac-universal or win-x64." >&2
    exit 1
    ;;
esac

if [ "${MP_SKIP_VERIFY:-0}" != "1" ]; then
  npm run typecheck
  npm test
fi
npm run build
npm run validate

WORK="$(mktemp -d "${TMPDIR:-/tmp}/motionplug-release.XXXXXX")"
cleanup() {
  if [ -n "${WORK:-}" ] && [ -d "$WORK" ]; then rm -rf "$WORK"; fi
}
trap cleanup EXIT

PAYLOAD="$WORK/MotionPlug"
ARTIFACTS="$(pwd)/release"
mkdir -p "$PAYLOAD" "$ARTIFACTS"
COPYFILE_DISABLE=1 cp -R dist/. "$PAYLOAD/"
find "$PAYLOAD" -type f \( -name '.DS_Store' -o -name '._*' -o -name '.gitkeep' \) -delete
if command -v xattr >/dev/null 2>&1; then xattr -cr "$PAYLOAD"; fi

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

if [ "${MP_SKIP_UPDATE_ARCHIVE:-0}" != "1" ]; then
  ZIP_OUT="$ARTIFACTS/MotionPlug-v$VERSION.zip"
  rm -f "$ZIP_OUT"
  (cd "$WORK" && zip -r -q -X "$ZIP_OUT" MotionPlug -x '*.DS_Store')
  ZIP_SHA256="$(sha256_file "$ZIP_OUT")"
  # Reference manifest. The live feed is served from Supabase by the website
  # (/api/motion-plug/latest); this file documents the same release and backs
  # the localhost feed-testing flow in RELEASING.md. Set MP_UPDATE_ARCHIVE_URL
  # to point a test feed at a specific archive instead.
  UPDATE_ARCHIVE_URL="${MP_UPDATE_ARCHIVE_URL:-https://www.captionplug.com/api/motion-plug/download}"
  cat > "$ARTIFACTS/latest.json" <<EOF
{
  "version": "$VERSION",
  "notes": "See the Motion Plug $VERSION release notes for details.",
  "url": "$UPDATE_ARCHIVE_URL",
  "sha256": "$ZIP_SHA256"
}
EOF
  printf '%s  %s\n' "$ZIP_SHA256" "MotionPlug-v$VERSION.zip" > "$ZIP_OUT.sha256"
  echo "Built $ZIP_OUT"
  node scripts/smoke-release-update.mjs
fi

if [ "$TARGET_PLATFORM" = "mac-universal" ]; then
  if ! command -v pkgbuild >/dev/null 2>&1 || ! command -v productbuild >/dev/null 2>&1; then
    echo "pkgbuild/productbuild are required for the macOS installer." >&2
    exit 1
  fi
  PKG_OUT="$ARTIFACTS/MotionPlug-v$VERSION-mac-universal.pkg"
  rm -f "$PKG_OUT"
  chmod +x installer/macos/scripts/preinstall installer/macos/scripts/postinstall
  pkgbuild --quiet \
    --root "$PAYLOAD" \
    --identifier com.motionplug.panel \
    --version "$VERSION" \
    --install-location "/Library/Application Support/Adobe/CEP/extensions/MotionPlug" \
    --scripts installer/macos/scripts \
    "$WORK/component.pkg"

  RESOURCES="$WORK/resources"
  mkdir -p "$RESOURCES"
  cp installer/macos/resources/welcome.html installer/macos/resources/conclusion.html "$RESOURCES/"
  cat > "$WORK/distribution.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>Motion Plug $VERSION</title>
  <welcome file="welcome.html"/>
  <conclusion file="conclusion.html"/>
  <domains enable_anywhere="false" enable_currentUserHome="true" enable_localSystem="false"/>
  <options customize="never" require-scripts="false" hostArchitectures="arm64,x86_64"/>
  <choices-outline><line choice="panel"/></choices-outline>
  <choice id="panel" visible="false" title="Motion Plug"><pkg-ref id="com.motionplug.panel"/></choice>
  <pkg-ref id="com.motionplug.panel" version="$VERSION" onConclusion="none">component.pkg</pkg-ref>
</installer-gui-script>
EOF

  if [ -n "${MP_MAC_INSTALLER_IDENTITY:-}" ]; then
    echo "Signing macOS installer with: $MP_MAC_INSTALLER_IDENTITY"
    productbuild --quiet \
      --distribution "$WORK/distribution.xml" \
      --resources "$RESOURCES" \
      --package-path "$WORK" \
      --sign "$MP_MAC_INSTALLER_IDENTITY" \
      "$PKG_OUT"
  else
    productbuild --quiet \
      --distribution "$WORK/distribution.xml" \
      --resources "$RESOURCES" \
      --package-path "$WORK" \
      "$PKG_OUT"
  fi
  echo "Built $PKG_OUT"

  if [ -n "${MP_NOTARY_PROFILE:-}" ]; then
    if [ -z "${MP_MAC_INSTALLER_IDENTITY:-}" ]; then
      echo "MP_NOTARY_PROFILE requires MP_MAC_INSTALLER_IDENTITY." >&2
      exit 1
    fi
    xcrun notarytool submit "$PKG_OUT" --keychain-profile "$MP_NOTARY_PROFILE" --wait
    xcrun stapler staple "$PKG_OUT"
    echo "Notarized and stapled $PKG_OUT"
  else
    echo "The PKG is unsigned. See SIGNING.md before broad public distribution."
  fi
fi

if [ "$TARGET_PLATFORM" = "win-x64" ]; then
  if ! command -v makensis >/dev/null 2>&1; then
    echo "makensis is required for the Windows installer." >&2
    exit 1
  fi
  INSTALLER_ICON="$WORK/motionplug.ico"
  node installer/windows/make-ico.cjs "$INSTALLER_ICON" assets/icons/motionplug-logo.png
  EXE_OUT="$ARTIFACTS/MotionPlug-Setup-$VERSION.exe"
  rm -f "$EXE_OUT"
  ESTIMATED_KB="$(du -sk "$PAYLOAD" | awk '{print $1}')"
  makensis -V2 \
    -DVERSION="$VERSION" \
    -DPAYLOAD_DIR="$PAYLOAD" \
    -DOUT_FILE="$EXE_OUT" \
    -DINSTALLER_ICON="$INSTALLER_ICON" \
    -DESTSIZE_KB="$ESTIMATED_KB" \
    "$(pwd)/installer/windows/motionplug.nsi"
  echo "Built $EXE_OUT"

  if [ -n "${MP_WINDOWS_SIGNTOOL:-}" ] || [ -n "${MP_WINDOWS_CERT_SUBJECT:-}" ]; then
    if [ -z "${MP_WINDOWS_SIGNTOOL:-}" ] || [ -z "${MP_WINDOWS_CERT_SUBJECT:-}" ]; then
      echo "Set both MP_WINDOWS_SIGNTOOL and MP_WINDOWS_CERT_SUBJECT to sign Windows releases." >&2
      exit 1
    fi
    MP_WINDOWS_TIMESTAMP_URL="${MP_WINDOWS_TIMESTAMP_URL:-http://timestamp.digicert.com}"
    "$MP_WINDOWS_SIGNTOOL" sign /fd SHA256 /td SHA256 \
      /tr "$MP_WINDOWS_TIMESTAMP_URL" /n "$MP_WINDOWS_CERT_SUBJECT" "$EXE_OUT"
    "$MP_WINDOWS_SIGNTOOL" verify /pa "$EXE_OUT"
    echo "Authenticode signature verified."
  else
    echo "The EXE is unsigned. See SIGNING.md before broad public distribution."
  fi
fi

node scripts/validate-release.mjs "$TARGET_PLATFORM"
echo "Release artifacts are ready in $ARTIFACTS"
