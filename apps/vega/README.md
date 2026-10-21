# Bitmovin Player sample for Vega OS and Fire TV

Vega OS is a separate target from Android-based Fire TV. This example uses the
modular Bitmovin web player attached to a W3C media element, with React Native /
Kepler controls. It does not use the browser-based `bitmovin-player-ui` because
that library requires a browser document. DVR means the window of live media that
a viewer can rewind.

This folder includes an opt-in Kepler application host for the existing App.
Its public dependencies retain `bitmovin-player@8.138.0-beta.28` and use Amazon's
React Native 0.72 profile: Kepler 2.1.0, W3C Media 2.3.2 and OS 1.2. The native
build requires a separately installed Vega SDK. Third-party libraries and
platform tools remain external dependencies with their own licenses and access
requirements; they are not bundled or relicensed by this repository.

Vega uses a separate Player release channel. As of 2026-10-20, the
[official Vega sample](https://github.com/bitmovin/bitmovin-player-web-sample-fire-tv-vega/blob/0c7463104d3c18f56440aeec7beccd0d92c11aaa/README.md#features-and-limitations)
supports only `8.138.0-beta.XX`; its latest
[listed release](https://github.com/bitmovin/bitmovin-player-web-sample-fire-tv-vega/blob/0c7463104d3c18f56440aeec7beccd0d92c11aaa/PLAYER-CHANGELOG.md)
is `8.138.0-beta.28`, which this app retains. Keep this Vega-specific pin when
updating the browser and native SDKs; general Web releases are not declared
supported on Vega by that sample.

## Layout

- `src/dvr/`: TypeScript rewind-window calculations and state handling.
- `src/dvrController.ts`: player events, clamped live seeking, live-to-on-demand
  transition handling, and expired-position recovery.
- `src/vegaPlayer.ts`: modular player registration and construction.
- `src/playerSession.ts`: session ownership, foreground teardown and synchronous
  background media release.
- `src/Sources.ts`: player source configurations.
- `src/App.tsx`, `src/ControlPanel.tsx`, `src/BitmovinPlayer.tsx`: Kepler controls
  and video surface, including `KeplerVideoSurfaceView` and native TV focus.
- `src/polyfills.ts`: public native media/crypto providers, XML DOM, Base64 and
  the session-owned media-element adapter.
- `src/playerConfig.ts`: the Fetch transport required by Vega.
- `src/ConfigurationPanel.tsx`, `src/configuration.ts`: validated source and
  creation-time playback/buffer/adaptation controls.

## Test and type-check without the Vega toolchain

From the repository root:

```bash
pnpm --filter @showcase/vega test
pnpm --filter @showcase/vega typecheck
```

The type-check includes the actual App, configuration/control panels, video
surface component, tests, rewind logic and modular player wiring against the
installed SDK, React Native and Kepler declarations using the app's React 18 types.
Passing these commands does not establish that the device app builds or plays.

The session tests use delayed Promises with fake media and player objects. They
check source changes during initialization and loading, foreground/background
cleanup ordering, reentrant disposal, partial surface attachment, source-reset
failures, release failures and the current "Allow DVR" setting. Retirement invalidates callbacks
once. A replacement waits for confirmed native release and fulfilled SDK
destruction before installing the global media shim. Unconfirmed owners remain
held behind the same barrier, including a cancelled waiter behind an earlier
Apply. These tests do not exercise the Vega runtime, a device video surface, or
playback.

The App interaction tests mount the App components with mocked native hosts,
W3C media and player objects. Tests cover draft isolation, validation,
Apply/Reset, direct SDK mapping, preset/source retention, URL validation with
incomplete native global URL getters, and rapid Apply during initialization or cleanup.
They also cover background source/config changes, retained settings/drafts,
retired surface generations and both foreground/surface event arrival orders.
Unexpected console errors/warnings fail these tests. No TV layout, focus behavior, software
keyboard or playback is qualified by this renderer.

The runtime adapter tests execute the real XML DOM and Base64 packages while
mocking only the Amazon native boundary. They check the installed media/crypto
providers, media attribute operations, native URL preservation, and removal of
only the session's own media element. These checks do not run a Vega media engine.
The host tests also check the private runtime-config writer, entry-point ordering
and Fetch configuration merging. Playback progress still reaches the state line
through SDK events; disposing the controller stops later progress updates.

## Configuration controls

Open **Show configuration** to edit a source URL/type (HLS, DASH or progressive
MP4), title, poster URL, signed start offset and timeline reference. The panel
also exposes autoplay, startup mute, separate audio/video forward buffer targets
and a video adaptation bitrate cap. Only HTTP/HTTPS URLs and finite decimal
numbers are accepted. This form requires positive buffer/bitrate targets;
blank omits the overrides. The SDK buffer default is 40 seconds per media type,
and live media windows can constrain the effective buffer. Bitrates are in bits
per second. Format/engine/device support still requires target-device testing.

Use D-pad navigation and Select (arrow keys and Enter on VVD) to operate the
controls. Autoplay, startup mute and **Allow DVR** are explicitly focusable, as
required by Amazon's [focus management guidance](https://www.developer.amazon.com/docs/vega/0.24/focus-management).

URL validation imports `URL` locally from `react-native-url-polyfill` 4.0.0.
React Native 0.72's global URL leaves `protocol` and `hostname` unimplemented,
which would reject valid sources before loading. The local parser leaves global
URL and the Vega SDK's media shims unchanged; it does not install a global
polyfill.
The package documents [local imports](https://www.npmjs.com/package/react-native-url-polyfill/v/4.0.0);
the older native implementation is [public](https://github.com/facebook/react-native/blob/v0.72.0/packages/react-native/Libraries/Blob/URL.js#L177-L202).

**Apply and recreate player** validates the entire draft, releases the previous
session and creates a player that loads the selected source from its start
offset. Playback position is reset. Unchanged/invalid input does not replace
resources. **Reset draft** only restores applied values. Preset buttons continue
to select sources immediately and replace draft source fields while preserving
unapplied player-setting edits. Selected/custom source fields, logs and the
**Allow DVR** setting survive Apply. Playback starts according to Autoplay.
Rapid Apply operations wait for the previous player's cleanup before loading
the latest selected configuration.

After **Show applied code**, use D-pad Down/Up to read the output. Each code line
participates in TV focus so the normal ScrollView can reveal the complete code,
including lines below the video. The code uses license placeholders.

`ui:false` stays fixed because the HTML Player UI is unavailable on Vega. Source
title/poster values are passed in the SDK source configuration; this Kepler screen does
not add a poster-artwork renderer. There is no loop configuration in this
published SDK surface. **Allow DVR** remains an application helper, separate
from `PlayerConfig.playback.timeShift`.

The direct editable mappings are:

| GUI control | Public SDK configuration |
| --- | --- |
| URL / type | One of `SourceConfig.hls`, `.dash`, `.progressive` (string form) |
| Title / poster | `SourceConfig.title`, `.poster` |
| Start offset / reference | `SourceConfig.options.startOffset`, `.startOffsetTimelineReference` |
| Autoplay / startup mute | `PlayerConfig.playback.autoplay`, `.muted` |
| Video / audio forward buffer | `PlayerConfig.buffer.video.forwardduration`, `.audio.forwardduration` |
| Video bitrate cap | `PlayerConfig.adaptation.bitrates.maxSelectableVideoBitrate` |

These paths are checked against the installed public
`bitmovin-player@8.138.0-beta.28/types/core/PlayerConfigAPI.d.ts`. They do not
imply support for the general Web SDK or untested Vega feature parity. A Kepler
build and target-specific checks remain necessary for formats, buffers,
adaptation and remote editing beyond the validation scope below.

## Background behavior

Foreground Apply keeps the native media valid until the Bitmovin player's
`destroy()` fulfills, then detaches the owned surface and calls
`deinitializeSync(1000)`. During background transition, the AppState handler
retires callbacks, clears the owned surface and resets the retired media element
through its public [`src` setter](https://www.developer.amazon.com/docs/vega-api/0.24/classes.HTMLMediaElement.amazon-devices_react-native-w3cmedia#src).
This starts its MediaSource reset and detachment synchronously, while JavaScript
can still run. The handler then calls `deinitializeSync(1000)`
before starting SDK destruction. It also releases media still retiring from an
earlier Apply through that owner's cleanup barrier.
Amazon's [background guidance](https://developer.amazon.com/docs/vega/0.24/foreground-background)
and [ACR explanation](https://developer.amazon.com/docs/vega/0.24/acr-summary-report#reclaimmediaresource-crashes)
require release before JavaScript can suspend; waiting for SDK destruction first
in that handler could leave media resources allocated. The 1000 ms sync deadline
is an application policy, not an SDK default.

Pausing alone leaves the MediaSource attached. Source reset alone does not confirm
native release. A replacement waits for both
successful native deinitialization and fulfilled SDK destruction before replacing
the media shim. Resetting the retired element can emit an empty-source media
error; retired callbacks cannot update the current screen, and the applied source
configuration remains intact. Active-session error handling is unchanged.

Foreground return requires a fresh surface generation and confirmed cleanup
before acquiring a replacement. Applied source/player settings, unapplied drafts,
logs and **Allow DVR** remain in the existing App state while the instance lives.
Playback-position restoration is not implemented. A rejected SDK destruction,
native timeout/invalid status or thrown release keeps the owner and blocks
replacement, with a constant restart-needed diagnostic.

Cancelling native initialization also requires restarting the app. W3C Media
2.3.2 acknowledges its abort synchronously, but destroys any late native
allocation asynchronously without exposing its completion. The app therefore
retains that unconfirmed owner instead of treating the abort acknowledgement as
proof of release.

## Build the Kepler application

The source configuration also accepts one external WebVTT track: HTTP/HTTPS URL,
menu label, IETF language tag (for example, `en` or `en-US`), and **Enable external
subtitle on load**. URL, label and language are required together; language tags
are normalized. A blank subtitle URL removes the track and clears its metadata.
Reset changes only the draft. Apply uses the existing player/session recreation
barrier, and applied-code output includes only validated applied values. A source
preset clears the external subtitle fields.
Use HTTPS for the external WebVTT delivery tested on Vega. The qualified HTTPS
fixture rendered cues; the same bytes from a plain local HTTP server did not.

The four leaves map to `TextTrack.url`, `MediaTrack.label`, `TextTrack.lang`, and
`SubtitleTrack.enabled` in the pinned public SDK. The app supplies a fixed track
ID and subtitle kind. Vega has no HTML UI: the public Subtitles and WebVTT parser
modules parse WebVTT, and public `CueEnter`/`CueExit` events drive a native text overlay. It
displays plain cue text; HTML subtitle styling is not rendered. Source/player
retirement and background transitions clear that overlay and retire its event
listeners. The enclosing track array is assembled by the app.

For a dedicated test build, `runtime:config --runtime-checks` explicitly enables
a read-only report around the same production App, native surface and session
barrier. Omitting this flag retains the normal entry. Reports contain numeric
public SDK clocks, playback state, cue counts/visibility and release-barrier
acknowledgements, without keys, URLs, cue text or SDK messages. Keep this entry
out of normal screenshots and distribution builds.

Install Amazon's [Vega SDK](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk)
and its documented prerequisites. The checked profile uses SDK 0.24.12112 and
`@amazon-devices/kepler-cli-platform` 0.22.14. Keep the RN 0.72 dependency set in
`package.json`; `vega project doctor` checks it against the manifest's OS 1.2
target. All JavaScript packages resolve from the public npm registry. Installing
the workspace and running its unit/type checks do not require the native SDK,
an Amazon account or a license key.

From the repository root, generate a license-free configuration for a build
check, then build the existing App:

```bash
pnpm install --frozen-lockfile
pnpm --filter @showcase/vega runtime:config --without-credentials
vega exec pnpm --filter @showcase/vega build:vega
```

The opt-in command creates JS and Hermes bundles and Release packages at
`apps/vega/build/{aarch64,armv7,x86_64}-release/vega_<architecture>.vpkg`.
`build:vega:debug` builds Debug packages. These commands are separate from the
workspace's generic `build`; normal public CI does not download a native SDK.
The manifest requests the public media services; the CLI adds the matching
OS-provided module needs during autolinking. The video surface has a bounded
area above the existing scrollable controls and uses aspect-ratio-preserving
scaling.

`src/polyfills.ts` connects the published Amazon W3C Media and WebCrypto APIs,
`@xmldom/xmldom` 0.9.12, and `base-64` 1.0.0 before player construction. It also
adapts the session's native video properties to the attribute calls expected by
the modular Player. The SDK's ReactNative module supplies its document adapter;
the app supplies only the current session's `gvideo` and removes it only when
that session still owns it. The native global URL is preserved, including media
object-URL support. Form validation continues to use its separate local parser.
Native media and crypto implementations remain in the installed Amazon package.

This wiring follows the
[public Bitmovin Vega sample](https://github.com/bitmovin/bitmovin-player-web-sample-fire-tv-vega/tree/0c7463104d3c18f56440aeec7beccd0d92c11aaa/src/polyfills)
and Amazon's [MSE integration guide](https://developer.amazon.com/docs/vega/0.24/mse-players).
The modular player uses Fetch rather than its default XHR transport, as required
by that integration. Existing network hooks and other player options are retained.

For licensed playback, use the existing environment variables or load the
repository-root `.env` with the shared literal-value loader. For example, in
Bash from the repository root:

```bash
source scripts/env-lib.sh
load_env_defaults .env
pnpm --filter @showcase/vega runtime:config
vega exec pnpm --filter @showcase/vega build:vega
```

`runtime:config` copies only `BITMOVIN_PLAYER_LICENSE_KEY` and optional
`BITMOVIN_ANALYTICS_LICENSE_KEY` from the process environment into the ignored,
owner-readable `runtime.local.json`. It does not load dotenv files itself or
print values. `index.js` installs these globals before evaluating the unchanged
App entry. The package identifier is `com.playerlab.vega`, its interactive component
is `com.playerlab.vega.main`, and the displayed title is **Player Lab Vega**.
Allow `com.playerlab.vega` on the player license. Generated
configuration, packages, bundles and runtime logs can contain license values;
keep them private and outside published artifacts.

## Run and inspect on a Vega Virtual Device (VVD)

Follow Amazon's [run instructions](https://developer.amazon.com/docs/vega/0.24/run-apps).
Start the VVD, list transports and identify its OS/profile before installing:

```bash
vega virtual-device start --timeout 120
vega exec vda devices -l
vega device info --device <VVD_SERIAL>
vega run-app apps/vega/build/aarch64-release/vega_aarch64.vpkg \
  com.playerlab.vega.main --deviceId <VVD_SERIAL>
```

Select the verified VVD serial explicitly when Android emulators are also
running. A CLI “ready” response alone does not establish that a Vega OS instance
booted. The SDK's distributed `virtualdevice` manager also supports named
instances, a custom VDA device port and a separate instance directory; consult
`vega which virtualdevice` and that tool's `--help` when isolating parallel tests.

Amazon's [Appium integration](https://developer.amazon.com/docs/vega/0.24/appium-install)
uses Appium 2.2.2 and `@amazon-devices/appium-kepler-driver` 3.30.0. Use a separate
Appium home/server for concurrent device work. Enable the automation toolkit on
the selected VVD and set `kepler:device` to `vda://<VVD_SERIAL>`; the
[inspector](https://developer.amazon.com/docs/vega/0.24/appium-inspector) exposes
native UI source, screenshots and focus properties. On VVD,
`gwsi-tool-screenshooter` is unsupported. Verify focus and the resulting field
value when sending text, then exercise remote navigation, invalid Apply, Reset,
source/player changes and foreground/background transitions. The state line's
`position` comes from the SDK's `getCurrentTime()` in seconds; check advancing
position together with changing video frames.

## Validation scope

Validation on 2026-10-21 used macOS on Apple silicon, Vega SDK 0.24.12112 and an
aarch64 VVD. The integrated 73 license-free tests and full App type-check passed.
The native toolchain produced JS/Hermes bundles and all three Release packages;
the aarch64 package was installed and launched on VVD. Its source map matched
all 15 committed application source files, without diagnostic instrumentation.
The renderer tests remain mocked at the native media/player boundary.

Three changed, valid bitrate-cap Applies on VOD HLS retained the selected source
and the same native app instance. Each reset playback and advanced SDK position
from roughly 1 to 6 seconds, with changing encoded video frame counters. This
qualifies that foreground Apply sequence, rather than quantitative bitrate
adaptation or general format support.

The same process and app instance also completed three measured warm returns on
VOD HLS and three on Live DASH. Each used an application switch, at least five
seconds in the background, and a return to this app. SDK playback positions
advanced together with changing video frames. Live checks waited for playback
to begin before measuring; SourceLoaded alone was not treated as visible video.
The selected source, applied bitrate cap, unapplied title draft, configuration
log and **Allow DVR** off setting survived the VOD returns. Live returns retained
the selected source and **Allow DVR** off. Playback restarts from the configured
source offset according to Autoplay; these checks do not establish playback
position restoration.

Native D-pad and Select events reached and toggled **Allow DVR**, Autoplay and
startup mute, including off/on transitions. Keyboard entry exercised the bitrate
field. Live remote navigation and re-enabling **Allow DVR** restored available
DVR controls. The applied-code view passed Show/Hide, draft exclusion, update
after Apply and license-placeholder checks on the same instance. It displayed
its TV clipboard limitation and provided no Copy button.

Process memory was sampled before/after Apply and background: resident set size
(RSS, memory held in physical memory), proportional set size (PSS, with shared
pages apportioned across processes), and unique set size (USS, memory exclusive
to this process). Open file descriptors and sockets were also counted. During
these warm checks, open descriptors fell from 149–152 to 72–74 in the background
and returned to 149–153 after playback restarted. These values do not establish
exact native VideoPlayer, media-element or surface allocations, or leak-free
behavior. No physical Fire TV, DRM/offline behavior, audio correctness or
quantitative buffer/bitrate behavior is qualified here. A VVD result does not
replace target-device compatibility and performance testing.

## Applied configuration code

Open **Show configuration → Show applied code** to inspect the validated Player
and Source settings sent to the existing native media host. Draft edits and
license values are excluded. This TV sample has no clipboard integration. When
reusing the settings, retain the host’s initialization, surface and release logic.
