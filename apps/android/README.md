# Player Lab for Android and Fire TV

Kotlin sample using the Bitmovin Player library, with a Compose control panel and
`PlayerView`. The app targets phones, tablets, Android TV, and Android-based Fire
TV devices.

The app pins Bitmovin Player Android **3.171.0+jason**, based on 3.171.0 released on 2026-10-16
([official release notes](https://developer.bitmovin.com/playback/docs/release-notes-android)).
Android TV and Fire TV use the same Android SDK dependency. The `+jason` artifact
relocates its Media3 dependency to `com.bitmovin.media3`. It is the compatible
variant used by Bitmovin's official
[IMA advertising sample](https://github.com/bitmovin/bitmovin-player-android-samples/blob/main/ImaAdsKotlin/build.gradle)
and [companion-ad sample](https://github.com/bitmovin/bitmovin-player-android-samples/blob/main/CompanionAdsKotlin/build.gradle).
The build uses Google IMA 3.38.0 and Java library desugaring 2.1.5, matching those
samples. The Player, Analytics, MediaSession and UI modules use the same variant;
its native `Cache` type must use the relocated Media3 namespace.

## Layout

- `playback/`: Kotlin module with playback timeline calculations, including live
  rewind, and tests for the Java Virtual Machine; these tests do not need the
  Android SDK.
- `app/`: Android player and controls. Shared Web UI assets are loaded through
  `UiConfig.WebUi` from `file:///android_asset/`.

## Test playback logic

From the repository root, with a Java development kit installed:

```bash
cd apps/android && ./gradlew :playback:test
```

## Build the app

Use Java 17 and an Android SDK matching the requirements in `app/build.gradle.kts`.
The build uses Gradle 9.3.1, Android Gradle plugin 9.1.1 with built-in Kotlin,
Kotlin/Compose plugins 2.4.20, and Android SDK Platform 37.0. These plugin versions
fit the [Kotlin Gradle compatibility table](https://kotlinlang.org/docs/gradle-configure-project.html).
The Player's OkHttp dependency requires
`compileSdk` 37; `targetSdk` remains 36 and `minSdk` remains 23. AGP 9.1.1 is
the [minimum officially supported AGP for API 37](https://developer.android.com/build/releases/about-agp).
`settings.gradle.kts` includes the app module when `ANDROID_HOME`,
`ANDROID_SDK_ROOT`, or `local.properties` supplies an SDK context. Player
artifacts are resolved from `artifacts.bitmovin.com`.

Set your keys in the repository-root `.env` as described in `docs/SETUP.md`.
From the repository root:

```bash
bash scripts/sync-env.sh
pnpm --filter @showcase/ui-shared build && pnpm sync:webui
cd apps/android && ./gradlew :app:assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

You can also open `apps/android` in Android Studio. The Gradle properties
`-PbitmovinLicenseKey=…` and `-PbitmovinAnalyticsLicenseKey=…` take precedence over
`bitmovinLicenseKey` and `bitmovinAnalyticsLicenseKey` in the untracked
`local.properties`. The sync script updates those entries from `.env` while
preserving the local SDK path.

The application ID and Kotlin namespace are `com.playerlab.android`; the test APK
uses `com.playerlab.android.test`. Allow
`com.playerlab.android` on your player license. The analytics key is optional;
when provided, the bundled collector reports playback-quality measurements to
your account. Do not commit keys or local SDK configuration.

## App language

The sample's settings, navigation, API help and status labels support English
and Japanese. They follow the device language. On Android 13 or later, choose
English or Japanese for Player Lab in the system's per-app language settings.
Changing the app language retains the current player, source and in-memory
editor drafts.

SDK identifiers, configuration values, user input, exported code and raw SDK
state remain unchanged. The bundled Bitmovin player controls use the languages
provided by that UI package; the sample's Japanese settings do not add Japanese
translations to vendor-owned controls.

## Shared player UI

The **Theme** picker selects the default Web UI or the Sports, Live, and Cinema
factories from `@showcase/ui-shared`. A custom mode creates a configuration such as:

```kotlin
PlayerViewConfig(uiConfig = UiConfig.WebUi(
    jsLocation = "file:///android_asset/bitmovinplayer-ui.js",
    cssLocation = "file:///android_asset/bitmovinplayer-ui.css",
    variant = Variant.Custom("bitmovin.playerui.UIFactory.buildSportsUI")
))
```

The source form can also use the deprecated `MediaSource` constructor for API
comparison. It creates the selected `HLSSource`, `DASHSource`, `SmoothSource` or
`ProgressiveSource` with the same URL/type and passes that actual object to
`SourceConfig`. The modern URL/type constructor remains the default.

The app recreates `PlayerView` when the mode changes. The build-and-sync command
above writes the ignored assets under `app/src/main/assets/`.

The Activity forwards start, resume, pause and stop to its active `PlayerView`,
following the [SDK lifecycle contract](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-ui-web/com.bitmovin.player/-player-view/index.html).
A replacement view catches up when the Activity is already resumed. Before a
view is retired or its player is destroyed, its lifecycle observer is removed;
the view detaches from the player before `PlayerView.onDestroy()`. The controller
retains Player ownership across UI changes.
In the SDK 3.171.0 phone-emulator check, foregrounding kept playback paused;
use the player's Play control to resume when needed.

The shared UI uses `bitmovin-player-ui` 4.x. A successful Android build does not
establish that it renders correctly in the native player library's WebView;
check rendering and input on each target.

The player stays visible beside or above the workspace. Use **Source** and
**Theme** to choose named presets, then **Settings**, **APIs**, **Code**, or
**More**. Selectors mark the current choice and keep it available for selection.
Unavailable actions use a separate disabled state. The workspace supports
directional focus; focused switches show an outline. Live-only controls are
under **More → Live controls** and are hidden
for video on demand.

On an actual television (`Configuration.UI_MODE_TYPE_TELEVISION`), the same
workspace uses larger app text, 48 dp horizontal / 27 dp vertical safe margins
and visible focus outlines. Default explicitly creates `UiConfig.WebUi` with
`Variant.TvUi` and `focusUiOnInitialization = true`. On phones/tablets, Default
retains `PlayerViewConfig()` and the SDK's `SmallScreenUi` default. A wide phone
does not become a TV. Sports, Live and Cinema retain their custom factories;
their remote navigation needs separate verification.

The SDK WebView controls and the outer Compose workspace are separate focus
surfaces. Initial WebView focus does not establish focus restoration throughout
the app. Check D-pad reachability, Select, selector dismissal with Back and
movement between the player and workspace on the intended TV. See the
[Android implementation guide](https://kazuhide.github.io/player-lab/guide/android-implementation/#android-tv-fire-tv)
for the mobile/TV comparison and input checks.

## Configuration editor

In **Settings**, choose **Source**, **Player**, or **SDK overrides**, then choose
the setting to edit. The selected editor is shown directly; Apply and Reset stay
outside its scroll area. Changes remain drafts until Apply. **Apply source** builds
a fresh source configuration and reloads the existing player. It exposes a custom
HTTP/HTTPS stream URL, DASH/HLS/Smooth/Progressive type, optional title and poster
URL, persistent poster, start offset in seconds, Start/End/SDK-default offset
reference, and optional live target latency in seconds. HTTP requests still depend on the device's cleartext network policy.
The SDK-default reference is the start for VOD and the end for live streams;
out-of-window offsets are corrected by the SDK. A blank offset uses the SDK
default. **Reset draft** returns to the currently applied source without
reloading. Selecting any catalog source, including the same preset again, replaces
the source draft and clears custom metadata, offsets, and live target latency.

A blank **Live target latency (s)** keeps the original SDK defaults (`liveConfig = null`).
An explicit finite value maps to `SourceLiveConfig.targetLatency`, changes the SDK's
definition of the live edge, and asks the SDK to approach that latency while avoiding
stalls. It is ignored for VOD. Apply reloads the source; player recreation retains the
applied value. This policy does not guarantee convergence within a deadline and is
not a qualification of stable return to the moving live edge.

The editor also exposes language, subtitle and network settings:

| Field | Value and application |
| --- | --- |
| Player audio language priority | Comma-separated language codes, highest priority first, for example `de, en`; blank means no preference. Apply restarts the player. |
| Source audio language priority | The same format; a nonempty list overrides the player preference, while blank inherits it. Apply reloads the source. The SDK chooses the highest-priority available language before downloading the initial audio; no match uses the default track. |
| WebVTT URL / Subtitle label / Subtitle language / Default external subtitle | One optional HTTP/HTTPS WebVTT track, with an optional menu label and language code. Supply the URL before applying its metadata; clear all four fields to remove it. `isDefault` is informational metadata and does **not** automatically enable subtitles. Select the track from the existing Default UI's subtitle menu. Apply reloads the source. |
| HTTP retry delays (s) | Blank retains the SDK's linear backoff; `none` disables retries. A comma-separated list such as `0, 0.25, 2` allows one retry per finite nonnegative delay, in seconds. Apply restarts the player. This does not enable DRM renewal retries. |

Language lists trim surrounding whitespace and remove duplicate codes without
changing their priority. Subtitle URL, label and language are trimmed. Empty
items in language or retry lists are rejected. These settings participate in the
same draft validation, Reset, source retention and applied-code output as the
original fields. These standard form fields do not edit request headers or callbacks;
the additional SDK API editor below provides separate typed callback adapters.
The definitions follow the pinned
[audio preference](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api/-playback-config/preferred-audio-languages.html),
[subtitle track metadata](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.media/-track/is-default.html), and
[HTTP retry schedule](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.network/-retry-http-request-config/-retry/retry-timeouts.html)
contracts.

**Apply player** creates a new player and reloads the currently applied
source, retaining its metadata/options, selected UI mode, live-control preference, and
event log. Playback restarts according to autoplay and the source start offset.
Used SDK configuration objects are never mutated. PlayerViews detach before the
previous player is destroyed, and retired player/source callbacks cannot update
the active controller. Invalid drafts leave the active player and source intact.

| Player field | Unit / default |
| --- | --- |
| Autoplay / Start muted | Off / off |
| Enable SDK live time shifting | On; separate from More → Playback options → Enable live rewind controls |
| Startup / restart threshold | Seconds; 2.5 / 5; nonnegative, at most forward buffer minus 0.5 |
| Forward buffer | Seconds; 50; at least 0.5 to leave threshold headroom |
| Maximum automatic video bitrate | Whole bits per second; blank uses `Int.MAX_VALUE` (2147483647, no ABR cap); higher qualities remain available for manual selection |
| Preload content / Allow rebuffering | On / on |
| Live quality / stability balance | 0 through 1; 0.5; relevant near the live edge only |

**Reset draft** restores the currently applied Player values without applying them.
**More → Playback options → Enable live rewind controls** immediately changes
seekbar and quick-seek visibility in the bundled UI. It replaces only PlayerView,
keeping the Player, source and playback session. It does not enable SDK time
shifting, create a rewind window, or disable VOD seeking.

Changing tabs or settings retains unapplied values. All
numeric fields reject non-finite values; bitrate uses the SDK's nonnegative `Int`
range. The field definitions and defaults follow the pinned
[PlaybackConfig](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api/-playback-config/index.html),
[BufferConfig](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.buffer/-buffer-config/index.html),
[AdaptationConfig](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.media/-adaptation-config/index.html), and
[SourceOptions](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.source/-source-options/index.html), and
[SourceLiveConfig.targetLatency](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.live/-source-live-config/target-latency.html)
references. Keys continue to come from build configuration.

**Code** displays Kotlin `PlayerConfig`, `SourceConfig`, and
`PlayerViewConfig` values for the applied settings and current UI. Draft edits are
excluded. **Copy code** writes that text to the Android clipboard; license keys
are placeholders. The source's optional live target latency is included. The
example is SDK configuration, so the integrating app must still attach the view,
forward its lifecycle, and supply its own keys.

The draft validation and mapping tests run with `:app:testDebugUnitTest`.
`PlayerConfigurationInstrumentedTest` drives the real Compose editor and SDK with
a dummy license to verify application, reset, source retention, player/view
ownership, and D-pad focus without asserting successful media playback.
`PlayerOwnershipInstrumentedTest` independently records API calls to check
exactly-once destruction, listener removal, and retired callback rejection:

```sh
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.playerlab.android.PlayerConfigurationInstrumentedTest,com.playerlab.android.PlayerOwnershipInstrumentedTest \
  -PbitmovinLicenseKey=dummy -PbitmovinAnalyticsLicenseKey=
```

`PlayerWorkspaceUxInstrumentedTest` checks direct access to every common setting,
visible Apply actions, draft retention, selection semantics, API search targets,
and large-text layouts with the software keyboard open. It also checks that
rotation retains the actual PlayerView. Use a device reserved for tests,
complete keyboard onboarding, and use a docked on-screen keyboard for the input
visibility checks.

```sh
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.playerlab.android.PlayerWorkspaceUxInstrumentedTest
```

## SDK API settings and controls

Open **Settings → SDK overrides** to find public SDK configuration fields by
feature or name. Choose a typed value, stage the override, then apply it to
recreate the player and reload its source. Applied override code is available
in **Code**. Staging a value does not change playback.
Removing an override restores the standard configuration or the SDK default on
the next Apply. DRM secrets appear as placeholders in exported code. DRM callback
fields accept editable JavaScript byte transformations as well as the Identity
and Base64 examples. Their code uses the same callback editor described below.

**APIs** provides commands with named arguments, a refreshable state
inspector, and event occurrence counts with SDK timestamps. Commands can require
an active source, an attached view, compatible media or a connected service.
The Run action names its target. Search narrows the chooser; it does not run an
API. Check the separately observed state and events after running a command.
Unavailable operations are disabled in the chooser with a reason. Run checks the
current source and SDK state again before dispatch. **Manual SSAI integration**
is an explicit per-source mode for testing metadata and lifecycle notifications;
it resets on source reload or Player replacement. **Create SSAI ad metadata**
builds a local SDK object and does not insert media into the stream. Ad playback
must be established separately from active SDK ad state and playback events.

View event subscriptions accept an event name and a subscription ID. `on` keeps
listening, `next` listens once, and `off` removes the matching ID. Subscriptions
are retired when their view detaches or is recreated. Their counts appear with
the `PlayerView.` prefix in Events. These are view UI events such as
`FullscreenEnter` and `FullscreenExit`. Playback events are observed on Player,
and source events on Source.

The view-handler commands install host fullscreen, picture-in-picture, or custom
Web UI message behavior. Fullscreen expands the video and hides the form; Back
restores it. Picture in picture requires Android and device support. Its width
and height arguments control the aspect ratio. The custom message handler exposes
`playerLabMessage(data: String)` and returns the configured reply; a custom Web UI
must call that endpoint. Incoming messages remain in memory for this session.
Surface and texture commands use the actual attached rendering view. To change
the rendering type, first apply `PlayerViewConfig.surfaceType`. Raw surfaces are
cleared before their holder or owning view is retired. The destroy commands
recreate the affected player or view so the controls remain usable.

## Structured SDK inputs and native resources

List fields use an item editor with separate typed controls. Add items, edit their
fields, then stage and apply the whole value. Nested **roles** and **sources**
buttons open child editors. `null`, an empty list and an empty string remain
separate values where the SDK supports them.

- **SourceConfig.subtitleTracks** creates external subtitle tracks with editable
  IDs, MIME type, language, associated language, forced/default flags and track
  roles. Track IDs must be unique. Default metadata does not enable a subtitle.
- **AdvertisingConfig.schedule** builds ordered `AdItem` values, each with its
  own fallback `AdSource` list, source type, tag, loading timeouts, ad position,
  replacement duration and preload offset.
- **PlaylistConfig.sources** loads an ordered playlist instead of the standard
  source form. Per-item title, description, poster and start options are editable.
  Global Source overrides apply to every item. **PlaylistOptions** controls
  preloading and replay; preloading can increase memory and network use.
  The generated code declares the options before loading the playlist and applies
  Source overrides inside every item's configuration. Removing the source-list
  override restores the standard source form. A downloaded offline source takes
  precedence while offline playback is selected.
- **AdvertisingConfig.companionAdContainers** creates actual `FrameLayout` hosts
  below the player and passes those `ViewGroup` instances to the SDK. Positive
  dimensions are passed as requested ad dimensions and use density-independent
  pixels in this sample's host layout. Set both dimensions to `-1` for a fluid
  companion. Compatible ad media is required for a host to receive an ad.
- **TweaksConfig.exoPlayerCache** creates a real Media3 `SimpleCache` with
  least-recently-used eviction. This SDK tweak reads a prefilled cache; ordinary
  playback does not populate it. It is ignored for `OfflineSourceConfig`.
  `null` disables the next player's cache. Sample caches are limited to 1 GiB.
  Use the offline manager for SDK-managed downloads and offline playback.
- **SourceNetworkConfig.engine** selects `HttpURLConnection` or a real Cronet
  engine. Select **NetworkEngine.Cronet.cronetEngine** to edit HTTP/2, QUIC,
  Brotli and user agent options. Press **Prepare Google Play services Cronet**
  and wait for the ready state before applying. Devices need working Google Play
  services; selected options do not establish which network protocol a server
  negotiated. The integration follows the official
  [Cronet sample](https://github.com/bitmovin/bitmovin-player-android-samples/tree/main/CronetPlaybackKotlin).

Cache and Cronet resources are shared by constructor values within the app
process. They are not closed when a player is replaced: an SDK source can still
be retiring after `Player.destroy()`. The process retains at most four cache
sizes and four Cronet configurations. Reuse a configuration or fully restart the
app when this limit is reached. Native companion views are created for each new
player and detached with their owning composition.

The build uses Google Play services Cronet 18.1.1 with `cronet-api` 143.7445.0.
The explicit API dependency avoids the duplicate namespace in the 141 split
artifacts under Android Gradle plugin 9 while retaining Android API 23 support.
Cronet 500.1.0 declares minimum API 24 and is not used because this sample retains
API 23 support. Core library desugaring is enabled for IMA; minimum Android version
is not raised to resolve a dependency conflict.

**DebugConfig.isLoggingEnabled** is a startup-only control. Save the value in SDK
API settings, fully stop the app, then reopen it. `Application.onCreate()` applies
it before creating SDK components. The panel shows the current process value and
the saved next-launch value separately. Debug logging can include confidential
information. Keep those logs local and turn logging off after debugging.

The offline panel includes **Advanced offline source constructor** for the public
`OfflineSourceConfig` constructor. It edits the offline DRM key-set ID as hidden
hexadecimal bytes, `isRestrictToOffline`, and app-private cache/track-state names.
The constructor uses the current stream URL and type; the generated code replaces
DRM bytes with `privateDrmIdBytes`. This does not import an SDK-managed download.
For normal downloads, use **Play downloaded source** so the manager supplies its
cache metadata. A restricted source needs matching cached files and track state;
an arbitrary DRM ID is not an issued offline license.

## VR renderer controls

`VrApi.setVrRenderer()` enables or disables the sample's decoder-backed OpenGL
renderer. It replaces the normal `PlayerView` and restores a new `PlayerView`
when disabled. Configure the source's VR content type before enabling it. The
renderer supports the SDK's flat, single-view, side-by-side and top/bottom layouts
and reads actual VR viewing direction and stereo state.

`VrRenderer.setSourceConfig()` accepts the active source, the configured source
or `None`. `addUpdateCallback()` takes a handle, a JavaScript body and
`everyFrames` for script sampling. The SDK frame clock still updates every draw;
`delta` is seconds. The body receives `{delta, viewingDirection}` and returns
`{text?, move?: {phi, x, y}}` or `null`. A move calls the actual SDK VR API.
`removeUpdateCallback()` removes the exact handle. Pending results and callbacks
are rejected when their renderer or player retires. **app:vr-renderer** state
shows decoder/draw counts and callback outcomes. A flat test video does not
qualify spherical content, headset rendering or all device graphics drivers.

## Callback editor

Fields marked **Script** accept the body of a JavaScript function whose argument
is `input`. The field description shows its input and return contract. Stage the
body and apply the settings before it runs. Enter `null` to disable the override.
For example, a subtitle labeler can use:

```javascript
return input.language === 'en' ? 'English captions' : input.label;
```

The app converts the result back to the exact SDK return type. Decoder callbacks
return indexes into the SDK-provided decoder list, retaining the original native
decoder objects. HTTP callbacks return typed request/response values; `null`
keeps the original. Byte arrays use integers from 0 through 255, up to 65536
bytes. Larger input bodies are omitted from the snapshot and retained unless
explicitly replaced. Response preprocessing makes the SDK buffer whole responses;
select only the needed `TweaksConfig.httpResponseTypesToPreprocess` request types
to avoid buffering video segments. Advertising scripts receive ad metadata and
return a decision, retained item indexes, macro values or a media-file index, as
specified by each field. The video adaptation hook returns an available quality
ID. Cast media-info configuration runs only when a Cast session requests it.
Its typed media-type control is an alternative to the editable callback; select
one. IMA callbacks receive plain settings snapshots or manager state. A settings
body returns a validated partial patch; a manager body returns a validated list
of native manager actions. The app validates the complete result before applying
any mutation. Manager state that is not available yet appears as `null`.
Interstitial mapping scripts register native tracking events and a click-through
URL; the SDK owns when those tracking URLs are requested.

Analytics controls also provide a **Custom** error transformer body. It receives
`{code, message, severity, originalErrorType}` and returns a partial
`{code, message, severity}` object. `severity` is `CRITICAL` or `INFO`; `null`
retains the original error. The public collector return type is non-null, so
this adapter does not claim to suppress error events. Opaque original SDK
objects are not exposed to the interpreter. It uses the owning player's callback
context and the same execution limits.

Only the explicitly applied body runs. Code remains in memory and is omitted from
exports, where `<YOUR_CALLBACK_BODY>` marks the replacement point. The generated
assignments use [ApiScriptSettings](app/src/main/kotlin/com/playerlab/android/ApiScriptSettings.kt)
and [ApiScriptProgram](app/src/main/kotlin/com/playerlab/android/ApiScriptProgram.kt)
from this sample; create an `ApiCallbackContext` before applying those assignments
and close it when retiring its Player or Source. The UI refresh shows invocation
and fallback counts without recording callback arguments, headers or bodies.

The interpreter has no Java/Android bridge, network, filesystem, Player or Source
objects. Each invocation is limited to 50000 interpreter instructions, 25
milliseconds of thread CPU time, 250 milliseconds of elapsed wall time, and a
stack depth of 64. CPU time measures work on the callback thread; wall time also
includes time when that thread is not executing. If thread CPU accounting is
unavailable or becomes unavailable, the invocation uses a 75-millisecond
wall-time limit. Limits are checked at interpreter and value-conversion
checkpoints; native built-ins are not preempted. Invalid results retain native
behavior. It is an in-process development tool,
not an isolated memory sandbox. The runtime uses the Android-compatible Java 8
maintenance release [Rhino 1.7.15.1](https://github.com/mozilla/rhino/releases/tag/Rhino1_7_15_1_Release).
Rhino's source and license links are included in the APK's
[third-party notice](app/src/main/assets/third-party/rhino-notice.txt).

## Android media session

To publish metadata and transport controls to Android, stage
`MediaSessionSourceConfig.Enabled.mediaMetadata` in the API settings. Enter one
`key=value` per line, for example:

```text
displayTitle=Sample video
subtitle=Playback configuration example
artist=Sample artist
mediaType=Movie
duration=60000
```

The editor lists the supported metadata fields. Duration is in milliseconds;
track and disc numbers are integers. Ratings use `Heart:true`, `Thumb:false`,
`Percentage:75` or `Star:5:4.5`. Set a value to `null` to leave it unset.
Apply the settings, then run **Enable Android media session** in **APIs**.
The session follows the current player when it is recreated. Disable the same
control to release it. This optional integration uses the SDK's
`player-media-session` module and does not request notification permission.
Android decides where active session controls appear.

## Offline controls

The offline panel downloads selected renditions of the current video-on-demand
source. Downloaded files remain in the app's private storage until explicitly
deleted or the app is removed.

1. Open **More → Offline**. Select a downloadable source in Settings, or choose
   **Use sample DASH source** in Offline. The sample is a short Big Buck Bunny asset.
2. Allow download notifications, enter a stable content ID, then create a manager.
   Reuse the same ID to inspect the same stored content. Use a different ID for a
   different source.
3. Set simultaneous download and segment limits, device requirements and DRM
   handling, then apply the service configuration. Required device conditions
   such as charging or an unmetered network can keep downloads waiting.
4. Fetch the SDK options. For each desired video, audio, subtitle or thumbnail
   entry, choose Download or Delete, then process the selected actions. None
   clears a pending action. SDK track state determines which actions are valid.
5. After the selected entries report Downloaded, choose **Play downloaded source**.
   Player setting changes retain the SDK's offline source and its cache metadata.
   Applying a regular source returns to online playback.
6. Use **Delete all content for this ID** to remove its stored content. Releasing
   the manager frees its in-memory resources and keeps the files. Offline DRM
   license commands need compatible encrypted media and license-server support.

The panel shows progress, track properties, storage usage and available DRM
durations. Offline SDK errors, information and warnings also appear in the API
event inspector. License bytes and opaque DRM identifiers are not exported.
The SDK dependency, permissions and service setup follow the
[official offline playback guide](https://developer.bitmovin.com/playback/docs/working-with-offline-playback-android).

`PlayerOfflineInstrumentedTest` drives track selection and configuration through
the GUI, downloads the short sample, disables Wi-Fi and mobile data, checks that
there is no active network, and verifies offline playback before and after player
recreation. It restores the device's radio settings in cleanup. Run it only on a
device reserved for the test, with a valid allowed license:

```sh
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.playerlab.android.PlayerOfflineInstrumentedTest
```

## Analytics controls

Open **More → Analytics** to configure collection separately from playback. It
uses the local build key by default, allows a session-only license override,
or can request the Analytics license associated with the Player license. Choose
Disabled to stop collection. Applying settings recreates the player and source.
Exported configuration replaces license values with placeholders.

Edit default or source metadata by selecting a named field, entering a value and
staging it. Remove a field to restore its null/default value. Source metadata
takes precedence over default metadata. Custom fields and the experiment name
are available in both editors. `isLive` accepts true or false; omitting it keeps
automatic detection.

Runtime actions can update source custom data, send an event-only custom payload,
or signal a program change on the current source. The state reader shows the
collector's impression ID, user ID and source metadata. SSAI controls report
ad-break, ad and quartile transitions to the collector; use them alongside real
stitched-ad playback. The example error strategy replaces the reported message
while retaining its error code and severity. Collector retry policy can retain
failed samples for later delivery, including offline playback with LONG_TERM.

Use Bitmovin Dashboard to confirm that samples arrived and inspect their session
details. A local SDK API result or impression ID alone does not establish backend
ingestion. The integration follows the
[integrated Analytics API](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-analytics/com.bitmovin.player.api.analytics/-analytics-api/index.html)
and the [official Android collector](https://github.com/bitmovin/bitmovin-analytics-collector-android).

`PlayerAnalyticsInstrumentedTest` checks GUI application, native source metadata,
custom-data persistence, event-only data and program-change impressions during
actual media playback. It keeps Dashboard delivery verification separate.

## Playback checks

Unit tests and APK builds do not verify licensed playback. On a device or
emulator, check live seeking, returning to live, and recovery when paused media
expires. Android TV and Fire TV also need remote-control checks; the app declares
a `LEANBACK_LAUNCHER` entry for TV launchers. Use your own license and reachable
test streams.

The full instrumented suite also uses a local 60-second HLS/DASH finalization
fixture. Generate the [local test media](../../docs/local-test-media.md), then
start its server from the repository root with Node 24:

```sh
python3 encoding/test-streams/local.py
node apps/android/runtime-fixture.mjs .cache/test-streams/vod-baseline
```

In another terminal, connect the owned emulator or device and forward the three
loopback ports before running the suite from `apps/android`:

```sh
adb reverse tcp:5272 tcp:5272
adb reverse tcp:5273 tcp:5273
adb reverse tcp:5274 tcp:5274
cd apps/android
./gradlew :app:connectedDebugAndroidTest
# Remove these forwards and stop the fixture server after testing.
adb reverse --remove tcp:5272
adb reverse --remove tcp:5273
adb reverse --remove tcp:5274
```

The debug build permits HTTP only for `localhost` and `127.0.0.1`; release network
policy is unchanged. The fixture and authorized license are required for the full
suite. Select individual test classes when checking only their documented scope.

For automation, the Android-specific entry point builds and installs both APKs,
runs the public `AndroidJUnitRunner` on an explicitly selected device, and writes
a safe JSON result. It requires successful individual tests and the final runner
completion; an `adb` exit code of zero alone does not pass. Raw build and test
output stays in the private directory outside the repository. The runner stops
the app and test package afterward, including on timeout. It does not start an
emulator or manage the fixture server or port forwards:

```sh
python3 apps/android/runtime-tests.py --serial emulator-5554 \
  --output-dir /tmp/player-lab-android-runtime
# Configuration-only example; this builds with a dummy key and cannot qualify playback.
python3 apps/android/runtime-tests.py --serial emulator-5554 \
  --output-dir /tmp/player-lab-android-configuration \
  --dummy-license --classes com.playerlab.android.PlayerConfigurationInstrumentedTest
python3 apps/android/test-runtime-tests.py
```

Use `--classes` with comma-separated classes or `class#method` to limit the scope.
`--skip-build` uses existing APKs and must be used only after building the intended
source and credential configuration. Configuration-only and playback results must
be reported separately.

The same fixture serves the generated `vod-multiaudio` sibling directory on
port 5274, WebVTT cues spanning the 60-second video, and a manifest that fails a bounded number of
times before serving the original bytes. The control endpoint exposes only
counters and a reset accepting zero through three failures. The server stays on
loopback and does not proxy upstream requests or log request data. Its own checks
run with `node --test apps/android/configuration-fixture.test.mjs` from the repository root.

`PlayerLanguageNetworkInstrumentedTest` uses the real configuration editor and
public SDK APIs to check initial audio-language selection, a source override and
return to player inheritance; external subtitle metadata followed by a visible
Default UI menu selection, a fresh native cue and visible subtitle text; and two
configured HTTP retries versus no retries. The expected no-retry source error is
kept separate from successful playback, then a healthy source reload must advance
on the same player. It uses the authorized license and the fixture above, with no
private observer or diagnostic bridge.

`PlayerDvrInstrumentedTest` checks the real library's source loading and finite
on-demand duration. `PlayerControlsInstrumentedTest` uses the app's actual Compose
buttons and switch, checks the bundled Sports UI's elements and stylesheet in its
WebView, starts playback through that UI, then checks source switching, live
rewind, return to live, and the DVR setting. Both tests need network access and a
valid license allowing `com.playerlab.android`; neither substitutes a mock player.
Player and Source failures report numeric error codes without printing their
messages or license values. A failed license request is a failed playback check,
even when compilation and packaging pass. Leave the optional Analytics key empty
when no collection is intended.

`PlayerConfigurationPlaybackInstrumentedTest` requires the authorized license
and checks the new editor's actual playback effect: a custom VOD source starts
muted at the applied 10-second offset and advances automatically after applying
player settings. The configuration-only tests do not establish media playback or
completion of all SDK resource cleanup; `Player.isDestroyed` reports API
invalidation, and the recording test counts the app's destroy calls.
The start-offset check captures the first `TimeChanged` after both `Ready` and
`RenderFirstFrame` for the newly applied source and player. It retains the
9.0–13.0-second range and 40-second deadline, including zero samples. Loaded and
`isPlaying` alone can precede those readiness events.

The standard UI checks drive Play, Pause, Mute, Unmute, the seek bar, 1.5x speed,
and audio/subtitle/video-quality choices, then verify native state or fresh native
completion events. A seek-bar hover reaches the native thumbnail query; the
reference asset returns no thumbnail image. The SDK's deprecated
`Player.getThumbnail` delegates to the active `Source.getThumbnail`. On the tested
phone, fullscreen and picture-in-picture have no configured handlers or visible
buttons, and the mobile volume slider is hidden. Those routes are recorded as
unavailable rather than playback successes.

`PlayerFinalizationInstrumentedTest` changes HLS to ENDLIST and DASH to static
at the same URL. It checks fresh `PlaybackFinished`, finite native duration and
position, retained source/player, disabled DVR/live commands, visible Replay and
replay-clock progress, fresh VOD seek completion, a new live generation, and an
explicit VOD switch. Shared live labels stay hidden during Replay and return for
the new live load. This sample derives VOD from the SDK's finite duration; it does
not replace native getter values.

`PlayerConfigurationCodeInstrumentedTest` checks draft exclusion, applied source
and live policy, current UI selection, Copy feedback, and exact text in the real
Android clipboard. It does not require successful media playback.

`PlayerUiHandoffInstrumentedTest` keeps the same player playing VOD while cycling
through Sports, Live (DVR), Cinema and Default three times. It checks that each
retired view detaches, one active view intersects the viewport, and playback time
advances after every handoff. A separate check drives the real Activity through
two stopped/resumed cycles, then replaces the UI while resumed. It checks source,
settings, UI and Allow DVR retention, muted playback progress, viewport visibility,
and Player invalidation with no recorded errors through Activity teardown. It
requests playback explicitly after foregrounding. These
checks require an authorized license; they do not prove that all SDK resources
have completed release.

`PlayerViewLifecycleTest` uses a real AndroidX lifecycle registry on the JVM. It
checks host event order, immediate catch-up for a resumed replacement, observer
removal and rejection of late views after release. The recording ownership test
separately checks app-owned Player destruction.

The shared UI can exist before its playback control becomes visible. The test
waits for that control, then checks that native playback time advances. It reveals
controls through WebView pointer input, or one native tap on a visible Default
touch overlay when its controls have hidden, and checks element dimensions and the
computed display, visibility and opacity of each ancestor. Hidden controls with
nonzero dimensions do not establish a visible result.

Live offsets use a moving reference: the live edge can advance while a rewind
buffers. The test fixes a media reference from the SDK-reported position and
offset just before seeking, then checks that the next `TimeShifted` event lands
within three seconds of the resulting target. It also requires a negative live
offset and the visible behind-live state. The return-to-live check requires a new
completion event, an SDK-reported offset within one second of zero, and visible
`LIVE` text and button state within the same 40-second deadline. The native
predicate is checked again after the visible UI check.

`LowLatencyApi.latency - targetLatency` is recorded separately: it measures distance
from the configured latency target, which the SDK approaches while avoiding
stalls. It is not a promised sub-second convergence deadline. The SDK can classify
playback as live (`timeShift == 0`) while that distance remains nonzero.
[Source.seekableRange](https://cdn.bitmovin.com/player/android/3.171.0/docs/player-core/com.bitmovin.player.api.source/-source/seekable-range.html)
returns `(0, 0)` for live sources and cannot provide a separate live media endpoint.
Request-time targets, current position, latency, configured/effective targets,
forward audio/video buffers and seekable range remain numeric diagnostics.

If that check fails, its report includes monotonic request/completion times,
the requested media target, completion position and offset, native-ready poll
count, and the live controls' text, classes, dimensions and hidden ancestors.
It does not include SDK error messages or configuration dumps.

The app's event log also retains startup error codes, so a failed initial request
can be distinguished from a source that is still loading.

Before migration to the current application identity, on 2026-10-21,
Player 3.171.0 passed 18 JVM tests (six DVR, ten configuration
and two lifecycle tests) and debug app/instrumentation builds. The authorized
Android 16/API 36.1 ARM64 phone-emulator group passed all 16 checks in 237.139
seconds: configuration/ownership, configured VOD autoplay/mute/start offset,
strict live return, standard SDK UI actions and availability, HLS/DASH
finalization, applied-code/clipboard behavior, finite VOD duration, 12 UI
handoffs, and two background/resume/UI-replacement cycles with explicit Play.
Normal live return completed in 157 ms, within +0.002 s of its requested target;
native zero offset and genuinely visible LIVE agreed 206 ms after the request.
No automatic seek retry is included.

The configured VOD check captured 10.256 s after fresh Ready and first-frame
events for the applied source. The final HLS/DASH follow-up passed both cases in
69.860 s, explicitly checking a fresh VOD Seeked event and visible live controls
restored by a new load. The optional 30-second target-latency policy also passed
the coupled completion/native-offset/visible-LIVE check under a controlled
emulator delay. These recorded runs do not establish a seek-completion or
latency-convergence SLA. The optional policy keeps the SDK synchronization
defaults; temporary catch-up adjustments are not reported by Player.playbackSpeed.

For the current `com.playerlab.android` identity, Player 3.171.0 passed
24 JVM tests, app/instrumentation builds and seven configuration-only
instrumentation checks. Separately, a fresh licensed Android 16/API 36.1 ARM64
phone-emulator run after the menu touch correction passed all 20 instrumentation
checks in 274.859 seconds. Both license-free touch fixture cases also passed
separately; they exercise local WebView content and do not establish licensed
playback.
That group includes the existing playback, strict live, HLS/DASH finalization,
standard UI, clipboard and lifecycle cases, plus language priority/source
override, external WebVTT menu selection with a fresh native cue and visible
caption, and configured retries versus no retries. The configuration-only
checks do not establish playback; the licensed group checks actual SDK media.

These checks use an Android phone emulator. Physical-device, Android TV, Fire TV,
casting and Analytics delivery require their respective environments. Offline
download and playback are covered separately by the test described above.
The recorded native observations establish playback and control behavior; they
do not measure complete internal SDK resource reclamation.

## Applied configuration code

Open **Code** to read the Player, Source and selected
UI settings sent to the SDK. Draft edits do not change this output. **Copy code**
writes the code to the Android clipboard; you can also select the text. License
values are excluded and the Player key is a placeholder. Lines wrap by default;
turn wrapping off when comparing indentation. The app's live-control switch
remains separate from the SDK configuration.

## Scrolling player menus

The embedded player menu can scroll independently of the selected editor.
Swipe inside the video menu to reach its lower items. The fixed workspace
navigation and Apply actions do not require scrolling through a form. A parent
scroll container can intercept a gesture intended for the embedded menu. The
host keeps a handled player gesture with the video
until it ends or is cancelled, and releases it when the view is removed.
This uses Android's public
[touch interception contract](https://developer.android.com/reference/android/view/ViewParent#requestDisallowInterceptTouchEvent(boolean)).

The license-free device fixture checks real WebView overflow scrolling, outer
form scrolling and cancellation/release handling. From `apps/android`, run:

```sh
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.playerlab.android.PlayerTouchHostInstrumentedTest \
  -PbitmovinLicenseKey=dummy -PbitmovinAnalyticsLicenseKey=
```

Rebuild with your normal allowed key before running playback checks.
