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
mode disables that UI and uses native controls with one subtitle renderer.
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

A remote source load is asynchronous. Calling `player.play()` immediately after
`player.load(source)` can control the previous receiver item before the new
load, whose autoplay setting may differ. This app retains the requested
play/pause intent with its Source and operation generation. When the receiver
reports that target item as playing or paused,
[`ReceiverLoadIntent`](../android/app/src/main/java/com/playerlab/sportsstreaming/core/ReceiverLoadIntent.kt)
issues a needed transport command once and waits for the resulting status.
Status for an older source or operation cannot complete that request.
Dispatch is posted to the main queue after the receiver callback returns, so
the SDK can finish updating its own playback state. The queued operation checks
the Source, request generation, session and receiver item again before calling
`player.play()` or `player.pause()`. Calling a transport method still does not
confirm that the receiver applied it.

An explicit disconnect calls `BitmovinCastManager.getInstance().disconnect()`.
Closing a route dialog is not a confirmed disconnection. Local playback stays
paused until the user chooses a recovery action.

Receiver connection and receiver playback are separate observations. Read the
actual receiver media information and status when confirming an operation.
Retain an unknown position as unknown after disconnection or process restart.
The user can choose a recovery action without a fabricated zero-second resume.

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
