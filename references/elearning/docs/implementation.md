# Implementing the learning player

[English](implementation.md) · [日本語](implementation.ja.md)

Start with [setup](../README.md#configure-and-run-android). The Android application
uses the integrated Bitmovin Player SDK; the optional analysis Web application
reads Analytics through its own server.

## Player and source configuration

[`PlayerEngine`](../android/app/src/main/java/com/playerlab/elearning/PlayerEngine.kt)
owns the Player. Configure the Player once for the current learner, then create
Sources from the selected lesson's HLS or DASH URL. Source Analytics metadata
uses the stable lesson ID, independent of its delivery URL or protocol.

The course's automatic-continuation setting is application behavior. When
enabled, load a Playlist containing the selected lesson through the end of the
course. When disabled, load the selected lesson alone. Manual previous/next
selects a lesson and constructs the appropriate new load; it is distinct from a
natural Playlist transition. The final lesson has no subtitles, so subtitle
choices must be reacquired when the Source changes.

[`PlaybackPlan`](../android/app/src/main/java/com/playerlab/elearning/PlaybackPlan.kt)
keeps these choices explicit. `PlaybackFinished` indicates the final Source in a
Playlist, not completion of every individual lesson or a learning assessment.

## Switching the interface

[`PlayerSurface`](../android/app/src/main/java/com/playerlab/elearning/PlayerSurface.kt)
uses `UiConfig.WebUi` for the standard interface and `UiConfig.Disabled` with
native controls for learning mode. A UI-only change reuses the existing Player
and Source. It does not reload the lesson, seek back to a saved position, or
create an Analytics impression.

Detach the Player from the old `PlayerView` before destroying that View. The
Player's lifetime belongs to the application owner, not a temporary display
View. Both interfaces use one application-owned SDK `SubtitleView`.
`UiConfig.WebUi.supplementalCssLocation` hides only the HTML subtitle overlay;
the standard playback controls and track selection remain available.

A new HTML UI did not redisplay an already-active cue while playback was
paused in the Android 3.172.0 checks. Keeping one subscribed native renderer
preserves that cue without reloading, seeking or toggling the subtitle track.
The renderer uses the application context and is reparented after Activity
recreation. A retiring surface can detach or restyle it only while it still
owns that View, so late cleanup cannot affect the new surface.

Caption text uses a fixed size scaled with the application's font setting.
A fraction of the whole renderer height made captions too large in a tall,
letterboxed tablet pane. Placement uses `SubtitleView.setBottomPaddingFraction`. Authored cue
positioning is still honored; this does not force every caption above every
control. Padding the SDK's wrapper View instead clipped actual caption glyphs
in the device checks. Separate English and Japanese checks verify current cue
pixels, no duplicate HTML captions, actual standard Play/Pause touch, and
paused continuity through both UI changes and Activity recreation.

The native renderer is cleared on the actual `PlaybackFinished` event: the
tested SDK can leave the final caption visible without a final `CueExit`.
This clears only the app-owned renderer and active-cue cache. It does not
replace the Player or Source, reload media, or seek. A fatal Player error can
detach the SDK renderer; an explicit Retry reconnects it through
[`SubtitleView.setPlayer`](https://cdn.bitmovin.com/player/android/3.172.0/docs/player-core/com.bitmovin.player/-subtitle-view/set-player.html)
while loading the new Source. UI-only changes never perform that reload.

Recheck continuity with real media after changing View lifecycle code. Matching
object identities alone does not prove that video frames and audio continue.

## Transcript and subtitles

[`Transcript`](../android/app/src/main/java/com/playerlab/elearning/Transcript.kt)
searches the same timed cues used for the subtitle fixtures. Keep cue times in
integer milliseconds and convert to SDK seconds only at the API boundary.
Selecting a row seeks to its original start; filtering or sorting search
results must not replace that timestamp.

Keep this original timeline separate from transient SDK cue events. In the
tested SDK, a delivered cue's timing did not reproduce its original WebVTT
interval; for example, [`Cue.end`](https://cdn.bitmovin.com/player/android/3.172.0/docs/player-core/com.bitmovin.player.api.media.subtitle/-cue/end.html)
could be `0`. Use `CueEnter` and `CueExit` to track what is displayed, and use
the transcript data for search timestamps. Device checks compare actual cue
delivery and rendered captions against the playback clock, including gaps and
end of media.

Seeking is asynchronous. An updated position or still-visible caption can
belong to different stages of the seek. Before checking paused captions through
rotation or a UI change, the device tests wait for the target Source's `Seeked`,
the expected cue payload and actual rendered caption pixels. Accepting the old
caption's pixels would give a misleading setup result.

Subtitle-off is an explicit preference. Do not substitute a default language
when loading a new lesson or navigating through the transcript. Reacquire a
preferred language from the new Source's tracks because track IDs belong to
that Source.

Available subtitle tracks can arrive after `Loaded` and `Ready`. In the device
checks, those initial callbacks could see an empty track list, followed by
`SourceEvent.SubtitleTracksChanged`. Applying a preference only during initial
loading therefore left captions unselected. The engine also reconciles the
stored preference when that event belongs to the active Source, preserving an
explicit off setting and ignoring changes from a replaced or preloaded Source.

### Caption errors

[`PlayerEngine`](../android/app/src/main/java/com/playerlab/elearning/PlayerEngine.kt)
explicitly sets
[`TweaksConfig.parseSubtitlesDuringExtraction = false`](https://cdn.bitmovin.com/player/android/3.172.0/docs/player-core/com.bitmovin.player.api/-tweaks-config/parse-subtitles-during-extraction.html).
The SDK default is `true`. In the controlled Android SDK 3.172.0 tests, default
extraction-time parsing made a missing caption file and an invalid WebVTT
signature fatal SDK errors (`2203` and `2001`). Rendering-time parsing let
video continue, but emitted neither subtitle warning `2004` nor `2005`.

The app therefore reports the actual caption HTTP failure through
[`SourceEvent.DownloadFinished`](https://cdn.bitmovin.com/player/android/3.172.0/docs/player-core/com.bitmovin.player.api.event/-source-event/-download-finished/index.html)
and checks the WebVTT signature in the SDK's existing
[`preprocessHttpResponseCallback`](https://cdn.bitmovin.com/player/android/3.172.0/docs/player-core/com.bitmovin.player.api.network/-network-config/preprocess-http-response-callback.html).
It does not issue another download or change the response. Side-loaded
captions can have request type `Unknown`; matching uses the exact caption URLs
registered on the Source. Only `MediaSubtitles` and `Unknown` response types
are preprocessed, rather than `MediaAudio` or `MediaVideo`.

This is a bounded signature check, not a complete WebVTT validator. It examines
at most 16 header bytes and flags a response larger than 1 MiB as unsupported. The SDK has
already buffered the response at this point, so this check is not a download
or memory limit. HTTP status codes remain separate from SDK deficiency codes;
neither raw SDK messages nor response bodies or URLs enter the diagnostic log.
The error banner offers Retry and a return to the lesson list. Retry is an
explicit new Source load; a caption failure itself does not reload the lesson.

## Resume, learner identity and lifecycle

[`ProgressRepository`](../android/app/src/main/java/com/playerlab/elearning/ProgressRepository.kt)
stores resume state under a learner/lesson pair. Capture both identifiers and
the position before sending persistence work off the main thread. An old save
or callback must not update the newly selected learner's screen.

Save periodically during playback and when pausing, changing lessons or leaving
the foreground. A forced process termination can only recover the last
successful save. If saved media has changed and the position is outside its
duration, offer an explicit restart rather than silently clamping it.

Catalog durations can become stale when a lesson is replaced. This application
therefore loads the selected Source paused at zero, waits for both Player
readiness and the loaded Source's actual duration, and validates the saved
offset before issuing a seek. Playback starts only after that initial seek
completes. An offset at or beyond the actual end leaves playback blocked and
offers **Start over** or **Lessons**; the saved position remains intact until the
learner chooses a restart.

[`PlaybackCheckpoint`](../android/app/src/main/java/com/playerlab/elearning/PlaybackCheckpoint.kt)
keeps the selected or last usable position while loading or after an error.
An unavailable SDK clock must not be converted to a new zero checkpoint.
Retry uses this retained position. Once the active Source is ready, real
playback and seek events update the checkpoint; an intentional seek to zero
is valid. Native touch, keyboard and accessibility slider changes all use the
same guarded seek operation.

Opening a saved resume restores that lesson's saved preferences. Ordinary
manual and natural lesson transitions inherit the current subtitle and speed
preferences. Switching learners intentionally replaces the Player, storage
scope and Analytics identity.

Player, Source and collector operations run on the main thread. Disk and network
work run asynchronously. `DownloadFinished` can arrive on a loader thread:
[`SourceIssues`](../android/app/src/main/java/com/playerlab/elearning/SourceIssues.kt)
captures immutable request metadata, and the engine posts the result to the
main thread before accessing Source state or updating views. Late callbacks
from a replaced Source are ignored. Rotation keeps the owner; background
playback pauses and saves. Diagnostic output is bounded and contains
structured event names, stable lesson IDs and separate HTTP/SDK codes rather
than entered search text or arbitrary SDK messages.

## Analytics and Observability

Player playback and Analytics reporting are separately configured products.
Attach the integrated collector once. Set `videoId` to the lesson ID and
`customUserId` to the synthetic demo learner before loading its Source. This
learner identifier is different from the SDK's `userId` field.

The optional start-origin comparison uses `customData1`: opening or resuming
from the catalog is `catalog`, and manual/natural sequencing is `playlist`.
UI mode stays local. Switching the interface must not start another impression.
No bookmark operation data or learner notes are sent by this implementation.

The [dedicated dashboard](../analytics-dashboard/README.md) reads playback
starts, viewing time, median and 95th-percentile startup time, rebuffer percentage
and error percentage. A percentile is a distribution summary; hourly
percentiles cannot be averaged into the percentile for the entire selected
period. Account credentials remain on the localhost server.

Official references: [Playlist API](https://developer.bitmovin.com/playback/docs/using-the-playlist-api-for-seamless-source-switching),
[subtitles](https://developer.bitmovin.com/playback/docs/subtitles-captions),
[Analytics configuration](https://developer.bitmovin.com/playback/docs/configuration-analytics),
and [Dashboard query definitions](https://developer.bitmovin.com/playback/docs/how-to-recreate-dashboard-queries-via-the-api-1).
