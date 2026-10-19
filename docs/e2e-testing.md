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

The CI workflow runs workspace checks, environment-loader tests, a public browser
subset, and native compilation. Native jobs receive the same shared UI build;
the packaged iOS app and Android APK are checked for matching JavaScript and CSS.
The app READMEs list toolchain requirements.

Public repositories also have [limits on simultaneous hosted jobs](https://docs.github.com/en/actions/reference/limits#job-concurrency-limits-for-github-hosted-runners).
Jobs may wait for a runner or for other jobs on the same account to finish.
A queued job has not started; other jobs in the run may already be complete.
Required checks must pass before merging.

## Browser playback

The existing Playwright suite is in [tests/e2e](../tests/e2e/README.md). It drives
the actual player and Web app, including theme construction, configuration,
DVR, network APIs, track selection, sprites, and subtitles. Tests use public
reference streams or your configured test output; external availability can
affect the result. Provisioned media tests require `VITE_TEST_STREAM_BASE_URL`
in the test runner's environment.

Run the existing cases you intend to verify and report that exact selection.
CI runs `pnpm --filter @showcase/e2e e2e:public`: the selected public VOD and GUI
cases, with retries disabled. It uses Chromium supplied by the locked Playwright
package. The complete suite still needs the documented assets and optional
licenses. Do not treat workspace unit-test success as browser playback success.

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
streams. Missing native toolchains cause their steps to be skipped. The localhost
browser subset runs without a Player key; a zero exit status means the executed
steps passed. Read its full
passed/skipped/failed summary and do not report skipped steps as successful.

## Recorded local checks

On 2026-10-19, the combined maintenance changes were checked on macOS with
Node.js 24.19.0 and pnpm 10.33.0:

| Check | Result |
| --- | --- |
| Workspace type checks and build | Passed |
| Workspace unit tests | 154 passed: Web 75, shared UI 22, React Native 29, Vega 28 |
| Environment-loader self-test | Passed |
| Public browser subset, retries disabled | 16 passed; command exited successfully |
| Offline Encoding resource/credential tests | 17 passed; no account requests |
| Publication and native packaging fixtures | 6 and 3 passed, respectively |

The browser cases cover all 14 themes and their English construction code,
the standalone guide, applied configuration resets and hydration, settings and
recommendation clicks, same-preset reloads, language switching, default
playback, and the three public VOD baseline checks. Provisioned media cases are
outside this subset; they now reject missing configuration before playback.

Existing SDK warnings remain when tests cancel loads or interrupt `play()` with
`pause()`, and builds report the SDK's use of `eval`. These results do not assert
a warning-free console. They also do not verify live-event finalization, hosted
feature media, licensed native playback, external Analytics receipt, actual
cloud encoding, offline playback, or a Vega device build. Native compilation
and packaged-resource results are recorded separately by CI.

## Additional checks with local media

On 2026-10-19, the [generated Big Buck Bunny fixtures](local-test-media.md)
were used for 10 additional Chrome cases with retries disabled: provisioned
HLS/DASH loading and seeking, audio selection, subtitle cues, sprite geometry
and image requests, network callbacks, and the existing app's three feature
presets. The generated media stays outside version control.

Two separate [controlled finalization cases](live-to-vod-and-analytics.md#run-a-controlled-web-finalization-check)
also passed, one for HLS and one for DASH. They served real media from a loopback
server, finalized the same manifest URL, and checked that the same Player moved
from live/DVR to finite VOD without a source reload. They covered player
recreation through the DVR setting before finalization and seeking afterward.
These checks establish controlled local behavior; production live ingest,
delivery infrastructure, physical devices, and cloud services remain separate
verification tasks.
