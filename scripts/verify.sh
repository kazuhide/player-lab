#!/usr/bin/env bash
#
# Local verification — reproduces what the GitHub Actions CI ran, for when Actions
# isn't available (e.g. a free plan with no minutes). This is the pre-merge gate:
#
#     pnpm verify          # or: bash scripts/verify.sh
#
# It runs every workspace's typecheck/unit tests/build, the Playwright E2E (which
# reaches public live servers), and the native iOS/Android tests + builds. Steps
# whose toolchain is missing are SKIPPED (not failed) so it degrades on a bare clone.
# Exits non-zero if any executed step fails.
set -uo pipefail
cd "$(dirname "$0")/.."

# Credentials from the repo-root .env (docs/SETUP.md). Loaded as DEFAULTS —
# already-exported environment variables win. Never echoed.
. scripts/env-lib.sh
load_env_defaults ./.env

PASS=0; FAIL=0; SKIP=0
RESULTS=""
step() { # <name> <cmd...>
  local name="$1"; shift
  printf '\n\033[1m===> %s\033[0m\n' "$name"
  if "$@"; then RESULTS+=$'\n'"  PASS  $name"; PASS=$((PASS + 1));
  else RESULTS+=$'\n'"  FAIL  $name"; FAIL=$((FAIL + 1)); fi
}
skip() { printf '\n---> SKIP %s (%s)\n' "$1" "$2"; RESULTS+=$'\n'"  SKIP  $1 ($2)"; SKIP=$((SKIP + 1)); }

# ---- TypeScript workspaces (web, react-native, vega, packages, e2e) ----
step "TS typecheck"  pnpm -r --if-present run typecheck
step "TS unit tests" pnpm -r --if-present run test
step "TS build"      pnpm -r --if-present run build

# ---- Sync the shared Web UI bundle into the native apps (needs ui-shared built above) ----
# The native iOS/Android builds load these synced assets in a WebView (§12).
step "Sync Web UI bundle" bash scripts/sync-webui-bundle.sh

# ---- Config machinery self-test (fixtures only — no credentials, no network) ----
step "env-lib/sync-env self-test" bash scripts/test-env-lib.sh

# ---- Sync per-app credential files from the repo-root .env (no-op without .env) ----
step "Sync app credentials" bash scripts/sync-env.sh

# ---- Web E2E (Playwright; starts a Vite server, hits public reference streams) ----
step "Public Web E2E (localhost)" pnpm --filter @showcase/e2e e2e:public

# ---- iOS (macOS + Xcode) ----
if [ "$(uname)" = "Darwin" ] && command -v xcodebuild >/dev/null 2>&1; then
  step "iOS DvrKit tests" swift test --package-path apps/ios/DvrKit
  if command -v xcodegen >/dev/null 2>&1; then
    (cd apps/ios && xcodegen generate >/dev/null)
    step "iOS app build (sim)" bash -c "cd apps/ios && xcodebuild -project Showcase.xcodeproj -scheme Showcase-iOS -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build >/dev/null"
  else
    skip "iOS app build" "xcodegen not installed (brew install xcodegen)"
  fi
else
  skip "iOS" "not macOS or xcodebuild missing"
fi

# ---- Android (JDK 17 + Android SDK) ----
ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
JDK="$(/usr/libexec/java_home -v 17 2>/dev/null || echo "${JAVA_HOME:-}")"
if [ -d "$ANDROID_SDK" ] && [ -n "$JDK" ] && [ -x "$JDK/bin/java" ]; then
  # Real license keys when .env provides them (an installable, allow-listed APK);
  # falls back to a dummy so the compile still runs on a bare clone. Passed via the
  # environment (never interpolated into the command string).
  step "Android :dvr test + app build" \
    env JAVA_HOME="$JDK" ANDROID_HOME="$ANDROID_SDK" \
      PLAYER_KEY="${BITMOVIN_PLAYER_LICENSE_KEY:-dummy}" \
      ANALYTICS_KEY="${BITMOVIN_ANALYTICS_LICENSE_KEY:-}" \
    bash -c 'cd apps/android && ./gradlew --console=plain :dvr:test :app:assembleDebug :app:assembleDebugAndroidTest -PbitmovinLicenseKey="$PLAYER_KEY" -PbitmovinAnalyticsLicenseKey="$ANALYTICS_KEY"'
else
  skip "Android" "JDK 17 ($JDK) or Android SDK ($ANDROID_SDK) not found"
fi

# ---- Summary ----
printf '\n============================================================\n'
printf 'VERIFY SUMMARY%s\n' "$RESULTS"
printf '============================================================\n'
printf '%d passed, %d skipped, %d failed\n' "$PASS" "$SKIP" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
