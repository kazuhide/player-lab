# Vega device regression checks

This opt-in entry wraps the production App, native surface and session barrier.
The report uses public Player getters/events, native decoded-frame counts and
the App's real release acknowledgement. It cannot apply settings or control
playback. The ordinary entry has no test header/buttons.

Before the VOD form checks, the runner uses the initial public live DVR source.
It reads all three real native rewind buttons with Allow DVR on, off and on,
retains the same player owner, and checks a normal -10s press and Live edge
against fresh `TimeShifted` events and a media-time target calculated from
the SDK clock and live offset immediately before each press. The live source must
actually expose a negative `getMaxTimeShift()` window; a VOD fixture or an App
flag alone cannot pass this stage.

The runner edits the normal form, resets an unapplied title, then applies a
one-minute HLS source, external HTTPS WebVTT track, normalized language tag,
offset 1 second, autoplay/mute, audio/video buffers of 8 seconds and video cap
2,500,000 bits/second. Each playback stage requires five fresh same-owner native
samples, finite duration 59–61 seconds, progressing clocks and decoded frames,
mute and changing movie pixels. The visible native subtitle overlay is required
alongside cue events. The runner reads every normal focusable code line, checks
draft exclusion/Reset, reapplies a title with retained settings/Allow DVR, and
uses a documented app-to-app transfer to check foreground replacement. Final unmount must
acknowledge every session's SDK destruction and native media release.
On that ordinary VOD source, the normal API picker must disable
`PlayerAPI.sgai.skip` and explain that no SGAI ad is active. This verifies the
invalid-operation boundary without ad media or a simulated ad playback claim.

## Prepare the dedicated runtime

Follow the [app build instructions](../README.md#build-the-kepler-application).
Use the pinned SDK/profile, an authorized `com.playerlab.vega` Player license
and a device you own. Generate the ignored licensed config with the explicit
test flag before building:

```bash
source scripts/env-lib.sh
load_env_defaults .env
pnpm --filter @showcase/vega runtime:config --runtime-checks
vega exec pnpm --filter @showcase/vega build:vega
vega run-app apps/vega/build/aarch64-release/vega_aarch64.vpkg com.playerlab.vega.main --deviceId <VDA_DEVICE>
```

Never commit the generated configuration or package. Leave off `--runtime-checks`
and rebuild for the normal entry and user-guide captures.

Install Amazon's public Appium Kepler driver and its documented automation
prerequisites separately. The checked automation tools are Appium 2.2.2, driver
3.30.0 and Node 22.22.0; the app continues to build with Node 24.19.0. Keep a
separate tools directory/Node environment rather than changing the app graph.
For a dedicated VVD, explicitly enable its automation toolkit:

```bash
vega exec vda -P <VDA_PORT> -s <VDA_DEVICE> shell touch /tmp/automation-toolkit.enable
appium --address 127.0.0.1 --port 4735
```

For a nondefault VDA server, start Appium with
`ADB_SERVER_SOCKET=tcp:localhost:<VDA_PORT>` in the Vega SDK environment. The
W3C session uses `automation-toolkit/JSON-RPC` and the selected `vda://` device.
The script never boots/stops/erases a device or selects another connected target.

Build the small, license-free companion in a new directory outside the checkout.
It reuses the installed frozen dependencies and creates no Player or media element.
Install it on the same dedicated device before running the check:

```bash
python3 apps/vega/runtime/prepare-companion.py --output ../vega-runtime-companion
(cd ../vega-runtime-companion && vega exec pnpm build)
vega run-app ../vega-runtime-companion/build/aarch64-release/player-lab-runtime-companion_aarch64.vpkg com.playerlab.runtimecompanion.main --deviceId <VDA_DEVICE>
```

The [official foreground/background procedure](https://developer.amazon.com/docs/vega/0.24/foreground-background.html)
uses `vmsgr send orpheus://<component>` to switch apps and return to an existing
singleton. Home can clear the back stack. The runner requires the same OS
application instance before, during and after transfer; the background state
must be `NOT_VISIBLE`. It then requires one fresh native player session with
the applied configuration, source, code generation, log and Allow DVR retained.
This does not claim that a cold launch restores App state.

Generate the repository's [local media](../../../docs/local-test-media.md) and
serve its one-minute `vod-multiaudio/master.m3u8`. A VVD can reach a host server
through `10.0.2.2`; physical devices need a reachable endpoint. Supply an HTTPS
WebVTT fixture with early cues, such as the generated `assets/sintel_en.vtt`
hosted by your HTTPS media service. HTTP subtitle delivery did not produce cues
in the checked Vega runtime. URLs must contain no credentials, query or fragment.

## Run and retain private results

```bash
python3 -m unittest discover -s apps/vega/runtime -p 'test_*.py'
python3 apps/vega/runtime/run.py --device <VDA_DEVICE> --vda-server-port <VDA_PORT> --media-url <60_SECOND_HLS_URL> --subtitle-url <HTTPS_WEBVTT_URL> --output ../vega-runtime-result
```

Python 3, FFmpeg, Vega CLI, the installed test entry and a loopback Appium server
are required. The output must be a new directory outside the checkout. Failed
gates return nonzero; tool, response-size and total automation deadlines remain
finite. The script closes only its Appium session and stops the selected app and companion.
After inspection, stop your owned device, media and automation services and
remove only the automation/reverse settings you added.

Reports contain allowlisted scalar counters, enums and booleans. No keys, source
URLs, cue text, native identifiers or raw SDK messages are serialized. Screenshots
and local logs remain private. Ordinary CI can run the TypeScript/App and Python
report tests. Actual licensed Vega checks require a separately provisioned SDK
runner and device, and do not follow from renderer tests.
