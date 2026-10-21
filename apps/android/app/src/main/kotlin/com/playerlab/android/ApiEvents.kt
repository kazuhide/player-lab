package com.playerlab.android

import com.bitmovin.player.api.Player
import com.bitmovin.player.api.source.Source
import com.bitmovin.player.api.event.Event
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import kotlin.reflect.KClass

internal object ApiEvents {
    data class PlayerEntry(val id: String, val subscribe: (Player, (String) -> Unit) -> (() -> Unit))
    data class SourceEntry(val id: String, val subscribe: (Source, (String) -> Unit) -> (() -> Unit))
    private fun <E : Event> playerEvent(id: String, type: KClass<E>) = PlayerEntry(id) { owner, report ->
        val callback: (E) -> Unit = { report(id) }
        owner.on(type, callback)
        val dispose: () -> Unit = { owner.off(type, callback) }
        dispose
    }
    private fun <E : SourceEvent> sourceEvent(id: String, type: KClass<E>) = SourceEntry(id) { owner, report ->
        val callback: (E) -> Unit = { report(id) }
        owner.on(type, callback)
        val dispose: () -> Unit = { owner.off(type, callback) }
        dispose
    }
    val player = listOf(
        playerEvent("PlayerEvent.Active", PlayerEvent.Active::class),
        playerEvent("PlayerEvent.AdBreakFinished", PlayerEvent.AdBreakFinished::class),
        playerEvent("PlayerEvent.AdBreakStarted", PlayerEvent.AdBreakStarted::class),
        playerEvent("PlayerEvent.AdClicked", PlayerEvent.AdClicked::class),
        playerEvent("PlayerEvent.AdError", PlayerEvent.AdError::class),
        playerEvent("PlayerEvent.AdFinished", PlayerEvent.AdFinished::class),
        playerEvent("PlayerEvent.AdLinearityChanged", PlayerEvent.AdLinearityChanged::class),
        playerEvent("PlayerEvent.AdManifestLoad", PlayerEvent.AdManifestLoad::class),
        playerEvent("PlayerEvent.AdManifestLoaded", PlayerEvent.AdManifestLoaded::class),
        playerEvent("PlayerEvent.AdQuartile", PlayerEvent.AdQuartile::class),
        playerEvent("PlayerEvent.AdScheduleChanged", PlayerEvent.AdScheduleChanged::class),
        playerEvent("PlayerEvent.AdScheduled", PlayerEvent.AdScheduled::class),
        playerEvent("PlayerEvent.AdSkipped", PlayerEvent.AdSkipped::class),
        playerEvent("PlayerEvent.AdStarted", PlayerEvent.AdStarted::class),
        playerEvent("PlayerEvent.AudioPlaybackQualityChanged", PlayerEvent.AudioPlaybackQualityChanged::class),
        playerEvent("PlayerEvent.CastAvailable", PlayerEvent.CastAvailable::class),
        playerEvent("PlayerEvent.CastPaused", PlayerEvent.CastPaused::class),
        playerEvent("PlayerEvent.CastPlaybackFinished", PlayerEvent.CastPlaybackFinished::class),
        playerEvent("PlayerEvent.CastPlaying", PlayerEvent.CastPlaying::class),
        playerEvent("PlayerEvent.CastStart", PlayerEvent.CastStart::class),
        playerEvent("PlayerEvent.CastStarted", PlayerEvent.CastStarted::class),
        playerEvent("PlayerEvent.CastStopped", PlayerEvent.CastStopped::class),
        playerEvent("PlayerEvent.CastTimeUpdated", PlayerEvent.CastTimeUpdated::class),
        playerEvent("PlayerEvent.CastWaitingForDevice", PlayerEvent.CastWaitingForDevice::class),
        playerEvent("PlayerEvent.CueEnter", PlayerEvent.CueEnter::class),
        playerEvent("PlayerEvent.CueExit", PlayerEvent.CueExit::class),
        playerEvent("PlayerEvent.Destroy", PlayerEvent.Destroy::class),
        playerEvent("PlayerEvent.DownloadFinished", PlayerEvent.DownloadFinished::class),
        playerEvent("PlayerEvent.DroppedVideoFrames", PlayerEvent.DroppedVideoFrames::class),
        playerEvent("PlayerEvent.DvrWindowExceeded", PlayerEvent.DvrWindowExceeded::class),
        playerEvent("PlayerEvent.Error", PlayerEvent.Error::class),
        playerEvent("PlayerEvent.FrameAboutToBeRendered", PlayerEvent.FrameAboutToBeRendered::class),
        playerEvent("PlayerEvent.FullscreenDisabled", PlayerEvent.FullscreenDisabled::class),
        playerEvent("PlayerEvent.FullscreenEnabled", PlayerEvent.FullscreenEnabled::class),
        playerEvent("PlayerEvent.FullscreenEnter", PlayerEvent.FullscreenEnter::class),
        playerEvent("PlayerEvent.FullscreenExit", PlayerEvent.FullscreenExit::class),
        playerEvent("PlayerEvent.Impression", PlayerEvent.Impression::class),
        playerEvent("PlayerEvent.Inactive", PlayerEvent.Inactive::class),
        playerEvent("PlayerEvent.Info", PlayerEvent.Info::class),
        playerEvent("PlayerEvent.LicenseValidated", PlayerEvent.LicenseValidated::class),
        playerEvent("PlayerEvent.Metadata", PlayerEvent.Metadata::class),
        playerEvent("PlayerEvent.Muted", PlayerEvent.Muted::class),
        playerEvent("PlayerEvent.NonLinearAdFinished", PlayerEvent.NonLinearAdFinished::class),
        playerEvent("PlayerEvent.NonLinearAdSkipped", PlayerEvent.NonLinearAdSkipped::class),
        playerEvent("PlayerEvent.NonLinearAdStarted", PlayerEvent.NonLinearAdStarted::class),
        playerEvent("PlayerEvent.Paused", PlayerEvent.Paused::class),
        playerEvent("PlayerEvent.PictureInPictureAvailabilityChanged", PlayerEvent.PictureInPictureAvailabilityChanged::class),
        playerEvent("PlayerEvent.PictureInPictureEnter", PlayerEvent.PictureInPictureEnter::class),
        playerEvent("PlayerEvent.PictureInPictureEntered", PlayerEvent.PictureInPictureEntered::class),
        playerEvent("PlayerEvent.PictureInPictureExit", PlayerEvent.PictureInPictureExit::class),
        playerEvent("PlayerEvent.PictureInPictureExited", PlayerEvent.PictureInPictureExited::class),
        playerEvent("PlayerEvent.Play", PlayerEvent.Play::class),
        playerEvent("PlayerEvent.PlaybackFinished", PlayerEvent.PlaybackFinished::class),
        playerEvent("PlayerEvent.PlaybackSpeedChanged", PlayerEvent.PlaybackSpeedChanged::class),
        playerEvent("PlayerEvent.Playing", PlayerEvent.Playing::class),
        playerEvent("PlayerEvent.PlaylistTransition", PlayerEvent.PlaylistTransition::class),
        playerEvent("PlayerEvent.Ready", PlayerEvent.Ready::class),
        playerEvent("PlayerEvent.RenderFirstFrame", PlayerEvent.RenderFirstFrame::class),
        playerEvent("PlayerEvent.ScalingModeChanged", PlayerEvent.ScalingModeChanged::class),
        playerEvent("PlayerEvent.Seek", PlayerEvent.Seek::class),
        playerEvent("PlayerEvent.Seeked", PlayerEvent.Seeked::class),
        playerEvent("PlayerEvent.SourceAdded", PlayerEvent.SourceAdded::class),
        playerEvent("PlayerEvent.SourceRemoved", PlayerEvent.SourceRemoved::class),
        playerEvent("PlayerEvent.StallEnded", PlayerEvent.StallEnded::class),
        playerEvent("PlayerEvent.StallStarted", PlayerEvent.StallStarted::class),
        playerEvent("PlayerEvent.TimeChanged", PlayerEvent.TimeChanged::class),
        playerEvent("PlayerEvent.TimeShift", PlayerEvent.TimeShift::class),
        playerEvent("PlayerEvent.TimeShifted", PlayerEvent.TimeShifted::class),
        playerEvent("PlayerEvent.Unmuted", PlayerEvent.Unmuted::class),
        playerEvent("PlayerEvent.VideoPlaybackQualityChanged", PlayerEvent.VideoPlaybackQualityChanged::class),
        playerEvent("PlayerEvent.VideoSizeChanged", PlayerEvent.VideoSizeChanged::class),
        playerEvent("PlayerEvent.VrStereoChanged", PlayerEvent.VrStereoChanged::class),
        playerEvent("PlayerEvent.VrViewingDirectionChange", PlayerEvent.VrViewingDirectionChange::class),
        playerEvent("PlayerEvent.VrViewingDirectionChanged", PlayerEvent.VrViewingDirectionChanged::class),
        playerEvent("PlayerEvent.Warning", PlayerEvent.Warning::class)
    )
    val source = listOf(
        sourceEvent("SourceEvent.AudioAdded", SourceEvent.AudioAdded::class),
        sourceEvent("SourceEvent.AudioChanged", SourceEvent.AudioChanged::class),
        sourceEvent("SourceEvent.AudioDownloadQualityChanged", SourceEvent.AudioDownloadQualityChanged::class),
        sourceEvent("SourceEvent.AudioQualitiesChanged", SourceEvent.AudioQualitiesChanged::class),
        sourceEvent("SourceEvent.AudioQualityAdded", SourceEvent.AudioQualityAdded::class),
        sourceEvent("SourceEvent.AudioQualityChanged", SourceEvent.AudioQualityChanged::class),
        sourceEvent("SourceEvent.AudioQualityRemoved", SourceEvent.AudioQualityRemoved::class),
        sourceEvent("SourceEvent.AudioRemoved", SourceEvent.AudioRemoved::class),
        sourceEvent("SourceEvent.AudioTrackAdded", SourceEvent.AudioTrackAdded::class),
        sourceEvent("SourceEvent.AudioTrackChanged", SourceEvent.AudioTrackChanged::class),
        sourceEvent("SourceEvent.AudioTrackRemoved", SourceEvent.AudioTrackRemoved::class),
        sourceEvent("SourceEvent.AudioTracksChanged", SourceEvent.AudioTracksChanged::class),
        sourceEvent("SourceEvent.DownloadFinished", SourceEvent.DownloadFinished::class),
        sourceEvent("SourceEvent.DrmDataParsed", SourceEvent.DrmDataParsed::class),
        sourceEvent("SourceEvent.DurationChanged", SourceEvent.DurationChanged::class),
        sourceEvent("SourceEvent.Error", SourceEvent.Error::class),
        sourceEvent("SourceEvent.Info", SourceEvent.Info::class),
        sourceEvent("SourceEvent.Load", SourceEvent.Load::class),
        sourceEvent("SourceEvent.Loaded", SourceEvent.Loaded::class),
        sourceEvent("SourceEvent.MetadataParsed", SourceEvent.MetadataParsed::class),
        sourceEvent("SourceEvent.PeriodChanged", SourceEvent.PeriodChanged::class),
        sourceEvent("SourceEvent.RetryPlaybackAttempt", SourceEvent.RetryPlaybackAttempt::class),
        sourceEvent("SourceEvent.StartPositionCorrection", SourceEvent.StartPositionCorrection::class),
        sourceEvent("SourceEvent.SubtitleAdded", SourceEvent.SubtitleAdded::class),
        sourceEvent("SourceEvent.SubtitleChanged", SourceEvent.SubtitleChanged::class),
        sourceEvent("SourceEvent.SubtitleRemoved", SourceEvent.SubtitleRemoved::class),
        sourceEvent("SourceEvent.SubtitleTrackAdded", SourceEvent.SubtitleTrackAdded::class),
        sourceEvent("SourceEvent.SubtitleTrackChanged", SourceEvent.SubtitleTrackChanged::class),
        sourceEvent("SourceEvent.SubtitleTrackRemoved", SourceEvent.SubtitleTrackRemoved::class),
        sourceEvent("SourceEvent.SubtitleTracksChanged", SourceEvent.SubtitleTracksChanged::class),
        sourceEvent("SourceEvent.Unloaded", SourceEvent.Unloaded::class),
        sourceEvent("SourceEvent.VideoDownloadQualityChanged", SourceEvent.VideoDownloadQualityChanged::class),
        sourceEvent("SourceEvent.VideoQualitiesChanged", SourceEvent.VideoQualitiesChanged::class),
        sourceEvent("SourceEvent.VideoQualityAdded", SourceEvent.VideoQualityAdded::class),
        sourceEvent("SourceEvent.VideoQualityChanged", SourceEvent.VideoQualityChanged::class),
        sourceEvent("SourceEvent.VideoQualityRemoved", SourceEvent.VideoQualityRemoved::class),
        sourceEvent("SourceEvent.Warning", SourceEvent.Warning::class)
    )
}
