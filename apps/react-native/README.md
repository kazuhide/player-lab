# Bitmovin Player sample for React Native and Expo

This folder contains the React Native sample screen, playback state helpers, and
a generator for an external Expo development project using that same screen.
The player library bridges to native iOS and Android players. State reads return
Promises, so the screen waits for a snapshot before deriving playback state.

## Layout

- `src/playback/`: TypeScript playback timeline calculations and state handling,
  including live rewind.
- `src/sources.ts`: test source definitions; `App.tsx` maps source kind to
  the player's `SourceType`.
- `App.tsx`: player, control panel, and snapshot refresh on `onTimeChanged`.
- `src/ConfigurationPanel.tsx`, `src/configuration.ts`: draft configuration controls
  and validation before player creation/source loading.
- `expo/`, `scripts/create-expo-project.mjs`: pinned Expo host, native asset plugin,
  and dependency locks. Generated native projects stay outside this checkout.

## Test and type-check

From the repository root:

```bash
pnpm --filter @showcase/react-native test
pnpm --filter @showcase/react-native typecheck
```

The type-check includes `App.tsx`, the source definitions, and the pure logic,
using the installed React Native and player types. It does not build the native
app or verify playback.

The App interaction tests mount the screen with mocked native hosts and player
objects. They exercise form edits, Apply/Reset, source selection, recreation,
bitrate integer boundaries and URL validation with incomplete native global URL
getters. React 19
deprecates `react-test-renderer`; that expected warning is retained in test output,
and other console errors fail the tests. These tests do not render native layout,
the Web UI, a video surface, or a stream.

## Configuration controls

The application follows the device language for English and Japanese. Use **English** or **日本語** above the source selector, or in **More** in compact layouts, to change labels and help without reloading the player or discarding edits. SDK identifiers, code, event payloads and user-entered values retain their original text. The SDK's player menus use the languages supported by the selected UI bundle.

Open **Settings**, choose a configuration category, then select the property
to edit directly. Apply and Reset stay outside the editor's scrolling content.
The source category includes the URL, HLS/DASH/progressive type,
title, poster URL, signed start offset and its timeline reference. iOS starts
with HLS and hides DASH sources/types because its native player does not support
DASH. Android retains the existing HLS and DASH presets.

`App` owns the screen's safe-area handling. The generated `index.tsx` registers
it directly; do not add another `SafeAreaView` around it. An extra wrapper moves
the editor's origin while keyboard events still use screen coordinates, which
can hide fixed actions. When updating an existing generated host, copy the
current `expo/index.tsx` as its `index.tsx`, together with `App.tsx` and `src`.

The player category exposes autoplay, startup mute, forward buffer duration and the
adaptation bitrate cap. URL fields accept HTTP/HTTPS; optional fields can be
cleared. Start offsets and buffer durations accept finite decimal seconds.
The bitrate cap uses whole bits per second: 1–2,147,483,647 on Android, and
1–9,007,199,254,740,991 on iOS. The native bridge converts bitrate to an integer;
fractions would lose precision, Android uses a signed 32-bit integer, and values
above JavaScript's safe-integer limit cannot be represented exactly. Invalid
input leaves the active player unchanged. Blank means no cap. The buffer field
accepts zero on iOS to let the SDK choose a duration. This screen requires a
positive Android buffer target: zero has no automatic-selection meaning there.
Blank leaves the platform SDK default (iOS 0, Android 50 seconds) untouched.
No startup/restart thresholds are overridden.

The external subtitle fields add one WebVTT track: HTTP/HTTPS URL, menu label,
IETF language tag (for example, `en` or `en-US`), and **Mark as default**.
URL, label and language are required together; language tags are normalized.
A blank subtitle URL removes the external track and clears its metadata.
**Mark as default** sets the SDK track metadata; it does not promise that
subtitles become enabled. Select the track through the normal Player subtitle
menu. Reset, Apply, UI replacement and applied-code output use the same
validated subtitle values as the other source fields. Choosing a source preset
clears the external subtitle fields.

URL validation uses the locally imported `URL` from `react-native-url-polyfill`
4.0.0. Older React Native global URL implementations leave `protocol` and
`hostname` unimplemented, which would reject valid sources before loading.
The local import leaves global URL and the SDK's media shims unchanged; it does
not install the package's global polyfill.

**Apply configuration** validates the whole draft, recreates the player
and reloads the selected source from its configured start offset. Playback
position is reset. Invalid input and an unchanged configuration do not replace
the player. **Reset draft** only restores the currently applied values. Source
preset selections load immediately and replace the draft's source fields;
unapplied playback/buffer/adaptation edits remain in the draft.

The complete applied source, chosen UI, log and **Allow DVR** setting survive
recreation. Playback starts according to the Autoplay setting. Source/player
errors add log entries. DVR means the window of live media that a viewer can
rewind. **Allow DVR** controls the application's live-rewind helper and hides the
embedded UI's live seekbar and time labels while disabled. The public
`CustomMessageHandler` channel updates the existing UI even while paused, without
reloading the Player or Source. On-demand seeking remains available;
it does not edit the SDK's creation-time `isTimeShiftEnabled` property.

The direct editable mappings are:

| GUI control | Public SDK configuration |
| --- | --- |
| URL / type / title / poster | `SourceConfig.url`, `.type`, `.title`, `.poster` |
| Start offset / reference | `SourceConfig.options.startOffset`, `.startOffsetTimelineReference` |
| Autoplay / startup mute | `PlayerConfig.playbackConfig.isAutoplayEnabled`, `.isMuted` |
| Forward buffer | `PlayerConfig.bufferConfig.audioAndVideo.forwardDuration` |
| Bitrate cap | `PlayerConfig.adaptationConfig.maxSelectableBitrate` |
| External WebVTT URL / label / language / default metadata | `SubtitleTrack.url`, `.label`, `.language`, `.isDefault` |

These mappings use the [public wrapper 1.29.0 source declarations](https://github.com/bitmovin/bitmovin-player-react-native/tree/v1.29.0/src),
including its [platform-specific buffer documentation](https://github.com/bitmovin/bitmovin-player-react-native/blob/v1.29.0/src/bufferConfig.ts).
The [public subtitle declarations](https://github.com/bitmovin/bitmovin-player-react-native/blob/v1.29.0/src/subtitleTrack.ts)
define the track metadata. This screen fixes the external track format to WebVTT;
the enclosing `SourceConfig.subtitleTracks` array is assembled by the app.
The public [Android](https://github.com/bitmovin/bitmovin-player-react-native/blob/v1.29.0/android/src/main/java/com/bitmovin/player/reactnative/converter/JsonConverter.kt#L163-L165)
and [iOS](https://github.com/bitmovin/bitmovin-player-react-native/blob/v1.29.0/ios/RCTConvert%2BBitmovinPlayer.swift#L971-L972)
converters explain the bitrate integer limits. The URL package documents
[local imports without replacing global URL](https://github.com/charpeni/react-native-url-polyfill/blob/v4.0.0/README.md).
Loop is not an exposed configuration property in this wrapper. Native rendering
and playback require a development build with an authorized Player license.

## Build in an Expo project

Use Node **24.19.0** and pnpm **10.33.0**. The generated host pins Expo **57.0.30**,
React Native **0.86.3**, React **19.2.3**, wrapper **1.29.0**, Expo Crypto
**57.0.4**, and Expo Clipboard **57.0.2**. Its standalone `pnpm-lock.yaml`
preserves the resolved JavaScript dependency graph. Expo 57 supplies its native
prebuild template; no moving `create-expo-app@latest` template is used.

Wrapper 1.29 requires iOS/tvOS 16.4 or newer. Its Android plugin requires compile
SDK 37 or newer and Kotlin Gradle plugin 2.2.21 or newer. The generated Expo 57
host supplies compatible native toolchains.

The display name is **Player Lab React Native**. Both the iOS bundle identifier
and Android application ID are **`com.playerlab.reactnative`**, defined in
`expo/app.json`. Authorize this identifier on the Player license you supply.
Analytics uses its own optional license and authorization settings.

From the repository root, after configuring the keys described in
[`docs/SETUP.md`](../../docs/SETUP.md):

```bash
pnpm install --frozen-lockfile
pnpm --filter @showcase/ui-shared build
bash scripts/sync-env.sh
node apps/react-native/scripts/create-expo-project.mjs ../player-lab-react-native --env-from apps/react-native/.env
cd ../player-lab-react-native
pnpm install --frozen-lockfile
pnpm exec expo prebuild --no-install
```

The target must be a new directory outside this checkout. The generator copies
the existing `App.tsx` and TypeScript sources, registers that screen with a safe
area, and includes both native config plugins and built shared UI assets.
`--env-from` explicitly copies the ignored generated key file with mode `0600`;
omit it to create a project without keys. It never inserts keys into `app.json`.
The copied `.env` supplies `EXPO_PUBLIC_BITMOVIN_PLAYER_LICENSE_KEY` and optional
`EXPO_PUBLIC_BITMOVIN_ANALYTICS_LICENSE_KEY`. Do not commit that file or native
build output.

The generator also accepts **`--runtime-checks`** for a dedicated test host.
That entry wraps the same production `App` with an explicit read-only report
and a teardown button. The normal entry has neither. Its public SDK getters
report finite playback clocks, playing/mute state and subtitle counts without
serializing keys, URLs, native identifiers, cue text or SDK messages. Reported
React Native destruction is the wrapper's `isDestroyed` flag; the wrapper's
`destroy()` returns void and does not expose a native completion acknowledgement.
Keep this entry out of ordinary app screenshots and distribution builds.

The generator copies the environment file once. To refresh an existing external
host after changing the repository keys, run these commands from the repository
root, then restart Metro in the external host:

```bash
bash scripts/sync-env.sh
install -m 600 apps/react-native/.env ../player-lab-react-native/.env
```

The copied file uses the client-facing EXPO_PUBLIC_ variable names. Keep it
outside version control.

If Android cannot connect to a Metro server bound to `localhost`, check
`http://127.0.0.1:8081/status` on the Mac as well as `http://localhost:8081/status`.
An IPv6-only listener does not accept Android's IPv4 connection. For a local
server with Node 24, use:

```bash
NODE_OPTIONS=--dns-result-order=ipv4first pnpm exec expo start --localhost --port 8081
adb reverse tcp:8081 tcp:8081
```

Stop the previous Metro process before starting the server for a different
external host. Restarting the app after the server is ready avoids its bundled
asset fallback when no development server was reachable at startup.

On macOS, install Xcode and CocoaPods for iOS. Android requires Java 17 and the
Android SDK/toolchain selected by Expo 57. Restore the checked-in native locks
after prebuild, before the first iOS build:

```bash
cp native-locks/Podfile.lock ios/Podfile.lock
(cd ios && pod install)
mkdir -p ios/PlayerLabReactNative.xcworkspace/xcshareddata/swiftpm
cp native-locks/Package.resolved ios/PlayerLabReactNative.xcworkspace/xcshareddata/swiftpm/Package.resolved
pnpm exec expo run:ios
# Or, for Android:
pnpm exec expo run:android
```

The supplied CocoaPods lock was generated with CocoaPods **1.17.0**. Keep
`Podfile.lock` and the workspace's `Package.resolved` when maintaining the
generated project. A subsequent prebuild can refresh native files; restore the
locks again if generating a fresh project. Expo Go cannot load the native Player.

Expo's precompiled iOS modules can include generated-host paths in their podspec
source and preparation command. In a fresh host, normal `pod install` can therefore
update the `ExpoModulesCore` specification checksum while keeping every dependency
version unchanged. Review that lockfile diff: a host-specific checksum change is
different from a dependency update. Do not remove the lockfile or change pinned
versions to work around a checksum mismatch.

The wrapper-supported native resolutions are:

| Dependency | React Native host |
| --- | --- |
| iOS Player / Player Core | 3.128.0 / 3.128.0 |
| iOS Analytics collector | 3.28.1 |
| iOS Google IMA | 3.26.1 |
| Android Player | 3.170.0+jason |

The standalone Android sample pins Player 3.171.0; wrapper 1.29.0 uses
3.170.0+jason. Keep the wrapper-supported Android dependencies together. The
iOS wrapper and standalone sample both use 3.128.0 through separate projects. Since wrapper 1.27, Player and IMA use Swift Package Manager on iOS; the
bridge and Expo still use CocoaPods. Existing projects should follow the
[official migration guide](https://github.com/bitmovin/bitmovin-player-react-native/blob/v1.29.0/docs/ios-dependencies.md).

## Shared player UI

The **Theme** picker selects the stock SmallScreen UI or Sports, Live, and Cinema factories
from `@showcase/ui-shared`. All four modes set
`usePlayer({ styleConfig: { userInterfaceType: UserInterfaceType.Bitmovin, playerUiJs, playerUiCss } })`
and use `PlayerView` with a named `uiConfig.variant`: Default uses the stock
`buildSmallScreenUI` tree, and custom themes use factories such as
`new CustomUi("…buildSportsUI")`.
The configuration applies when the player is created, so changing it remounts the
keyed `PlayerPane`.

The shared UI announces readiness through the public SDK message channel before
the app sends its latest live-rewind preference. Later toggles use the same
channel. Applied demonstration message handlers still receive their own messages;
retired owners cannot send further control updates. Arbitrary `WebUiConfig`
properties are not used because the pinned native bridges whitelist its fields.

The generator consumes the repository's built shared UI. After editing that UI,
rebuild it and copy the two updated files into an existing external project:

```bash
pnpm --filter @showcase/ui-shared build
cp packages/ui-shared/dist/bitmovinplayer-ui.{js,css} ../player-lab-react-native/assets/webui/
# In the external project, refresh native resources and rebuild:
# pnpm exec expo prebuild --no-install
```

The config plugin copies JS/CSS into Android's `app/src/main/assets/webui/` and
adds the two files to iOS Copy Bundle Resources. `App.tsx` uses
`file:///android_asset/webui/…` on Android and relative main-bundle filenames on
iOS. The SDK default UI continues to use the SDK's bundled assets. Rebuild the
native app after changing packaged UI files; a Metro reload alone cannot replace
native resources.

For a short runtime check, select **VOD HLS** and use the SDK Default UI to play
until its media clock advances. Select **Sports**, confirm its INFO control, and
play again. In configuration, edit the title and choose **Reset draft**; the
applied title should return without interrupting playback. Then edit the title,
start offset, autoplay and mute, apply, and confirm that the source and chosen
UI are retained while the position restarts. **Allow DVR** and the existing log
should remain. Background the app, return, and check that VOD can advance again.

The screen logs numeric Player/Source error codes without copying SDK error
messages. Android Player error
[1003](https://cdn.bitmovin.com/player/android/3.170.0/docs/player-core/com.bitmovin.player.api.deficiency/-player-error-code/-license-authentication-failed/index.html)
means the license request failed or was denied; it does not establish which
cause occurred. Check the installed application ID and key configuration, device
time, and network/TLS connectivity before changing license settings. If a
dedicated emulator reports an Unknown Host error, Android documents an
[AVD-specific `-dns-server` launch option](https://developer.android.com/studio/run/emulator-networking-dns).

## Native qualification

On 2026-10-21 the Expo 57 / wrapper 1.29.0 host built for an iPhone simulator
with Xcode 27.1 and an ARM64 Android API 36.1 emulator with Java 17. The resolved
native Players were 3.128.0 on iOS and 3.170.0+jason on Android. Packaged shared
JS/CSS bytes matched the built assets on both platforms.

Native GUI checks used the local 60-second Big Buck Bunny HLS fixture on iOS
and HLS/DASH on Android. SDK Default and packaged Sports showed advancing native
positions and changing video frames; Sports exposed its INFO control. Apply
destroyed the previous Player and created a new owner with the selected source,
UI, log and Allow DVR state retained. The first native Playing event and current
time were both 5.000 seconds for the configured five-second start. Native
getters confirmed autoplay, startup mute, a 2,500,000-bit/s maximum selectable
bitrate and a 12.5-second forward-buffer setting. This verifies the applied
values, rather than quantitative buffering or network adaptation effects.

The copied code matched the operating-system clipboard on both platforms and
excluded unapplied edits and the actual license. Reset restored the applied
draft without replacing the Player. After background/foreground return, the
same owner was retained; tapping the visible SDK Play control resumed advancing
VOD. This check exercises explicit playback after return. It does not promise
automatic resume. The iOS settings scroll view follows the keyboard so its
lower buffer and bitrate fields remain reachable while editing.

These checks cover the named simulator/emulator and UI modes. Physical devices,
Release archives, protected content, advertisements, other shared factories,
live/DVR behavior and quantitative buffer/bitrate effects require their own
test inputs. App tests with native mocks, generator tests and TypeScript checks
provide separate evidence from native playback.

## Player event handling

- `refresh()` reads the snapshot with `Promise.all` before deriving state. Native
  events share one in-flight batch and at most one pending refresh, so a burst
  cannot create an unbounded queue of bridge reads. Successful batches publish
  in order even if events keep arriving during each read; discarding every such
  batch would prevent the controls from updating on a slower bridge. Source
  changes and unmounts invalidate older completions.
- A rejected read keeps the last valid display and logs `Snapshot read failed`.
  The other reads in that batch finish before another batch starts. Read and
  seek completions from a previous source cannot update controls or seek.
- "Allow DVR" updates the cached display and embedded live controls immediately,
  including while paused. It keeps the current native playback position.
- The screen detects a live stream becoming on-demand by comparing snapshots on
  `onTimeChanged`, rather than relying on an `onDurationChanged` event.
- Recovery from an expired rewind position is also detected from snapshots. The
  screen returns to the live edge when the position falls outside the window;
  it does not rely on a `DvrWindowExceeded` event prop.

Verify these behaviors in the external Expo build with a valid player license.

The API picker disables unavailable operations and displays the prerequisite.
Session operations require a loaded source; seek and time shift follow the native
VOD/live state, linear-ad interruptions and the live-rewind setting. Skip requires
a presented non-linear ad, or a linear ad with public `onAdStarted.skipOffset`
and `clientType` metadata. Negative offsets, missing metadata and unsupported
clients are unavailable. Offset zero is immediate after a fresh `isAd()` check;
positive VOD offsets also require a fresh relative native ad clock to reach the
threshold, with another `isAd()` check after the clock read. The SDK's `isAd()`
returns false for pause ads,
so their separate public lifecycle events are tracked even when event recording
is paused. The pinned RN bridge exposes neither native `skippableAfter` nor IMA
`preferredUiType`. Programmatic IMA skip stays disabled; use the ad's on-screen
Skip control. Positive live-ad thresholds also stay disabled: RN applies the
source's absolute/relative time offsets to native time, so the wrapper getter is
not a verified live-ad elapsed clock. Unknown metadata or clock readings cannot
enable Skip. Schedule Ad needs
an applied advertising item and an active session. Platform, DRM, Analytics and
Cast prerequisites are also checked. A fresh public SDK observation guards native
session dispatch; source replacement and owner retirement invalidate older reads.
Load/bootstrap actions and explicit subtitle/bitrate clearing retain their normal
paths. These guards do not add an SSAI metadata API to the pinned wrapper.

## Applied configuration code

Open **Code** to inspect the Player, Source and
selected UI settings sent to the SDK. The output excludes draft edits and license
values. **Copy code** uses Expo Clipboard 57.0.2, matched to Expo 57. Regenerate and
build the external native host after changing native dependencies; refreshing
JavaScript alone does not install a native module.

## Loading and replacing sources

SDK 1.29's [`Player.load` and `loadSource`](https://github.com/bitmovin/bitmovin-player-react-native/blob/v1.29.0/src/player.ts) return before native `Source.initialize()` finishes. Replacing or unloading a source during that work needs a separate ownership check: the original continuation must not attach a retired source, and destroying a source before initialization settles can leave a later native allocation behind.

The app routes loads through [sourceOwnership.ts](src/sourceOwnership.ts). It retains the real SDK-created Source, waits for initialization, and checks the current owner again at the SDK's native dispatch. One native Source initializer runs at a time; a newer request replaces the waiting request for that player. Unload, destroy and recreation retire pending work immediately and release each source after initialization settles. The SDK does not expose cancellation of an in-progress native initializer. If it does not settle, the next load stays queued; the API panel reports the pending call after its timeout and does not retry it automatically.

Applied examples import this helper. Include it when moving the example into another project so its source lifetime matches the app's behavior.

## Scrolling Android player menus

The video is outside the settings ScrollView. Swipe inside the video to move a
Player menu and within the editor to scroll its fields. A player gesture retains
its owner until the last pointer ends or is cancelled; replacing the player also
releases the retired pane's touch state.

## Cast startup settings

The generated host includes the Google Cast sender SDK and the native configuration for local network discovery, background playback, offline playback and picture-in-picture. The Cast versions follow the [SDK 1.29 example](https://github.com/bitmovin/bitmovin-player-react-native/blob/v1.29.0/example/app.config.ts): Android 21.3.0 and iOS 4.8.4. Cast discovery and receiver playback require a compatible receiver on the same network.

In SDK 1.29, `BitmovinCastManager.initialize(options)` is a deprecated no-op. In the generated host, edit `BitmovinCastManagerOptions.applicationId` and `messageNamespace`, then select **Save Cast options for next launch**. Fully close and reopen the app to apply them. JavaScript reload and player recreation retain the current native singleton. Blank values restore the default receiver and namespace. These public identifiers are stored in this app's private native preferences; licenses are not stored by this adapter.

**Read native Cast startup state** distinguishes saved values, startup inputs, native initialization and a pending restart. Android reads the current public native manager getters. iOS records the inputs submitted to `initializeCasting(options:)` at process launch because its public manager has no options getter. Receiver discovery, connection and playback require separate checks. The adapter initializes Cast before the SDK lifecycle listener; it uses the [public native initialization API](https://cdn.bitmovin.com/player/ios/3/documentation/bitmovinplayercore/bitmovincastmanager/index.html) without modifying the SDK. An older generated host must be regenerated or updated with the new plugin and rebuilt once to install this adapter. Generated code also includes an Expo plugin example for other hosts.
