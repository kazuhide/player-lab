# React Native device regression checks

These runners operate an explicitly generated `--runtime-checks` host. That
entry wraps the production `App`; it keeps the existing player creation, native
view readiness, source loading, GUI controls and cleanup. The report reads only
the wrapper's public getters and callbacks. It cannot set playback or apply
configuration. Normal app builds have no report or test buttons.

The device check uses the normal form to Reset a draft and Apply a 60-second HLS
source, offset 5 seconds, autoplay, startup mute, buffer 8 seconds and bitrate
2,500,000 bits/second. It checks actual OS clipboard equality, draft isolation,
Default → Sports → Default, retained source/settings/Allow DVR, foreground
return with an explicit visible SDK Play action when needed, and normal App unmount.
Each playback stage requires five fresh public SDK samples from the same owner,
a finite 59–61-second duration, a playing clock advancing over two seconds,
zero observed SDK errors and changing pixels inside the visible native video.
Screenshots alone and a Play/Pause label alone cannot pass.
Android uses the actual SDK Pause control before Home so this short fixture
cannot finish during slower OS observations. It then resumes through the actual
SDK Play control. This does not qualify unprompted automatic resume.

The configuration report records the values delivered by the App. It does not
claim to read native buffer or adaptation internals. Cleanup checks the public
wrapper's `isDestroyed` flag. Its `destroy()` is void; native destruction has no
public completion acknowledgement in this wrapper and is reported as unavailable.

## Prepare a clean checkout and dedicated test host

Follow [the app build instructions](../README.md#build-in-an-expo-project) for
Node, pnpm, platform tools and an authorized `com.playerlab.reactnative` license.
Generate a new external host with the additional explicit flag:

```bash
pnpm install --frozen-lockfile
pnpm --filter @showcase/ui-shared build
bash scripts/sync-env.sh
node apps/react-native/scripts/create-expo-project.mjs ../player-lab-runtime --env-from apps/react-native/.env --runtime-checks
cd ../player-lab-runtime
pnpm install --frozen-lockfile
pnpm exec expo prebuild --no-install
```

Build and install the development app using the generated host's normal native
commands. Keep Metro running for that host. Do not connect this test host to a
different checkout's Metro server. Use an already-booted simulator/emulator that
you own, and pass its exact UDID/serial; the scripts do not boot, stop, erase or
pick an arbitrary device. Do not run both runners against the same device.

Generate the repository's [local media](../../../docs/local-test-media.md):

```bash
python3 encoding/test-streams/local.py
python3 -m http.server 5260 --bind 127.0.0.1 --directory .cache/test-streams
```

Run those commands from the repository root in another terminal. The required
fixture is `vod-multiaudio/master.m3u8`, a finite 60-second HLS stream. Use a
credential-free reachable URL without a query/fragment. Android can use
`adb -s <SERIAL> reverse tcp:5260 tcp:5260` and `reverse tcp:8081 tcp:8081` for
local media and Metro. An iOS simulator can reach the Mac's loopback server.

## Run the checks

From the repository root, choose a **new directory outside the checkout** for
each result. Android requires Android SDK `adb` and FFmpeg. iOS requires Xcode,
XcodeGen and an installed development app. The iOS fixture has no Player SDK
dependency: its XCTest gestures inspect the installed normal App and public
report. A finalized xcresult with exactly one passing test is mandatory.

```bash
python3 -m unittest discover -s apps/react-native/runtime -p 'test_*.py'
python3 apps/react-native/runtime/run-android.py --device <SERIAL> --media-url http://127.0.0.1:5260/vod-multiaudio/master.m3u8 --output ../runtime-android-result
python3 apps/react-native/runtime/run-ios.py --device <UDID> --media-url http://127.0.0.1:5260/vod-multiaudio/master.m3u8 --output ../runtime-ios-result
```

The external-subtitle scenario uses the normal four-field WebVTT form, Apply,
the stock SDK subtitle menu, native selected-track/cue observations, moving
video, normalized language metadata, code/clipboard and draft Reset. **Mark as
default** is track metadata, rather than a promise to enable the track. Menu
selection is an actual user action. A selection-boundary report binds the same
owner and source-load epoch, followed by native external-track selection and a
new cue after that selected-track observation. Earlier embedded/default cues
cannot satisfy this gate. The iOS test handles UI 4.23's unlabeled
WKWebView menu-item roles using its public SmallScreen menu structure and the
fixture's track order; the native selected external track and cue remain required.
Android pauses with the visible SDK control while traversing the finite
fixture's menu, then explicitly plays after selecting the external track. Each
playback touch requires fresh native state from the same owner: an opacity-hidden
control may consume the first touch only to reveal the bar. If a compact menu
row is clipped, normal OS Tab input moves focus until the actual row is fully
inside its scrollable panel. Android additionally requires visible fixture text;
iOS qualifies selected-track, fresh-cue and moving-video observations.

```bash
python3 apps/react-native/runtime/run-ios.py --device <UDID> --media-url http://127.0.0.1:5260/vod-multiaudio/master.m3u8 --subtitle-url http://127.0.0.1:5260/assets/sintel_en.vtt --output ../runtime-ios-subtitles
python3 apps/react-native/runtime/run-subtitles-android.py --adb <ADB_PATH> --device <SERIAL> --media-url http://127.0.0.1:5260/vod-multiaudio/master.m3u8 --subtitle-url http://127.0.0.1:5260/assets/sintel_en.vtt --output ../runtime-android-subtitles
```

The scripts return nonzero on an unmet gate and preserve completed safe
observations. Commands and waits have finite deadlines. They stop only their
target applications and leave your device, Metro and media service running for
inspection. Stop those owned resources afterward and remove only reverse ports
you added. Ordinary CI runs the TypeScript/App tests and Python report tests;
licensed device checks require dedicated macOS/Android runners and explicit
device/toolchain setup.

Reports contain only allowlisted scalar counts, enums and booleans. They exclude
source URLs, cue text, license keys, native identifiers and raw SDK messages.
Local build/test logs and screenshots remain private, including failed results;
do not publish the result directory or generated host. Capture user-guide images
from the normal entry without the runtime header or footer.
