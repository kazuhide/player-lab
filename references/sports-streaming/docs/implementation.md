# Implementing live events, clips and archives

Use the [setup instructions](../README.md#requirements-and-configuration) before
changing the Player integration. The Android application and the analysis Web
application have separate configuration and execution paths.

## Own the Player and its display separately

[`PlaybackSession`](../android/app/src/main/java/com/playerlab/sportsstreaming/PlaybackSession.kt)
owns the SDK Player. A Source uses its catalog's stable `videoId` and title; a
delivery URL is not an asset identity. Loading another Source starts a new
Analytics impression. Changing the interface keeps the existing Source and
impression.

[`PlayerSurfaceHost`](../android/app/src/main/java/com/playerlab/sportsstreaming/PlayerSurfaceHost.kt)
attaches one `PlayerView` at a time. Standard mode uses the SDK's Web UI; sports
mode disables that UI and uses native controls. Both modes share one
application-owned SDK `SubtitleView`; supplemental CSS hides only the HTML
caption overlay. Replacing the HTML controls otherwise failed to redisplay an
already-active paused cue. The shared renderer preserves it without a Source
reload, seek or subtitle-track toggle. Its lifetime belongs to the retained
Player owner, with the application context; a retiring surface can detach it
only while it still owns the View. Caption text follows the application's font
scale rather than the height of a letterboxed tablet pane. Placement uses the renderer's bottom-padding
API and honors authored cue positions. It does not pad the SDK wrapper View.
Detach the Player before calling `onPause`, `onStop` or `onDestroy` on a replaced
View; these lifecycle methods forward to its attached Player. Repeated UI changes must
not load media, seek back to a saved position or attach additional listeners.
Keep the current view attached for normal Activity lifecycle calls, as required
by the SDK's [onPause](https://cdn.bitmovin.com/player/android/3/docs/player-ui-web/com.bitmovin.player/-player-view/on-pause.html),
[onStop](https://cdn.bitmovin.com/player/android/3/docs/player-ui-web/com.bitmovin.player/-player-view/on-stop.html)
and [onDestroy](https://cdn.bitmovin.com/player/android/3/docs/player-ui-web/com.bitmovin.player/-player-view/on-destroy.html)
contracts. Detaching only before destruction preserved Source identity in our
device check but paused a playing session during a UI change.
[`PlayerOwnershipTest`](../android/app/src/androidTest/java/com/playerlab/sportsstreaming/PlayerOwnershipTest.kt)
therefore checks both playing and paused continuity, including rendered captions.

Keep SDK operations on the main thread. Use a retained owner across rotation
and fullscreen. Pause local playback when moving to the background unless
picture-in-picture is active; a Cast receiver continues independently.

Use a delta `Configuration` for preview font overrides. Copying the complete
current configuration also fixes its orientation and window dimensions, so
resource changes no longer follow rotation. The sample changes only `fontScale`
when creating its [configuration context](https://developer.android.com/reference/android/content/Context#createConfigurationContext(android.content.res.Configuration)).

## Live position and clip return

Represent stored positions and timestamps in Coordinated Universal Time (UTC) as integer milliseconds, then
convert to seconds at SDK calls. Live DASH, live HLS and Cast do not expose the
same time basis. A negative `timeShift` value is an offset behind the live edge,
not the number of seconds into an archive.

Read the current seekable bounds immediately before dispatching a live seek.
The call starts an asynchronous operation; an updated requested offset does not
prove that the playback position has reached it. Wait for
[`PlayerEvent.TimeShifted`](https://cdn.bitmovin.com/player/android/3/docs/player-core/com.bitmovin.player.api.event/-player-event/-time-shifted/index.html)
and check the actual timestamp before a dependent action. For video on demand,
the corresponding completion event is `PlayerEvent.Seeked`.
For a new Source, `SourceEvent.Loaded` confirms loading but does not establish
playback readiness. Bind `PlayerEvent.Ready`, the active Source, and the current
request generation before checking a configured start position or issuing a
dependent command.
The app keeps local controls unavailable until both milestones belong to that
Source. A late load/ready event cannot clear a failed-source state. Cast uses
its bound receiver acknowledgement instead, as described below.
After a long pause, the requested media can have left that window. Offer a
valid return position or the current live edge rather than silently pretending
the expired position is available.

Clips are separate prepared VOD Sources. Returning to live defaults to the live
edge. Returning to an earlier local position requires a fresh seekability check
and a deliberate choice by the user.

## Ended events and ready archives

Keep event state (`scheduled`, `live`, `ended`, `cancelled`) separate from archive
state (`not_ready`, `processing`, `ready`, `failed`). An ended notification must
not interrupt a viewer who is watching earlier live content.

Retry archive readiness on a bounded schedule, then leave manual retry available.
Bind each request to the selected event, asset, destination and request
generation. Discard a response if any of those have changed; duplicate end
notifications must not cause repeated loads.

For a continuous archive, map verified media UTC to the archive's relative
position. An edited archive requires explicit UTC intervals and offsets. A
removed interval, an unknown mapping and an out-of-range position are different
conditions. None implies a start at zero.
Resolve the currently selected archive against a fresh Source-bound SDK
timestamp when dispatching the handoff. A position shown for another archive
is only a preview; its offset cannot be reused for an edited target.

### Playback position and Unix time

A finite duration does not imply that the SDK rebased its playback clock to zero.
Keep the media coordinate, the Unix timestamp and an archive offset separate.
The APIs also differ between Web and Android:

| SDK and state | Current-time API | Absolute-time conversion |
| --- | --- | --- |
| Web | `getCurrentTime()` defaults to `TimeMode.AbsoluteTime`. `TimeMode.RelativeTime` is explicit. | A live Source can retain its Unix origin after becoming finite. Read `getSeekableRange()` before choosing a seek target. |
| Android: live HLS | `currentTime` is relative. | Add `playbackTimeOffsetToAbsoluteTime` to a fresh `currentTime`, in seconds. |
| Android: live DASH or Smooth Streaming | `currentTime` is a Unix timestamp. | The same offset API provides the conversion; do not add the event's start timestamp again. |
| Android: live Cast | `currentTime` is relative, regardless of delivery format. | Reacquire the offset for that remote playback; a local Source's conversion is not a receiver clock. |
| Android: VOD | `currentTime` is documented as a relative position. There is no `TimeMode` overload. | Do not assume that the preceding live offset remains available after finalization. |

These are separate SDK contracts, not interchangeable property names. See the
[Web current-time API](https://cdn.bitmovin.com/player/web/8/docs/interfaces/core.playerapi.html#getcurrenttime),
[Web time modes](https://cdn.bitmovin.com/player/web/8/docs/enums/Core.TimeMode.html),
[Android current time](https://cdn.bitmovin.com/player/android/3.172.0/docs/player-core/com.bitmovin.player.api/-player/current-time.html)
and [Android absolute-time offset](https://cdn.bitmovin.com/player/android/3.172.0/docs/player-core/com.bitmovin.player.api/-player/playback-time-offset-to-absolute-time.html).
An offset of zero is a value, not evidence that the API failed. The meaning of
`currentTime + offset` must be checked against the Source's known time basis.

In the controlled Android HLS ending, the raw playback position remained
unchanged while the same Source became finite. In DASH, the raw value changed
from Unix time to a relative coordinate, and both conversion offsets became
zero. The previous conversion no longer produced the expected Unix timestamp;
this does not mean that all SDK time information disappeared.

[`SourceUtcClock`](../android/app/src/main/java/com/playerlab/sportsstreaming/core/SourceUtcClock.kt)
uses both offsets from the same live SDK snapshot. Each offset is applied once
to a directly provided SDK value:

```text
relative position = currentTime + playbackTimeOffsetToRelativeTime
UTC origin = playbackTimeOffsetToAbsoluteTime - playbackTimeOffsetToRelativeTime
Unix time = relative position + verified UTC origin
```

The app prefers a fresh valid SDK absolute mapping. A retained origin is bound
to the Source, destination and request and is usable only after an observed
live-to-finalized transition with a continuous SDK-relative coordinate. A
replaced Source, destination change, unknown origin or unproved rebase leaves
the position unknown. An explicit seek after finalization invalidates that
retained transform unless the SDK supplies a newly valid absolute mapping.
The app never substitutes the device's wall clock or a cached UI position.

Google Cast Framework's receiver position is a separate coordinate from the
Bitmovin SDK's `currentTime`. The SDK conversion offsets apply only to values
read directly from the SDK; adding them to CAF's approximate stream position
can produce an incorrect Unix timestamp. Keep the raw receiver position and
seekable range for transport confirmation, and validate a fresh SDK absolute
mapping against the event's known bounds before an archive handoff. An unknown
mapping must not overwrite a previously stored asset's resume position.

Finalizing the current manifest and loading a prepared archive are different
operations. The archive is a new Source with its own relative timeline; map a
verified media UTC through its explicit intervals. A Web result does not qualify
the Android implementation, and local playback does not qualify Cast. The
[validation results](validation.md) identify the SDK version, protocol and
actual device used for each check.

An unplayed VOD Source can be `Ready` while both `isPlaying` and `isPaused`
are false. The application treats that as a settled non-playing intent only
for the current loaded/ready Source and request, after its actual target
position remains stable across separate observations. Handoff records retain
the raw SDK flags; the app does not emit or invent a Paused event. Remote Cast
confirmation still requires the receiver's actual playing or paused state.

Keep the viewer's play/pause intent when loading the prepared Source. Confirm
the actual resulting asset and position, and whether playback progresses or
remains paused. Selecting a target or completing a load callback alone does
not establish that the handoff succeeded.

## Google Cast

### Register and initialize the sender

The SDK needs the Cast options provider in the application's manifest. It also
provides the expanded controller Activity. See the complete
[manifest](../android/app/src/main/AndroidManifest.xml) and the official
[BasicCasting sample](https://github.com/bitmovin/bitmovin-player-android-samples/blob/main/BasicCasting/src/main/AndroidManifest.xml).

```xml
<meta-data
    android:name="com.google.android.gms.cast.framework.OPTIONS_PROVIDER_CLASS_NAME"
    android:value="com.bitmovin.player.casting.BitmovinCastOptionsProvider" />
<activity
    android:name="com.bitmovin.player.casting.ExpandedControllerActivity"
    android:exported="false"
    android:launchMode="singleTask"
    android:theme="@style/AppTheme"
    android:parentActivityName=".MainActivity" />
```

Call `BitmovinCastManager.initialize()` from
[`SportsApplication.onCreate`](../android/app/src/main/java/com/playerlab/sportsstreaming/SportsApplication.kt).
In [`MainActivity.onCreate`](../android/app/src/main/java/com/playerlab/sportsstreaming/MainActivity.kt),
call `BitmovinCastManager.getInstance().updateContext(this)` with the current
Activity. Application initialization alone does not register the manifest
provider or give the route chooser an Activity context.

### Load and control the selected receiver

[`PlaybackSession`](../android/app/src/main/java/com/playerlab/sportsstreaming/PlaybackSession.kt)
uses `player.castVideo()` to open the SDK's route chooser. The SDK owns source
loads and transport commands. [`CastController`](../android/app/src/main/java/com/playerlab/sportsstreaming/CastController.kt)
observes Google Cast Framework status; it does not issue a second media load.

Remote readiness is destination-specific. Android 3.172.0 did not emit another
local `PlayerEvent.Ready` for a same-URL receiver reload, even when the actual
receiver had loaded the new token/media session and was paused. The app therefore
requires the exact Cast session, Source load token and `mediaSessionId`, plus
an actual playable receiver status. Metadata-only, buffering, idle and failed
states cannot establish readiness. This does not synthesize a local SDK event
or reuse a previous Source's ready state.

Before replacing a receiver Source, the app unloads through the SDK and waits
for an observed stop belonging to that request and connection. An already-cached
idle state or a natural end cannot acknowledge this stop. Stopped playback does
not imply that the sender's queue cache is ready: an item count can be nonzero
while its item details are unavailable. The app requests that missing item once
through the public [MediaQueue API](https://developers.google.com/android/reference/com/google/android/gms/cast/framework/media/MediaQueue),
then observes updates without repeatedly requesting it. Loading waits for an
empty queue or a single cached item known to differ from the requested Source. A new
user selection replaces the pending request; an older callback cannot dispatch
it. A bounded load deadline leaves an explicit failure and recovery actions.
The app does not send a second, independently owned CAF load.

A remote source load is asynchronous. Calling `player.play()` immediately after
`player.load(source)` can control the previous receiver item before the new
load, whose autoplay setting may differ. This app retains the requested
play/pause intent with its Source and operation generation. When the receiver
reports that target item as playing or paused,
[`ReceiverLoadIntent`](../android/app/src/main/java/com/playerlab/sportsstreaming/core/ReceiverLoadIntent.kt)
issues a needed transport command once and waits for the resulting status.
Status for an older source or operation cannot complete that request.
Each Source includes a random, non-secret load identifier in
[`SourceConfig.metadata`](https://cdn.bitmovin.com/player/android/3/docs/player-core/com.bitmovin.player.api.source/-source-config/metadata.html).
The receiver status must return that identifier together with its actual
[`mediaSessionId`](https://developers.google.com/cast/docs/media/messages#MediaStatus)
and Cast session. A matching URL alone cannot distinguish a new load from an
earlier playback of the same stream. Missing identity remains unconfirmed.
This Source metadata is separate from Analytics `customData`, which stays empty.
Dispatch is posted to the main queue after the receiver callback returns, so
the SDK can finish updating its own playback state. The queued operation checks
the Source, request generation, session and receiver item again before calling
`player.play()` or `player.pause()`. Calling a transport method still does not
confirm that the receiver applied it.
If reconnecting changes the app's request generation while a load is pending,
the pending intent is rebound to that generation without changing the requested
Source or play/pause intent. A receiver load error stays latched for that Source
until an explicit new load; a later status cannot re-enable its controls or
erase an existing SDK error code.

An explicit disconnect calls `BitmovinCastManager.getInstance().disconnect()`.
Closing a route dialog is not a confirmed disconnection. Local playback stays
paused until the user chooses a recovery action.

Receiver connection and receiver playback are separate observations. Read the
actual receiver media information and status when confirming an operation.
Retain an unknown position as unknown after disconnection or process restart.
The user can choose a recovery action without a fabricated zero-second resume.

The position in a CAF status message is a snapshot; it need not advance between
messages. Use `RemoteMediaClient.approximateStreamPosition` and the current live
seekable range for ongoing receiver transport observations. Match their session
and Source identity before accepting a rewind, return to live or continuing
playback. A local SDK seek-completion event alone does not confirm remote motion.

In the controlled fixtures, the receiver's absolute-time mapping differed from
the manifest's authored clock, and CAF's `MediaInfo.startAbsoluteTime` was
unavailable. The app rejected that mapping while keeping receiver transport
controls available. An unavailable UTC mapping prevents a position-preserving
archive continuation. Starting the archive from its beginning is a separate,
explicit user choice; it is recorded as a Source load, not a UTC handoff. See
the [measured clock behavior](validation.md#playback-clocks-at-event-finalization)
and the [CAF absolute-time API](https://developers.google.com/android/reference/com/google/android/gms/cast/MediaInfo#getStartAbsoluteTime()).

Use media, subtitles and manifests reachable by the receiver. Check their
transport, codecs, cross-origin access and expiry on that receiver. Emulator
playback or a phone's local URL does not prove receiver compatibility.

## Analytics and local handoff records

Use the integrated collector once and configure it separately from the Player
license. The initial application uses standard metadata and **no customData
slots**. The catalog supplies the asset classification through its fixed video
IDs, such as `sports:SP-LIVE-S` and `sports:SP-ARCH-S`.

The [analysis Web application](../analytics-web/README.md) reads playback starts,
viewing time, startup median and 95th percentile, rebuffer percentage and error
percentage. Whole-period cards use their own queries; they are not averages of
hourly cards. API keys remain on its localhost server.

Local handoff records contain requests and observed outcomes. An unresolved
request stays pending. Receiver quality remains unavailable unless an actual
receiver collector and its identifying fields have been verified. Sender
metrics and zeros cannot substitute for those observations.

Official references: [Cast support](https://developer.bitmovin.com/playback/docs/casting-support),
[CAF receivers](https://developer.bitmovin.com/playback/docs/caf-support),
[Android sender integration](https://developers.google.com/cast/docs/android_sender/integrate),
and [Analytics query definitions](https://developer.bitmovin.com/playback/docs/how-to-recreate-dashboard-queries-via-the-api-1).
