#!/usr/bin/env bash
#
# Copy the built shared Web UI bundle (packages/ui-shared/dist) into each native app's
# asset location, so the SDK's Web UI harness can load our custom UI in a WebView (§12):
#   - Android: file:///android_asset/bitmovinplayer-ui.js
#   - iOS:     bundled as an app resource on the iOS (non-tvOS) target
#   - RN:      delivered to the native WebView (Expo prebuild) — see apps/react-native/README
#
# The bundle is a build artifact, so the destinations are gitignored. Build it first:
#   pnpm --filter @showcase/ui-shared build
# `pnpm verify` runs that build (the "TS build" step) before invoking this script.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="packages/ui-shared/dist"
JS="$SRC/bitmovinplayer-ui.js"
CSS="$SRC/bitmovinplayer-ui.css"

if [ ! -f "$JS" ] || [ ! -f "$CSS" ]; then
  echo "error: shared Web UI bundle not found in $SRC" >&2
  echo "       run: pnpm --filter @showcase/ui-shared build" >&2
  exit 1
fi

dests=(
  "apps/android/app/src/main/assets"
  "apps/ios/WebUI"
  "apps/react-native/assets/webui"
)
for d in "${dests[@]}"; do
  mkdir -p "$d"
  cp "$JS" "$CSS" "$d/"
  echo "synced shared Web UI → $d"
done
