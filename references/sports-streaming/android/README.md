# Sports Streaming for Android

An independent Bitmovin Player integration for live events, clips and archives. The standard Player UI and sports controls use the same Player and Source.

## Requirements

- JDK 21, Android SDK Platform 37.0 and Android SDK build tools.
- An Android device or emulator running Android 7.0 (API 24) or newer.
- A Bitmovin Player license that allows `com.playerlab.sportsstreaming`.
- An Analytics collector license to verify impression continuity and collect playback quality data.

Player, integrated Analytics and standard Web UI are pinned to the public Android SDK `3.172.0`. Google Cast uses the SDK's Cast manager and Google Cast Framework. Cast receiver playback requires a compatible receiver and media URLs reachable from that receiver.

## Local configuration

From this directory:

```sh
cp .env.example .env
```

Set `BITMOVIN_PLAYER_LICENSE_KEY` in `.env`. Set `BITMOVIN_ANALYTICS_LICENSE_KEY` to enable the integrated collector. Both values are compiled into the app; use licenses intended for this sample. Never put an account API key in this file. The dedicated Analytics BFF keeps its account API key on the server.

`MEDIA_BASE_URL` resolves this reference's catalog and relative media URLs. The default `http://10.0.2.2:8622/` reaches the development computer from an Android emulator. For a physical device or Cast receiver, use a host reachable on the same network. Cleartext HTTP is enabled only in debug builds. `CATALOG_URL` optionally overrides the catalog endpoint.

Each configuration file belongs to this app. The build does not read another app's environment or Gradle project.

## Build and unit tests

```sh
./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest --no-daemon --max-workers=2
```

The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. The test APK is `app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`. The app also packages this reference's `../fixtures/catalog.json`; media preparation and the local server are described in the reference's README.

Run the [device checks](#reproducible-device-checks) to verify playback and UI ownership. The driver supplies both the media and caption fixtures and requires one explicitly selected device.

## Controls and implementation

Select an event or a clip to start playback. The Archives tab lists assets whose event has published an archive. HLS/DASH selection creates a new Source; changing the UI keeps the existing Player, Source, position and Analytics impression. The sports UI adds seek actions, captions, speed, fullscreen and picture in picture. Unavailable playback actions are disabled.

After a live event ends, playback continues while the archive is prepared. Open Archives from the playback options to select an archive, continue at a mapped position, start from the beginning or enable automatic continuation. Automatic continuation is off by default. A paused session remains paused when its position is continued. Source-load acceptance alone does not confirm a successful handoff.

A clip returns to the live edge by default. Returning to the previous position is offered only when the publisher reports that position inside its current seekable range. The app checks the SDK range again before seeking. If the position has expired, it does not substitute the live edge or zero.

VOD positions are measured from the start of the source. Live time-shift offsets are negative, with zero at the live edge, and move as the stream progresses. A negative live offset is not a VOD start position. The app converts SDK playback timestamps to UTC using the documented offset, then uses a verified continuous origin or interval map for edited archives. Unknown mappings and archive endpoints never trigger automatic replay.

The standard UI and custom UI share the owner in [PlaybackSession.kt](app/src/main/java/com/playerlab/sportsstreaming/PlaybackSession.kt). [PlayerSurfaceHost.kt](app/src/main/java/com/playerlab/sportsstreaming/PlayerSurfaceHost.kt) detaches the Player before pausing, stopping or disposing its old view, since those lifecycle methods also affect an attached Player. A single native subtitle renderer remains subscribed while hidden in standard mode, so switching UI while paused does not lose the current cue.

Cast uses `BitmovinCastManager.initialize()` and its default CAF receiver. The receiver must be explicitly selected. Media URLs must be reachable by the receiver; emulator-only addresses are rejected. Receiver source, position and play/pause state are checked through CAF media status. After a disconnect, the app pauses local playback and asks how to return. Unknown receiver position stays unknown. Receiver quality data needs a receiver-side collector and verified identification; it is not inferred from the Android collector.

## Reproducible device checks

Python 3.11 or newer and Android SDK build tools are required. Build the app and test APK first, then select exactly one device:

```sh
python3 tools/check-instrumentation-classes.py
python3 tools/run-device-tests.py \
  --serial YOUR_DEVICE_SERIAL \
  --media-base-url https://YOUR_MEDIA_HOST/ \
  --captures --orientation both
```

Use `--adb PATH --adb-port PORT` when an existing development server requires a specific ADB client or port. The driver never selects a device automatically or starts or stops a device/server. It checks for pending installs, verifies the installed base APK hashes and reuses identical bytes. Changed APKs are verified again after installation; split APKs are not accepted. Sanitized receipts are written under `build/device-tests/`.

The default checks use real HLS and DASH playback, selected English captions, non-default speed, paused and playing UI changes, native caption glyphs and source-selection behavior. `--captures` adds actual English/Japanese screens. `--font-scale 1.3` tests larger text in this app only. Native captures exclude system bars. If a separate video surface is absent from a window copy, use `--capture-method display` to capture the composited display and crop its actual app bounds.

The debug-only `mediaBaseUrl` intent/instrumentation argument overrides the media host without rebuilding a private license into a new APK. Release builds ignore this override. Captures and transcripts remain build artifacts.

Cast is a separate opt-in check:

```sh
python3 tools/run-device-tests.py \
  --serial YOUR_DEVICE_SERIAL \
  --media-base-url https://YOUR_RECEIVER_REACHABLE_HOST/ \
  --cast-receiver 'YOUR_AUTHORIZED_RECEIVER_NAME'
```

The test selects only that exact display name. It requires real receiver status for clips, Live/DVR, archive playback, pause/resume and disconnect recovery. Start a fresh normal event and let the short archive become ready in real time. Missing hardware, a missing receiver or an unavailable stream fails the check; it does not produce a simulated pass. These checks do not replace the separate event-duration and thermal tests described in this reference's guide.

For prepared video on demand (VOD) sources, `CastPlaybackTest` accepts the
explicit instrumentation argument `-e vodOnly true`. This mode retains the
clip, receiver pause/resume, archive and disconnect checks; it excludes the
Live/DVR branch. The public device driver always uses the full default mode.

## Normal-event endurance check

`EnduranceTest` is a separate opt-in test. Start a fresh normal event on this
reference's media server; the test must join within its first minute. Use a
physical device for thermal observations. An emulator can check functionality
but does not represent a phone's thermal behavior.

After building and installing the app and test APKs on one explicitly selected
device, run one protocol per fresh publisher session:

```sh
adb -s YOUR_DEVICE_SERIAL shell am instrument -w -r \
  -e class com.playerlab.sportsstreaming.EnduranceTest \
  -e mediaBaseUrl https://YOUR_MEDIA_HOST/ \
  -e protocol HLS \
  -e expectedLiveAssetId SP-LIVE-EVENT \
  -e targetDurationSeconds 1800 \
  com.playerlab.sportsstreaming.test/androidx.test.runner.AndroidJUnitRunner
```

Use `DASH` for the other protocol. `targetDurationSeconds` accepts 1800 through
7200; the minimum requires actual elapsed time and cannot be shortened with an
accelerated fixture clock. The test rejects a short event or a publisher whose
media clock runs faster than wall time. It keeps only this app's window awake
and restores that window flag afterward.

The test checks actual video-surface pixels and playback clocks, a seek behind
live, pause/resume and a real pause until the saved UTC leaves the publisher's
retained window. It reads current SDK bounds before an explicit return to the
live edge, keeping the same Source and impression. Near the event end, it holds a paused position and checks that
event end and archive readiness remain separate without a Source reload. It
then verifies the mapped archive position, pause intent and a new impression.
An SDK transition from live to an ended playlist is recorded as observed.

Retrieve this app's bounded receipt after the test:

```sh
adb -s YOUR_DEVICE_SERIAL exec-out run-as com.playerlab.sportsstreaming \
  cat files/endurance/hls.json > hls-endurance.json
```

For DASH, use `dash.json`. The receipt retains up to 200 observations, actual
wall time, sampled live/post-playlist/archive clock advancement, changed video
frames, this process's memory and available device thermal status. Paused
intervals are part of the workflow; elapsed test time is not continuous
live viewing time. These observations do not establish absence of memory
leaks or certify receiver quality or thermal performance. A process crash
fails instrumentation even if it prevents the app from writing its receipt.

Video samples use Android's [PixelCopy](https://developer.android.com/reference/android/view/PixelCopy)
on the actual `SurfaceView`. Thermal status uses
[PowerManager](https://developer.android.com/reference/android/os/PowerManager#getCurrentThermalStatus())
on Android 10 or newer; older versions record it as unavailable.

## SDK references

- [Android Player API](https://cdn.bitmovin.com/player/android/3/docs/player-core/com.bitmovin.player.api/-player/index.html)
- [Playback timestamp conversion](https://cdn.bitmovin.com/player/android/3/docs/player-core/com.bitmovin.player.api/-player/current-time.html)
- [Source start offsets](https://cdn.bitmovin.com/player/android/3/docs/player-core/com.bitmovin.player.api.source/-source-options/start-offset.html)
- [CAF setup and receiver behavior](https://developer.bitmovin.com/playback/docs/caf-support)
