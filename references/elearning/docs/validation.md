# Recorded checks

These checks were run on 28 October 2026 with Player Android 3.172.0 and its
integrated Analytics collector 3.35.2. Device playback used the reference's
self-authored media and the Player license configured locally. Credentials,
device serials, private delivery origins and raw device logs are excluded.

## Build and device playback

| Check | Conditions | Result |
| --- | --- | --- |
| Independent Android build and lint | Only this reference; JDK 21; own wrapper; no parent files or configuration | Build, lint and app/test APK compilation passed; generated license fields empty |
| Android unit tests | Playback plans, learner state, resume/checkpoint validation, captions and diagnostics | 24 passed |
| Fixture publisher tests | Input contracts, media timing and HTTP delivery limits | 33 passed |
| Device-driver tests | Exact-device arguments, JUnit execution and restart phases | 8 passed |
| Emulator HLS | Android API 36.1; complete suite on the frozen app/test APKs | 26 passed; no failures or skips |
| Emulator DASH | Same emulator and frozen app/test APKs | 26 passed; no failures or skips |
| Physical HLS | Pixel 11 Pro, Android 17; cloud VOD core, ownership, restart and English/Japanese paused captions | 12 passed; no failures or skips |
| Physical DASH | Same physical device and frozen app/test APKs | 12 passed; no failures or skips |
| Guide captures | Separate English/Japanese app UI; course, standard and learning views; system bars excluded | Both capture cases passed; six actual PNGs |
| Tablet layout | English/Japanese; portrait 800 dp and landscape 1,280 dp; caption-size bounds and real controls | Four cases passed; viewport restored afterward |
| Dashboard tests and build | Node.js 24.19.0; fixed queries and localhost server | 21 passed; build check successful |
| Dashboard browser checks | English/Japanese; 320–1,440 px viewports | Controls, tables and charts rendered without page errors |

The complete device suite checks lesson selection, transcript seeking with captions
off, external and manifest-registered captions, natural and manual lesson
transitions, learner isolation, repeated UI switching, and real video frames.
It also checks caption HTTP/format failures and retry, missing media recovery,
caption clearing at gaps and playback end, rotation/fullscreen continuity,
and labeled controls with 200% application font scaling.

The restart check saves 12:34 with the selected playback speed and Japanese
captions, force stops the application from a separate process, then verifies
restoration in a different process after the user-visible resume action. It
tests the last successful checkpoint, not an arbitrary unsaved instant.

Accessibility checks inspect real labels, focus, visible bounds and touch
targets. They do not measure spoken screen-reader output. The complete emulator suite uses a local media publisher through the emulator's
host-network address. Physical cloud VOD playback uses completed encoded media
and canonical side-loaded caption companions through a byte-preserving
loopback gateway reached by USB forwarding.
It does not establish direct-CDN playback, cloud Live recording, or registered
HLS subtitles where the cloud master has no subtitle rendition.

## Analytics query example

The dashboard queried the real Analytics service at 04:06 UTC on 28 October
2026 for this application's Android lesson IDs. The selected period was
27 October 04:06 UTC through 28 October 04:06 UTC.

| Metric | Returned value |
| --- | --- |
| Plays | 2 |
| Hours watched | 0.00189639 hours |
| Startup time, median | 2.073 seconds |
| Startup time, 95th percentile | 2.073 seconds |
| Rebuffer percentage | 0% |
| Error percentage | 0% |

This small snapshot demonstrates the query and unit conversion. It is not a
performance comparison. Later device tests create additional sessions. The
server's fetch timestamp identifies when the aggregate response was received,
not the arrival time of the latest raw sample.

## Repeat the checks

Follow the [setup and device-test commands](../README.md#check-the-application).
The device driver records exact executed counts, runner exit status and APK
hashes under ignored `android/build/device-tests/`. Use its complete suite for
the force-stop test; running a single restart phase does not test process death.

The [fixture probe record](../fixtures/local-media-validation.json) describes
local generated files. Cloud encoding and cloud-media playback are separate
checks; a completed upload or queued job is not a playback result.
