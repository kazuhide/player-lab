# Recorded checks

These checks were run on 28 October 2026 with Player Android 3.172.0 and its
integrated Analytics collector 3.35.2. The device run used locally configured
demo licenses and this reference's self-authored fixtures. Credentials, device
serials, private origins and raw device logs are excluded.

## Build and focused playback checks

| Check | Conditions | Result |
| --- | --- | --- |
| Independent Android build | Only this reference's files; no parent application or `.env`; JDK 21 | Build, lint and app/test APK compilation passed; generated license fields empty |
| Android unit tests | Availability, request identity, UTC mapping, Cast intent, readiness, queue/loading deadlines and handoff records | 99 passed |
| Fixture publisher tests | Media contracts, source clocks, fixed caption sidecars, HTTP delivery and bounds | 35 passed |
| Device-driver tests | Exact device, actual JUnit counts, installed APK identity and capture transfer | 18 passed |
| Physical workflows and Cast | Pixel 11 Pro, Android 17; HLS/DASH, source identity, play/pause, rewind, live return, archive start, disconnect and localized captures | 26 tests passed; 16 captures |
| HLS event finalization | Pixel 11 Pro, Android 17; actual event end, unchanged paused Source/impression, UTC continuity and edited-archive handoff | Passed |
| Analysis Web | Node.js 24.19.0; fixed queries and localhost server | 28 tests passed; build check passed |
| Analysis browser | English/Japanese; 320–1,440 px viewports | Controls, tables and charts rendered without page errors |

Separate caption checks confirmed natural rendering, clearing at actual end of
media, replay and fatal-source recovery. The physical event check confirmed
Source-bound UTC conversion and paused intent during an edited-archive handoff.
A newly loaded VOD Source can be Ready
without having started: both SDK `isPlaying` and `isPaused` can be false. The
app confirms its non-playing intent through source readiness and a stable
actual position, retaining the raw SDK flags separately. An explicit Play must
then advance that Source's clock.

Complete device/receiver and event-duration checks use the commands below.
Their receipts bind each app/test APK and preserve the observed execution
counts, outcomes and media conditions. Source inspection and compilation do
not establish receiver playback or receiver-side Analytics collection.

## Playback clocks at event finalization

A separate controlled Web check used Player 8.281.0 and Chrome 156.0.8078.73.
The same 180-second presentation changed from live to finite without another
Source load. HLS used MPEG-TS with program-date-time tags; DASH used fragmented
MP4 with an availability-start-time anchor. Playback was paused before the
manifest change and remained paused afterward.

| Web protocol | Default/absolute time before and after finalization, seconds | Relative time before and after, seconds | Duration |
| --- | --- | --- | --- |
| HLS | 1793181047.315292, unchanged | 120.219292, unchanged | `Infinity` → 180 |
| DASH | 1793181052.031333, unchanged | 120.025000, unchanged | `Infinity` → 180 |

Both cases kept the Player and Source, recorded one `SourceLoaded` event, and
reported `isLive() == false` after finalization. The finalized seekable ranges
retained their Unix origin. These observations support the Web-specific API
explanation; they do not establish Android, Cast or other HLS packaging behavior.
See the [API comparison and handoff rules](implementation.md#playback-position-and-unix-time).

A further Web DASH check used the same media and windowed publisher policy as
the Android probe below. Its final static manifest declares a 180-second
presentation while retaining about 60 seconds of segment timeline. Web 8.281.0
reported duration 180 and a Unix-based seekable range; Android 3.172.0 reported
59.999 and a range of 0–59.999 for this fixture. These are measured differences
in the SDK getters for this manifest shape, not a general rule for every VOD.
In that Web run, the paused default/absolute value 1793186922.750 and relative
value 149.926 also remained unchanged, with one Source load.

A physical Android 3.172.0 DASH probe retained the same Source, impression,
request and paused frame through the short event's end. Its raw representation
changed even though the SDK-relative coordinate remained continuous:

| Android DASH property | Before finalization | After finalization |
| --- | --- | --- |
| `currentTime`, seconds | 1793163695.741 | 107.742 |
| `playbackTimeOffsetToAbsoluteTime`, seconds | 0 | 0 |
| `playbackTimeOffsetToRelativeTime`, seconds | −1793163588 | 0 |
| SDK-relative coordinate, seconds | 107.741 | 107.742 |
| Duration, seconds | `Infinity` | 59.999 |
| Seekable range, seconds | 0–0 while live | 0–59.999 |

The retained paused coordinate is not a valid target in the newly advertised
seekable range. The presentation had a sliding window; its finite duration is
not a promise that an earlier buffered frame was rebased to that window's zero.
Read fresh bounds for any seek. An explicit seek invalidates a retained UTC
transform unless the SDK supplies a newly valid absolute mapping. This
observation establishes the API transition, not success of an archive handoff
or a full event-duration test.

## Event duration and source preparation

A short workflow run is separate from a complete event-duration check. The
[endurance instructions](../android/README.md#normal-event-endurance-check)
require real elapsed time, changing video frames, a progressing live clock,
expired-window recovery and an explicit archive handoff. Sampled process memory
and available thermal status describe the tested device/run; they are not a
memory-leak or thermal certification.

The 30-minute continuous-playback run was excluded from this check. Its
optional command remains available for local validation.

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
