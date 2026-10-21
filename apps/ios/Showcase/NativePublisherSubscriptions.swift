import Foundation
import Combine
import BitmovinPlayer

enum NativeEventTransport: String, CaseIterable, Identifiable {
    case listener = "Typed listeners", publisher = "Combine publishers"
    var id: String { rawValue }
}

enum NativePublisherSubscriptions {
    static func player(_ player: Player, receiver: PlayerApiEventListener) -> [AnyCancellable] {
        var subscriptions: [AnyCancellable] = []
        subscriptions.append(player.events.on(AdBreakFinishedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAdBreakFinished(event, player: player) })
        subscriptions.append(player.events.on(AdBreakStartedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAdBreakStarted(event, player: player) })
        subscriptions.append(player.events.on(AdClickedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAdClicked(event, player: player) })
        subscriptions.append(player.events.on(AdErrorEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAdError(event, player: player) })
        subscriptions.append(player.events.on(AdFinishedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAdFinished(event, player: player) })
        subscriptions.append(player.events.on(AdManifestLoadEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAdManifestLoad(event, player: player) })
        subscriptions.append(player.events.on(AdManifestLoadedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAdManifestLoaded(event, player: player) })
        subscriptions.append(player.events.on(AdQuartileEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAdQuartile(event, player: player) })
        subscriptions.append(player.events.on(AdScheduleChangedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAdScheduleChanged(event, player: player) })
        subscriptions.append(player.events.on(AdScheduledEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAdScheduled(event, player: player) })
        subscriptions.append(player.events.on(AdSkippedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAdSkipped(event, player: player) })
        subscriptions.append(player.events.on(AdStartedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAdStarted(event, player: player) })
        subscriptions.append(player.events.on(AirPlayAvailabilityChangedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAirPlayAvailabilityChanged(event, player: player) })
        subscriptions.append(player.events.on(AirPlayAvailableEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAirPlayAvailable(event, player: player) })
        subscriptions.append(player.events.on(AirPlayChangedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAirPlayChanged(event, player: player) })
        subscriptions.append(player.events.on(AudioAddedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAudioAdded(event, player: player) })
        subscriptions.append(player.events.on(AudioChangedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAudioChanged(event, player: player) })
        subscriptions.append(player.events.on(AudioRemovedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onAudioRemoved(event, player: player) })
        subscriptions.append(player.events.on(CastAvailableEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onCastAvailable(event, player: player) })
        subscriptions.append(player.events.on(CastPausedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onCastPaused(event, player: player) })
        subscriptions.append(player.events.on(CastPlaybackFinishedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onCastPlaybackFinished(event, player: player) })
        subscriptions.append(player.events.on(CastPlayingEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onCastPlaying(event, player: player) })
        subscriptions.append(player.events.on(CastStartEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onCastStart(event, player: player) })
        subscriptions.append(player.events.on(CastStartedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onCastStarted(event, player: player) })
        subscriptions.append(player.events.on(CastStoppedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onCastStopped(event, player: player) })
        subscriptions.append(player.events.on(CastTimeUpdatedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onCastTimeUpdated(event, player: player) })
        subscriptions.append(player.events.on(CueEnterEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onCueEnter(event, player: player) })
        subscriptions.append(player.events.on(CueExitEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onCueExit(event, player: player) })
        subscriptions.append(player.events.on(CueParsedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onCueParsed(event, player: player) })
        subscriptions.append(player.events.on(DestroyEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onDestroy(event, player: player) })
        subscriptions.append(player.events.on(DownloadFinishedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onDownloadFinished(event, player: player) })
        subscriptions.append(player.events.on(DrmDataParsedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onDrmDataParsed(event, player: player) })
        subscriptions.append(player.events.on(DurationChangedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onDurationChanged(event, player: player) })
        subscriptions.append(player.events.on(DvrWindowExceededEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onDvrWindowExceeded(event, player: player) })
        subscriptions.append(player.events.on(FairplayLicenseAcquiredEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onFairplayLicenseAcquired(event, player: player) })
        subscriptions.append(player.events.on(LatencyModeChangedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onLatencyModeChanged(event, player: player) })
        subscriptions.append(player.events.on(LicenseValidatedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onLicenseValidated(event, player: player) })
        subscriptions.append(player.events.on(MetadataEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onMetadata(event, player: player) })
        subscriptions.append(player.events.on(MetadataParsedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onMetadataParsed(event, player: player) })
        subscriptions.append(player.events.on(MutedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onMuted(event, player: player) })
        subscriptions.append(player.events.on(OutputObscuredEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onOutputObscured(event, player: player) })
        subscriptions.append(player.events.on(OutputUnobscuredEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onOutputUnobscured(event, player: player) })
        subscriptions.append(player.events.on(PausedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onPaused(event, player: player) })
        subscriptions.append(player.events.on(PlayEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onPlay(event, player: player) })
        subscriptions.append(player.events.on(PlaybackFinishedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onPlaybackFinished(event, player: player) })
        subscriptions.append(player.events.on(PlaybackSpeedChangedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onPlaybackSpeedChanged(event, player: player) })
        subscriptions.append(player.events.on(PlayerActiveEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onPlayerActive(event, player: player) })
        subscriptions.append(player.events.on(PlayerErrorEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onPlayerError(event, player: player) })
        subscriptions.append(player.events.on(PlayerInactiveEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onPlayerInactive(event, player: player) })
        subscriptions.append(player.events.on(PlayerWarningEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onPlayerWarning(event, player: player) })
        subscriptions.append(player.events.on(PlayingEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onPlaying(event, player: player) })
        subscriptions.append(player.events.on(PlaylistTransitionEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onPlaylistTransition(event, player: player) })
        subscriptions.append(player.events.on(ReadyEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onReady(event, player: player) })
        subscriptions.append(player.events.on(SeekEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSeek(event, player: player) })
        subscriptions.append(player.events.on(SeekedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSeeked(event, player: player) })
        subscriptions.append(player.events.on(SharePlayEndedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSharePlayEnded(event, player: player) })
        subscriptions.append(player.events.on(SharePlayStartedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSharePlayStarted(event, player: player) })
        subscriptions.append(player.events.on(SharePlaySuspensionEndedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSharePlaySuspensionEnded(event, player: player) })
        subscriptions.append(player.events.on(SharePlaySuspensionStartedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSharePlaySuspensionStarted(event, player: player) })
        subscriptions.append(player.events.on(SourceAddedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSourceAdded(event, player: player) })
        subscriptions.append(player.events.on(SourceErrorEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSourceError(event, player: player) })
        subscriptions.append(player.events.on(SourceLoadEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSourceLoad(event, player: player) })
        subscriptions.append(player.events.on(SourceLoadedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSourceLoaded(event, player: player) })
        subscriptions.append(player.events.on(SourceMetadataChangedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSourceMetadataChanged(event, player: player) })
        subscriptions.append(player.events.on(SourceRemovedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSourceRemoved(event, player: player) })
        subscriptions.append(player.events.on(SourceUnloadEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSourceUnload(event, player: player) })
        subscriptions.append(player.events.on(SourceUnloadedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSourceUnloaded(event, player: player) })
        subscriptions.append(player.events.on(SourceWarningEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSourceWarning(event, player: player) })
        subscriptions.append(player.events.on(StallEndedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onStallEnded(event, player: player) })
        subscriptions.append(player.events.on(StallStartedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onStallStarted(event, player: player) })
        subscriptions.append(player.events.on(SubtitleAddedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSubtitleAdded(event, player: player) })
        subscriptions.append(player.events.on(SubtitleChangedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSubtitleChanged(event, player: player) })
        subscriptions.append(player.events.on(SubtitleRemovedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onSubtitleRemoved(event, player: player) })
        subscriptions.append(player.events.on(TimeChangedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onTimeChanged(event, player: player) })
        subscriptions.append(player.events.on(TimeShiftEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onTimeShift(event, player: player) })
        subscriptions.append(player.events.on(TimeShiftedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onTimeShifted(event, player: player) })
        subscriptions.append(player.events.on(UnmutedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onUnmuted(event, player: player) })
        subscriptions.append(player.events.on(VideoDownloadQualityChangedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onVideoDownloadQualityChanged(event, player: player) })
        subscriptions.append(player.events.on(VideoPlaybackQualityChangedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onVideoPlaybackQualityChanged(event, player: player) })
        subscriptions.append(player.events.on(VideoSizeChangedEvent.self).sink { [weak receiver, weak player] event in guard let player else { return }; receiver?.onVideoSizeChanged(event, player: player) })
        return subscriptions
    }

    static func source(_ source: Source, receiver: SourceApiEventListener) -> [AnyCancellable] {
        var subscriptions: [AnyCancellable] = []
        subscriptions.append(source.events.on(AudioAddedEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onAudioAdded(event, source: source) })
        subscriptions.append(source.events.on(AudioChangedEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onAudioChanged(event, source: source) })
        subscriptions.append(source.events.on(AudioRemovedEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onAudioRemoved(event, source: source) })
        subscriptions.append(source.events.on(CueParsedEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onCueParsed(event, source: source) })
        subscriptions.append(source.events.on(DrmDataParsedEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onDrmDataParsed(event, source: source) })
        subscriptions.append(source.events.on(DurationChangedEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onDurationChanged(event, source: source) })
        subscriptions.append(source.events.on(FairplayLicenseAcquiredEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onFairplayLicenseAcquired(event, source: source) })
        subscriptions.append(source.events.on(MetadataParsedEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onMetadataParsed(event, source: source) })
        subscriptions.append(source.events.on(SourceErrorEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onSourceError(event, source: source) })
        subscriptions.append(source.events.on(SourceLoadEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onSourceLoad(event, source: source) })
        subscriptions.append(source.events.on(SourceLoadedEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onSourceLoaded(event, source: source) })
        subscriptions.append(source.events.on(SourceUnloadEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onSourceUnload(event, source: source) })
        subscriptions.append(source.events.on(SourceUnloadedEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onSourceUnloaded(event, source: source) })
        subscriptions.append(source.events.on(SourceWarningEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onSourceWarning(event, source: source) })
        subscriptions.append(source.events.on(SubtitleAddedEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onSubtitleAdded(event, source: source) })
        subscriptions.append(source.events.on(SubtitleChangedEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onSubtitleChanged(event, source: source) })
        subscriptions.append(source.events.on(SubtitleRemovedEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onSubtitleRemoved(event, source: source) })
        subscriptions.append(source.events.on(VideoDownloadQualityChangedEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onVideoDownloadQualityChanged(event, source: source) })
        subscriptions.append(source.events.on(VideoPlaybackQualityChangedEvent.self).sink { [weak receiver, weak source] event in guard let source else { return }; receiver?.onVideoPlaybackQualityChanged(event, source: source) })
        return subscriptions
    }

    @MainActor
    static func view(_ view: PlayerView, receiver: ViewApiEventListener) -> [AnyCancellable] {
        var subscriptions: [AnyCancellable] = []
        subscriptions.append(view.events.on(ControlsHideEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onControlsHide(event, view: view) })
        subscriptions.append(view.events.on(ControlsShowEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onControlsShow(event, view: view) })
        subscriptions.append(view.events.on(FullscreenDisabledEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onFullscreenDisabled(event, view: view) })
        subscriptions.append(view.events.on(FullscreenEnabledEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onFullscreenEnabled(event, view: view) })
        subscriptions.append(view.events.on(FullscreenEnterEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onFullscreenEnter(event, view: view) })
        subscriptions.append(view.events.on(FullscreenExitEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onFullscreenExit(event, view: view) })
        subscriptions.append(view.events.on(PictureInPictureAvailabilityChangedEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onPictureInPictureAvailabilityChanged(event, view: view) })
        subscriptions.append(view.events.on(PictureInPictureEnterEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onPictureInPictureEnter(event, view: view) })
        subscriptions.append(view.events.on(PictureInPictureEnteredEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onPictureInPictureEntered(event, view: view) })
        subscriptions.append(view.events.on(PictureInPictureExitEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onPictureInPictureExit(event, view: view) })
        subscriptions.append(view.events.on(PictureInPictureExitedEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onPictureInPictureExited(event, view: view) })
        subscriptions.append(view.events.on(ScalingModeChangedEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onScalingModeChanged(event, view: view) })
        subscriptions.append(view.events.on(TimelineMarkerEnterEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onTimelineMarkerEnter(event, view: view) })
        subscriptions.append(view.events.on(TimelineMarkerExitEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onTimelineMarkerExit(event, view: view) })
    #if !os(tvOS)
        subscriptions.append(view.events.on(VideoBoundsChangedEvent.self).sink { [weak receiver, weak view] event in guard let view else { return }; receiver?.onVideoBoundsChanged(event, view: view) })
    #endif
        return subscriptions
    }

}
