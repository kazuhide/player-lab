# Recorded checks

These checks were run on 28 October 2026 with Player Android 3.172.0 and its
integrated Analytics collector 3.35.2. The device run used locally configured
demo licenses and this reference's self-authored fixtures. Credentials, device
serials, private origins and raw device logs are excluded.

## Build and device playback

| Check | Conditions | Result |
| --- | --- | --- |
| Independent Android build | Only this reference's files; no parent application or `.env`; JDK 21 | Build, lint and app/test APK compilation passed; generated license fields empty |
| Android unit tests | Availability, request identity, UTC mapping, Cast intent and handoff records | 53 passed |
| Fixture publisher tests | Media contracts, source clocks, HTTP delivery and bounds | 33 passed |
| Device-driver tests | Exact device, actual JUnit counts, installed APK identity and capture transfer | 18 passed |
| Physical HLS | Pixel 11 Pro, Android 17; ownership, workflow, Cast and guide captures | 13 passed; no failures or skips |
| Physical DASH | Same device and frozen app/test APKs | 13 passed; no failures or skips |
| Cast receiver | Explicitly selected Pixel Tablet; HLS and DASH | Actual remote asset, position and play/pause state observed |
| Guide captures | Separate English/Japanese UI; portrait/landscape; standard/sports UI | All captures passed; system bars excluded |
| Analysis Web | Node.js 24.19.0; fixed queries and localhost server | 26 tests passed; build check passed |
| Analysis browser | English/Japanese; 320–1,440 px viewports | Controls, tables and charts rendered without page errors |

The ownership tests exercise paused and playing UI changes, actual video pixels,
caption glyphs, speed, Source and impression identity, rotation and fullscreen.
The workflow tests check source-selection behavior, current seekable bounds and
live/archive availability. Capture cases are included in the protocol totals.

The Cast checks read actual CAF media status. They check clip changes,
pause/resume, Live rewind, return to the live edge, archive playback and
disconnect recovery. A connected receiver application alone is insufficient.
These results do not establish receiver-side Analytics collection or receiver
playback-quality metrics.

## Event duration and source preparation

A short workflow run is separate from a complete event-duration check. The
[endurance instructions](../android/README.md#normal-event-endurance-check)
require real elapsed time, changing video frames, a progressing live clock,
expired-window recovery and an explicit archive handoff. Sampled process memory
and available thermal status describe the tested device/run; they are not a
memory-leak or thermal certification.

Cloud VOD preparation completed for the stored sports originals, clips and
edited archive. Both manifest families and their referenced fragments were
retrieved, hashed and probed; sampled trim/edit boundary frames were compared.
The local Live publisher advances these reference fixtures in real time.
Neither this publisher nor the completed VOD jobs establishes an archive made
from a stopped cloud Live recording.

## Repeat the checks

Follow [setup](../README.md#requirements-and-configuration), then the
[device driver and opt-in Cast commands](../android/README.md#reproducible-device-checks).
The complete suite requires a Player license, an Analytics license for real
impression continuity and reachable media. It records executed counts, runner
exit status and APK hashes under ignored `android/build/device-tests/`.

The driver reuses an installed base APK only when its digest exactly matches
the selected local APK. Otherwise it installs and verifies the new bytes.
The test driver does not select a receiver automatically or restart an ADB
server. Device and receiver results remain separate from build, HTTP and cloud
preparation results.
