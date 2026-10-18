# Testing the apps

Unit tests check deterministic logic. Browser and device tests check the actual
player. These are different kinds of evidence: compilation alone does not show
that video played or that a UI rendered correctly.

## Workspace checks

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
bash scripts/test-env-lib.sh
```

| Target | Existing checks |
| --- | --- |
| Web | DVR logic, measurements, client-license handling, and server-side Analytics proxy tests |
| Shared UI | Formatting, live state, and exported UI factories |
| React Native | DVR unit tests and types including `App.tsx` |
| Vega | DVR unit tests and modular player types; React/Kepler TSX UI is excluded |
| iOS/tvOS | `swift test --package-path apps/ios/DvrKit` |
| Android | `cd apps/android` then `./gradlew :dvr:test` |

The CI workflow runs workspace checks and native compilation. The app READMEs
list toolchain requirements and explain which builds need native assets.

## Browser playback

The existing Playwright suite is in [tests/e2e](../tests/e2e/README.md). It drives
the actual player and Web app, including theme construction, configuration,
DVR, network APIs, track selection, sprites, and subtitles. Tests use public
reference streams or your configured test output; external availability can
affect the result. Provisioned media tests require `VITE_TEST_STREAM_BASE_URL`
in the test runner's environment.

Run the existing cases you intend to verify and report that exact selection.
The CI workflow does not run these browser cases automatically. Do not treat
workspace unit-test success as browser playback success.

## Native builds and device runs

CI compiles iOS/tvOS apps and the Android app and instrumented tests. This checks
SDK types and build wiring. Android's instrumented test can be run separately
with `connectedAndroidTest` on an emulator or device with an appropriate license.
No iOS app XCTest, React Native end-to-end harness, or Vega device harness is
included.

Native playback needs an app-allowlisted player license and a runtime. Shared
Web UI rendering must be checked in the native WebView; tvOS uses system UI and
Vega uses native controls. A successful simulator build does not prove physical
TV, remote-control, casting, offline, or Analytics behavior.

## Combined local verification

`pnpm verify` runs the existing combined script. It also synchronizes local
credentials and shared UI assets and can run browser tests against external
streams. Missing toolchains and a missing player key cause some steps to be
skipped; a zero exit status means the executed steps passed. Read its full
passed/skipped/failed summary and do not report skipped steps as successful.

## Recorded local check

On 2026-10-18, checks on macOS with Node.js 24 and pnpm 10.33.0 produced:

| Check | Result |
| --- | --- |
| Workspace type checks and build | Passed |
| Workspace unit tests | 84 passed: Web 38, shared UI 22, React Native 12, Vega 12 |
| Environment-loader self-test | Passed |
| Swift DvrKit | 6 passed |
| Selected existing Chrome browser cases, retries disabled | 9 passed; 1 failed because provisioned media was not configured |
| Local Android DVR test in offline mode | Dependency resolution failed because required Kotlin artifacts were not cached; tests did not run |

The nine browser passes cover all-theme switching and English construction
code, the standalone guide, configuration application, language switching,
default playback, and the three public VOD baseline checks. The selected
Network API case uses `PROVISIONED.vodBaselineHls`; without
`VITE_TEST_STREAM_BASE_URL` it received the local page rather than an HLS
playlist. This is not a successful Network API playback result. Configure your
own fixture output before running that case.

These results do not verify hosted feature assets, native app playback,
external Analytics receipt, offline playback, or a Vega device build. CI results
are separate from this local record.
