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

## Static Pages app

The [Pages build instructions](../apps/web/README.md#build-and-test) generate
the public fixture and package the production app. Run its browser checks with
`E2E_PAGES_DIR` pointing to that complete site directory. Set
`E2E_PAGES_ANALYTICS_ENABLED=1` when the artifact includes a public Analytics
license; leave it unset for a keyless local build.

The tests serve actual built files under `/player-lab/web/`, without a development
server or a fallback page. They check advancing video time and decoded frames
for HLS and DASH, all 14 themes and code examples, the three configuration
application modes, guide navigation, audio selection, visible subtitle cues,
and decoded thumbnail images. English and Japanese app and guide layouts are
checked at 375 and 1440 pixels. Code blocks may scroll within their own area.
Long API names in configuration explanations are also checked with a wider
fallback font, since font metrics differ across operating systems.

Analytics ingress requests are intercepted before navigation so CI playback
does not enter the demo's usage data. An enabled collector must attempt a
request and show its collection notice; this does not prove remote ingestion.
The account aggregation query panel stays hidden in both languages, while its
controls remain disabled and guarded against synthetic click events.

On 2026-10-19, Chrome 155 on macOS 27.0.1 passed all ten production cases with
Playwright 1.61.0, one worker and no retries or skips, in 14.6 seconds. This used
the generated 60-second fixture and the configured public licenses, with
collector requests intercepted. Web unit
tests passed 93 cases, package verification passed 32, the static test server
passed three, and the secret-scanner regression passed 15 cases.
Hosted domain licensing and actual Analytics receipt are separate checks.

## Native builds and device runs

CI compiles iOS/tvOS apps and the Android app and instrumented tests. This checks
SDK types and build wiring. Android's instrumented test can be run separately
with `connectedAndroidTest` on an emulator or device with an appropriate license.
iOS has an opt-in hosted XCTest scheme, `Showcase-iOS-Runtime`. It exercises the
existing model and shared WebView controls with a real SDK. The Android tests
include the actual Compose controls and shared WebView. Follow the
[iOS](../apps/ios/README.md) and [Android](../apps/android/README.md) guides to run
them with your own allowed license. CI compiles native apps without a playback
license; it does not run these licensed scenarios. No React Native end-to-end
harness or Vega device harness is included.

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

At the maintenance baseline (`dc43bc7`), the following checks ran on macOS on
2026-10-19 with Node.js 24.19.0 and pnpm 10.33.0. Later checks are recorded below:

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

The later [UI lifecycle regression](web-performance.md) brings the public
browser subset to 17 cases. That guide records the separate processor and
memory measurements and their limits.

## Additional native runtime checks

On 2026-10-19, the hosted iOS test passed on an iPhone 17 Pro simulator with
iOS 26.4 and Player 3.128.0: one test, zero failures or skips, 11.670 seconds.
It checked the bundled shared interface, playback initiated through that
interface, HLS source changes, rewind and live return, and interface recreation.
Seek checks waited for fresh completion events, SDK positions, and visible
controls. They compared rewind landing positions with a media reference fixed
before the request: the live edge can advance while a seek buffers. The same
three-second position tolerance was retained. Control checks included ancestor
visibility and used normal pointer events to reveal auto-hidden controls;
accepting a request or finding hidden markup alone does not show the result.
The [iOS guide](../apps/ios/README.md) records the test's model/UI scope and limits.

The Android 16 emulator passed both runtime tests with Player 3.155.0 through
`connectedDebugAndroidTest`: two tests, zero failures or skips, 29.294 seconds.
They used the app's Compose controls, bundled shared interface, actual playback,
source changes, rewind/live return, and the DVR setting. Initial playback waited
for a visible control; rewind used the same fixed-reference and visibility checks
as iOS. The app and instrumentation APK compiled with the final shared UI, and
packaged JavaScript/CSS matched the source output. Packaging regression tests
passed five cases. These runtime results are separate from CI compilation and
packaging. Physical devices and the other native platforms remain separate
verification tasks.

## Codec capability query

On 2026-10-19, Chrome 155.0.8059.85 and the locked Chromium 149.0.7827.55
reported support for H.264 (`avc1.64001e`) and High Efficiency Video Coding
(HEVC, `hvc1.1.6.L93.B0`) on macOS. The query used a secure localhost origin
and a 640 × 360, 24-frame-per-second, 500-kilobit-per-second configuration.
`canPlayType` returned a support string, `MediaSource.isTypeSupported` returned
true, and `MediaCapabilities.decodingInfo` returned `supported`, `smooth`, and
`powerEfficient` as true for both file and media-source modes.

These [capability estimates](https://www.w3.org/TR/media-capabilities/) do not
establish actual decoding, audible synchronization, or hardware measurements.
The local fixture checks played H.264; HEVC playback remains unverified.

## Configuration editor checks (2026-10-20)

The source/player editors have separate validation, application, and lifecycle
checks. These recorded results extend the earlier native checks; they do not
replace the playback limits above. The React Native and Vega type checks now
include the App and configuration panels; Vega also includes its video-surface
TSX, extending the earlier DVR-only/type-check entry.

| Check | Recorded result and scope |
| --- | --- |
| Android JVM | Six DVR and six configuration tests passed without a valid Player license; validation and exact SDK mapping, not playback. |
| Apple logic and hostless configuration | Six DvrKit tests, six iOS configuration tests, and six local tvOS configuration tests passed without a valid Player license. The hostless schemes compile the app's model/configuration sources and use a synthetic key to construct SDK objects. |
| Apple configuration GUI | One test each passed on iPhone 17 Pro / iOS 26.4, iPad Pro 11-inch (M5) / iOS 26.4, and Apple TV 4K (3rd generation) / tvOS 26.4. These use the SDK default UI and check editor operations, retained configuration, and tvOS remote focus/Select; they do not assert advancing playback. |
| Android configuration and ownership | Four checks passed on an Android 16 phone emulator with a dummy license in 41.737 seconds, covering the Compose editor, scrolling, D-pad focus, source retention, view detachment, and recording-API ownership checks. A separate licensed, GUI-configured VOD autoplay case passed in 18.342 seconds, checking mute, the 10-second start offset, and advancing playback. |
| React Native / Vega | 57 / 42 tests passed, respectively. App interaction and lifecycle tests use mocked native hosts and player/media objects; type checks passed against the installed declarations. They do not qualify native layout, TV focus, keyboards, device builds, or playback. |

To repeat the license-free checks, install the locked workspace dependencies and
follow the platform README's toolchain setup. Android app tests need the Android
SDK and Java 17. Apple hostless tests need Xcode, the generated project and pinned
packages; create an empty ignored `Local.xcconfig` for that setup rather than
providing a playback license. From the repository root:

```sh
swift test --package-path apps/ios/DvrKit
pnpm --filter @showcase/react-native test
pnpm --filter @showcase/react-native typecheck
pnpm --filter @showcase/vega test
pnpm --filter @showcase/vega typecheck
(cd apps/android && ./gradlew :dvr:test :app:testDebugUnitTest \
  -PbitmovinLicenseKey=dummy -PbitmovinAnalyticsLicenseKey=)
```

After the [Apple project setup](../apps/ios/README.md#build-the-app), run the
following from `apps/ios`, replacing each destination with an installed simulator:

```sh
xcodebuild -project Showcase.xcodeproj -scheme Showcase-iOS-Configuration \
  -destination 'platform=iOS Simulator,name=<IOS_SIMULATOR_NAME>' \
  -onlyUsePackageVersionsFromResolvedFile -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO test
xcodebuild -project Showcase.xcodeproj -scheme Showcase-tvOS-Configuration \
  -destination 'platform=tvOS Simulator,name=<TVOS_SIMULATOR_NAME>' \
  -onlyUsePackageVersionsFromResolvedFile -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO test
```

CI runs the hostless iOS scheme; its generic tvOS simulator build does not run the
local tvOS configuration or GUI tests. For licensed Apple GUI checks, follow the
[Configuration tests](../apps/ios/README.md#configuration-tests) instructions for
`Showcase-iOS-ConfigurationUI` on iPhone and iPad and
`Showcase-tvOS-ConfigurationUI` on Apple TV. They launch the real app and require
an allowed Player license, a reachable reference source, and network access. Their
SDK-default-UI results do not establish shared Web UI behavior, stream-offset
accuracy, bitrate enforcement, or physical-device input.

For the Android configuration/ownership checks, connect an emulator and run from
`apps/android`:

```sh
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.showcase.app.PlayerConfigurationInstrumentedTest,com.showcase.app.PlayerOwnershipInstrumentedTest \
  -PbitmovinLicenseKey=dummy -PbitmovinAnalyticsLicenseKey=
```

The separate `PlayerConfigurationPlaybackInstrumentedTest` needs the app's normal
allowed license and network access. Follow the
[Android playback setup](../apps/android/README.md#playback-checks), then select
that class with the same instrumentation runner argument. Do not retain the dummy
license override for a playback run.

On Player Android 3.171.0, the existing shared-UI/DVR check reported non-network
timeout 1004 in a grouped run. Separate comparisons of base `2c90983` and the
changed app both failed the return-to-live assertion with the same SDK, shared UI,
and emulator. No threshold was relaxed; that shared-UI/live-edge path remains
unqualified for this version. The October 19 result above used Player 3.155.0.
The configured VOD pass does not close this live-edge failure.

These configuration checks do not qualify physical devices, Android TV/Fire TV,
completed internal SDK resource cleanup, casting, offline playback, or Analytics
receipt. React Native still needs an external Expo development build and shared
UI delivery; Vega still needs its Kepler build and complete runtime compatibility
setup. Neither has been qualified on a device by the mocked tests.
