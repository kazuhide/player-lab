# Feature guide

This guide describes the examples included in the apps. An available control or
compiled SDK call is not proof that every browser, device, stream, or account
supports that feature.

## Web playground

| Area | What to try |
| --- | --- |
| Player UI | Standard UI, five CSS themes, eight custom themes, and the selected theme's construction code |
| Configuration | Player and source settings, named Tweaks, and settings applied by recreation, source reload, or runtime calls |
| Source selection | Public VOD/live references, your own source, and configured feature media |
| Playback APIs | Play/pause, seeking, speed, quality/audio/subtitle selection, and available device controls |
| Live rewind | Clamp a seek to the moving window, return to live, disable rewind, and inspect offsets |
| Time and start settings | Absolute/relative time, source start offset, and minimum rewind depth |
| Continuous playback | Intro skipping, next-episode controls, and recommendation examples |
| Observations | Player events and local playback measurements; optional Analytics collection and queries |
| Customization guide | A separate guide page plus theme-specific code beside the player |

DVR is the live rewind window. Its API uses `0` for the live edge and negative
values for the past. HLS can initially report a zero-length window, so the apps
read it again as playback advances. A larger forward buffer does not create a
larger rewind window. See [time and start settings](dvr-time-and-start-config.md).

Sprite, multi-audio, and sideloaded-subtitle examples need URLs you configure.
Their selectors and controls remain available; account-specific media is not
bundled. See [test stream configuration](test-streams-config.md).

## Other platforms

| Platform | Included implementation and limits |
| --- | --- |
| iOS/tvOS | Swift app, per-platform DVR handling, selectable Web UI on iOS and system UI on tvOS |
| Android/Fire TV | Kotlin app, selectable Web UI, DVR handling, and offline download example |
| React Native | Screen and controls for a development build; native media and shared UI delivery need the Expo toolchain |
| Vega OS | Modular player and custom native controls; Vega tooling, full runtime polyfills, and device checks are separate |

The shared UI is in `packages/ui-shared`. Each platform keeps its own DVR logic.
Read the platform README before attempting a build or device run.

## Optional encoding tools

`encoding/` contains the existing live DVR, VOD baseline, HEVC, sprite,
multi-audio, and multi-codec Per-Title tools. They operate in your account and
are not required for public reference playback. Live window and shutdown
settings are explained in the [encoding guide](../encoding/README.md).

## Verification boundaries

[Testing](e2e-testing.md) separates deterministic logic tests, browser playback,
native compilation, and device runs. Native offline, casting, Analytics receipt,
protected content, advertising, low-latency streams, and codec support require
appropriate sources, credentials, hardware, or separate integration checks.
The configuration panels are not an exhaustive compatibility certification.
