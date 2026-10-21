import Foundation
import BitmovinPlayer

struct ApiEventRecord: Identifiable {
    let id = UUID()
    let api: String
    let timestamp: TimeInterval
    let owner: String
}

/// Typed public callbacks keep event identity explicit; only names and SDK timestamps are logged.
class ApiEventReceiver: NSObject {
    private let receive: (String, TimeInterval) -> Void
    init(receive: @escaping (String, TimeInterval) -> Void) { self.receive = receive }
    func send(_ api: String, timestamp: TimeInterval) {
        DispatchQueue.main.async { [weak self] in self?.receive(api, timestamp) }
    }
}

final class PlayerApiEventListener: ApiEventReceiver, PlayerListener {
    func onAdBreakFinished(_ event: AdBreakFinishedEvent, player: Player) {
        send("BitmovinPlayerCore.AdBreakFinishedEvent", timestamp: event.timestamp)
    }
    func onAdBreakStarted(_ event: AdBreakStartedEvent, player: Player) {
        send("BitmovinPlayerCore.AdBreakStartedEvent", timestamp: event.timestamp)
    }
    func onAdClicked(_ event: AdClickedEvent, player: Player) {
        send("BitmovinPlayerCore.AdClickedEvent", timestamp: event.timestamp)
    }
    func onAdError(_ event: AdErrorEvent, player: Player) {
        send("BitmovinPlayerCore.AdErrorEvent", timestamp: event.timestamp)
    }
    func onAdFinished(_ event: AdFinishedEvent, player: Player) {
        send("BitmovinPlayerCore.AdFinishedEvent", timestamp: event.timestamp)
    }
    func onAdManifestLoad(_ event: AdManifestLoadEvent, player: Player) {
        send("BitmovinPlayerCore.AdManifestLoadEvent", timestamp: event.timestamp)
    }
    func onAdManifestLoaded(_ event: AdManifestLoadedEvent, player: Player) {
        send("BitmovinPlayerCore.AdManifestLoadedEvent", timestamp: event.timestamp)
    }
    func onAdQuartile(_ event: AdQuartileEvent, player: Player) {
        send("BitmovinPlayerCore.AdQuartileEvent", timestamp: event.timestamp)
    }
    func onAdScheduleChanged(_ event: AdScheduleChangedEvent, player: Player) {
        send("BitmovinPlayerCore.AdScheduleChangedEvent", timestamp: event.timestamp)
    }
    func onAdScheduled(_ event: AdScheduledEvent, player: Player) {
        send("BitmovinPlayerCore.AdScheduledEvent", timestamp: event.timestamp)
    }
    func onAdSkipped(_ event: AdSkippedEvent, player: Player) {
        send("BitmovinPlayerCore.AdSkippedEvent", timestamp: event.timestamp)
    }
    func onAdStarted(_ event: AdStartedEvent, player: Player) {
        send("BitmovinPlayerCore.AdStartedEvent", timestamp: event.timestamp)
    }
    func onAirPlayAvailabilityChanged(_ event: AirPlayAvailabilityChangedEvent, player: Player) {
        send("BitmovinPlayerCore.AirPlayAvailabilityChangedEvent", timestamp: event.timestamp)
    }
    func onAirPlayAvailable(_ event: AirPlayAvailableEvent, player: Player) {
        send("BitmovinPlayerCore.AirPlayAvailableEvent", timestamp: event.timestamp)
    }
    func onAirPlayChanged(_ event: AirPlayChangedEvent, player: Player) {
        send("BitmovinPlayerCore.AirPlayChangedEvent", timestamp: event.timestamp)
    }
    func onAudioAdded(_ event: AudioAddedEvent, player: Player) {
        send("BitmovinPlayerCore.AudioAddedEvent", timestamp: event.timestamp)
    }
    func onAudioChanged(_ event: AudioChangedEvent, player: Player) {
        send("BitmovinPlayerCore.AudioChangedEvent", timestamp: event.timestamp)
    }
    func onAudioRemoved(_ event: AudioRemovedEvent, player: Player) {
        send("BitmovinPlayerCore.AudioRemovedEvent", timestamp: event.timestamp)
    }
    func onCastAvailable(_ event: CastAvailableEvent, player: Player) {
        send("BitmovinPlayerCore.CastAvailableEvent", timestamp: event.timestamp)
    }
    func onCastPaused(_ event: CastPausedEvent, player: Player) {
        send("BitmovinPlayerCore.CastPausedEvent", timestamp: event.timestamp)
    }
    func onCastPlaybackFinished(_ event: CastPlaybackFinishedEvent, player: Player) {
        send("BitmovinPlayerCore.CastPlaybackFinishedEvent", timestamp: event.timestamp)
    }
    func onCastPlaying(_ event: CastPlayingEvent, player: Player) {
        send("BitmovinPlayerCore.CastPlayingEvent", timestamp: event.timestamp)
    }
    func onCastStart(_ event: CastStartEvent, player: Player) {
        send("BitmovinPlayerCore.CastStartEvent", timestamp: event.timestamp)
    }
    func onCastStarted(_ event: CastStartedEvent, player: Player) {
        send("BitmovinPlayerCore.CastStartedEvent", timestamp: event.timestamp)
    }
    func onCastStopped(_ event: CastStoppedEvent, player: Player) {
        send("BitmovinPlayerCore.CastStoppedEvent", timestamp: event.timestamp)
    }
    func onCastTimeUpdated(_ event: CastTimeUpdatedEvent, player: Player) {
        send("BitmovinPlayerCore.CastTimeUpdatedEvent", timestamp: event.timestamp)
    }
    #if !os(tvOS)
    func onCastWaiting(forDevice event: CastWaitingForDeviceEvent, player: Player) {
        send("BitmovinPlayerCore.CastWaitingForDeviceEvent", timestamp: event.timestamp)
    }
    #endif
    func onCueEnter(_ event: CueEnterEvent, player: Player) {
        send("BitmovinPlayerCore.CueEnterEvent", timestamp: event.timestamp)
    }
    func onCueExit(_ event: CueExitEvent, player: Player) {
        send("BitmovinPlayerCore.CueExitEvent", timestamp: event.timestamp)
    }
    func onCueParsed(_ event: CueParsedEvent, player: Player) {
        send("BitmovinPlayerCore.CueParsedEvent", timestamp: event.timestamp)
    }
    func onDestroy(_ event: DestroyEvent, player: Player) {
        send("BitmovinPlayerCore.DestroyEvent", timestamp: event.timestamp)
    }
    func onDownloadFinished(_ event: DownloadFinishedEvent, player: Player) {
        send("BitmovinPlayerCore.DownloadFinishedEvent", timestamp: event.timestamp)
    }
    func onDrmDataParsed(_ event: DrmDataParsedEvent, player: Player) {
        send("BitmovinPlayerCore.DrmDataParsedEvent", timestamp: event.timestamp)
    }
    func onDurationChanged(_ event: DurationChangedEvent, player: Player) {
        send("BitmovinPlayerCore.DurationChangedEvent", timestamp: event.timestamp)
    }
    func onDvrWindowExceeded(_ event: DvrWindowExceededEvent, player: Player) {
        send("BitmovinPlayerCore.DvrWindowExceededEvent", timestamp: event.timestamp)
    }
    func onFairplayLicenseAcquired(_ event: FairplayLicenseAcquiredEvent, player: Player) {
        send("BitmovinPlayerCore.FairplayLicenseAcquiredEvent", timestamp: event.timestamp)
    }
    func onLatencyModeChanged(_ event: LatencyModeChangedEvent, player: Player) {
        send("BitmovinPlayerCore.LatencyModeChangedEvent", timestamp: event.timestamp)
    }
    func onLicenseValidated(_ event: LicenseValidatedEvent, player: Player) {
        send("BitmovinPlayerCore.LicenseValidatedEvent", timestamp: event.timestamp)
    }
    func onMetadata(_ event: MetadataEvent, player: Player) {
        send("BitmovinPlayerCore.MetadataEvent", timestamp: event.timestamp)
    }
    func onMetadataParsed(_ event: MetadataParsedEvent, player: Player) {
        send("BitmovinPlayerCore.MetadataParsedEvent", timestamp: event.timestamp)
    }
    func onMuted(_ event: MutedEvent, player: Player) {
        send("BitmovinPlayerCore.MutedEvent", timestamp: event.timestamp)
    }
    func onOutputObscured(_ event: OutputObscuredEvent, player: Player) {
        send("BitmovinPlayerCore.OutputObscuredEvent", timestamp: event.timestamp)
    }
    func onOutputUnobscured(_ event: OutputUnobscuredEvent, player: Player) {
        send("BitmovinPlayerCore.OutputUnobscuredEvent", timestamp: event.timestamp)
    }
    func onPaused(_ event: PausedEvent, player: Player) {
        send("BitmovinPlayerCore.PausedEvent", timestamp: event.timestamp)
    }
    func onPlay(_ event: PlayEvent, player: Player) {
        send("BitmovinPlayerCore.PlayEvent", timestamp: event.timestamp)
    }
    func onPlaybackFinished(_ event: PlaybackFinishedEvent, player: Player) {
        send("BitmovinPlayerCore.PlaybackFinishedEvent", timestamp: event.timestamp)
    }
    func onPlaybackSpeedChanged(_ event: PlaybackSpeedChangedEvent, player: Player) {
        send("BitmovinPlayerCore.PlaybackSpeedChangedEvent", timestamp: event.timestamp)
    }
    func onPlayerActive(_ event: PlayerActiveEvent, player: Player) {
        send("BitmovinPlayerCore.PlayerActiveEvent", timestamp: event.timestamp)
    }
    func onPlayerError(_ event: PlayerErrorEvent, player: Player) {
        send("BitmovinPlayerCore.PlayerErrorEvent", timestamp: event.timestamp)
    }
    func onPlayerInactive(_ event: PlayerInactiveEvent, player: Player) {
        send("BitmovinPlayerCore.PlayerInactiveEvent", timestamp: event.timestamp)
    }
    func onPlayerWarning(_ event: PlayerWarningEvent, player: Player) {
        send("BitmovinPlayerCore.PlayerWarningEvent", timestamp: event.timestamp)
    }
    func onPlaying(_ event: PlayingEvent, player: Player) {
        send("BitmovinPlayerCore.PlayingEvent", timestamp: event.timestamp)
    }
    func onPlaylistTransition(_ event: PlaylistTransitionEvent, player: Player) {
        send("BitmovinPlayerCore.PlaylistTransitionEvent", timestamp: event.timestamp)
    }
    func onReady(_ event: ReadyEvent, player: Player) {
        send("BitmovinPlayerCore.ReadyEvent", timestamp: event.timestamp)
    }
    func onSeek(_ event: SeekEvent, player: Player) {
        send("BitmovinPlayerCore.SeekEvent", timestamp: event.timestamp)
    }
    func onSeeked(_ event: SeekedEvent, player: Player) {
        send("BitmovinPlayerCore.SeekedEvent", timestamp: event.timestamp)
    }
    func onSharePlayEnded(_ event: SharePlayEndedEvent, player: Player) {
        send("BitmovinPlayerCore.SharePlayEndedEvent", timestamp: event.timestamp)
    }
    func onSharePlayStarted(_ event: SharePlayStartedEvent, player: Player) {
        send("BitmovinPlayerCore.SharePlayStartedEvent", timestamp: event.timestamp)
    }
    func onSharePlaySuspensionEnded(_ event: SharePlaySuspensionEndedEvent, player: Player) {
        send("BitmovinPlayerCore.SharePlaySuspensionEndedEvent", timestamp: event.timestamp)
    }
    func onSharePlaySuspensionStarted(_ event: SharePlaySuspensionStartedEvent, player: Player) {
        send("BitmovinPlayerCore.SharePlaySuspensionStartedEvent", timestamp: event.timestamp)
    }
    func onSourceAdded(_ event: SourceAddedEvent, player: Player) {
        send("BitmovinPlayerCore.SourceAddedEvent", timestamp: event.timestamp)
    }
    func onSourceError(_ event: SourceErrorEvent, player: Player) {
        send("BitmovinPlayerCore.SourceErrorEvent", timestamp: event.timestamp)
    }
    func onSourceLoad(_ event: SourceLoadEvent, player: Player) {
        send("BitmovinPlayerCore.SourceLoadEvent", timestamp: event.timestamp)
    }
    func onSourceLoaded(_ event: SourceLoadedEvent, player: Player) {
        send("BitmovinPlayerCore.SourceLoadedEvent", timestamp: event.timestamp)
    }
    func onSourceMetadataChanged(_ event: SourceMetadataChangedEvent, player: Player) {
        send("BitmovinPlayerCore.SourceMetadataChangedEvent", timestamp: event.timestamp)
    }
    func onSourceRemoved(_ event: SourceRemovedEvent, player: Player) {
        send("BitmovinPlayerCore.SourceRemovedEvent", timestamp: event.timestamp)
    }
    func onSourceUnload(_ event: SourceUnloadEvent, player: Player) {
        send("BitmovinPlayerCore.SourceUnloadEvent", timestamp: event.timestamp)
    }
    func onSourceUnloaded(_ event: SourceUnloadedEvent, player: Player) {
        send("BitmovinPlayerCore.SourceUnloadedEvent", timestamp: event.timestamp)
    }
    func onSourceWarning(_ event: SourceWarningEvent, player: Player) {
        send("BitmovinPlayerCore.SourceWarningEvent", timestamp: event.timestamp)
    }
    func onStallEnded(_ event: StallEndedEvent, player: Player) {
        send("BitmovinPlayerCore.StallEndedEvent", timestamp: event.timestamp)
    }
    func onStallStarted(_ event: StallStartedEvent, player: Player) {
        send("BitmovinPlayerCore.StallStartedEvent", timestamp: event.timestamp)
    }
    func onSubtitleAdded(_ event: SubtitleAddedEvent, player: Player) {
        send("BitmovinPlayerCore.SubtitleAddedEvent", timestamp: event.timestamp)
    }
    func onSubtitleChanged(_ event: SubtitleChangedEvent, player: Player) {
        send("BitmovinPlayerCore.SubtitleChangedEvent", timestamp: event.timestamp)
    }
    func onSubtitleRemoved(_ event: SubtitleRemovedEvent, player: Player) {
        send("BitmovinPlayerCore.SubtitleRemovedEvent", timestamp: event.timestamp)
    }
    func onTimeChanged(_ event: TimeChangedEvent, player: Player) {
        send("BitmovinPlayerCore.TimeChangedEvent", timestamp: event.timestamp)
    }
    func onTimeShift(_ event: TimeShiftEvent, player: Player) {
        send("BitmovinPlayerCore.TimeShiftEvent", timestamp: event.timestamp)
    }
    func onTimeShifted(_ event: TimeShiftedEvent, player: Player) {
        send("BitmovinPlayerCore.TimeShiftedEvent", timestamp: event.timestamp)
    }
    func onUnmuted(_ event: UnmutedEvent, player: Player) {
        send("BitmovinPlayerCore.UnmutedEvent", timestamp: event.timestamp)
    }
    func onVideoDownloadQualityChanged(_ event: VideoDownloadQualityChangedEvent, player: Player) {
        send("BitmovinPlayerCore.VideoDownloadQualityChangedEvent", timestamp: event.timestamp)
    }
    func onVideoPlaybackQualityChanged(_ event: VideoPlaybackQualityChangedEvent, player: Player) {
        send("BitmovinPlayerCore.VideoPlaybackQualityChangedEvent", timestamp: event.timestamp)
    }
    func onVideoSizeChanged(_ event: VideoSizeChangedEvent, player: Player) {
        send("BitmovinPlayerCore.VideoSizeChangedEvent", timestamp: event.timestamp)
    }
}

final class SourceApiEventListener: ApiEventReceiver, SourceListener {
    var parsedCue: ((Cue) -> Void)?
    func onAudioAdded(_ event: AudioAddedEvent, source: Source) {
        send("BitmovinPlayerCore.AudioAddedEvent", timestamp: event.timestamp)
    }
    func onAudioChanged(_ event: AudioChangedEvent, source: Source) {
        send("BitmovinPlayerCore.AudioChangedEvent", timestamp: event.timestamp)
    }
    func onAudioRemoved(_ event: AudioRemovedEvent, source: Source) {
        send("BitmovinPlayerCore.AudioRemovedEvent", timestamp: event.timestamp)
    }
    func onCueParsed(_ event: CueParsedEvent, source: Source) {
        let cue = Cue(startTime: event.startTime, endTime: event.endTime, html: event.html, text: event.text,
            rawText: event.rawText, attributedText: event.attributedText, image: event.image, position: event.position,
            region: event.region, regionStyle: event.regionStyle, vttProperties: event.vtt)
        DispatchQueue.main.async { [weak self] in self?.parsedCue?(cue) }
        send("BitmovinPlayerCore.CueParsedEvent", timestamp: event.timestamp)
    }
    func onDrmDataParsed(_ event: DrmDataParsedEvent, source: Source) {
        send("BitmovinPlayerCore.DrmDataParsedEvent", timestamp: event.timestamp)
    }
    func onDurationChanged(_ event: DurationChangedEvent, source: Source) {
        send("BitmovinPlayerCore.DurationChangedEvent", timestamp: event.timestamp)
    }
    func onFairplayLicenseAcquired(_ event: FairplayLicenseAcquiredEvent, source: Source) {
        send("BitmovinPlayerCore.FairplayLicenseAcquiredEvent", timestamp: event.timestamp)
    }
    func onMetadataParsed(_ event: MetadataParsedEvent, source: Source) {
        send("BitmovinPlayerCore.MetadataParsedEvent", timestamp: event.timestamp)
    }
    func onSourceError(_ event: SourceErrorEvent, source: Source) {
        send("BitmovinPlayerCore.SourceErrorEvent", timestamp: event.timestamp)
    }
    func onSourceLoad(_ event: SourceLoadEvent, source: Source) {
        send("BitmovinPlayerCore.SourceLoadEvent", timestamp: event.timestamp)
    }
    func onSourceLoaded(_ event: SourceLoadedEvent, source: Source) {
        send("BitmovinPlayerCore.SourceLoadedEvent", timestamp: event.timestamp)
    }
    func onSourceUnload(_ event: SourceUnloadEvent, source: Source) {
        send("BitmovinPlayerCore.SourceUnloadEvent", timestamp: event.timestamp)
    }
    func onSourceUnloaded(_ event: SourceUnloadedEvent, source: Source) {
        send("BitmovinPlayerCore.SourceUnloadedEvent", timestamp: event.timestamp)
    }
    func onSourceWarning(_ event: SourceWarningEvent, source: Source) {
        send("BitmovinPlayerCore.SourceWarningEvent", timestamp: event.timestamp)
    }
    func onSubtitleAdded(_ event: SubtitleAddedEvent, source: Source) {
        send("BitmovinPlayerCore.SubtitleAddedEvent", timestamp: event.timestamp)
    }
    func onSubtitleChanged(_ event: SubtitleChangedEvent, source: Source) {
        send("BitmovinPlayerCore.SubtitleChangedEvent", timestamp: event.timestamp)
    }
    func onSubtitleRemoved(_ event: SubtitleRemovedEvent, source: Source) {
        send("BitmovinPlayerCore.SubtitleRemovedEvent", timestamp: event.timestamp)
    }
    func onVideoDownloadQualityChanged(_ event: VideoDownloadQualityChangedEvent, source: Source) {
        send("BitmovinPlayerCore.VideoDownloadQualityChangedEvent", timestamp: event.timestamp)
    }
    func onVideoPlaybackQualityChanged(_ event: VideoPlaybackQualityChangedEvent, source: Source) {
        send("BitmovinPlayerCore.VideoPlaybackQualityChangedEvent", timestamp: event.timestamp)
    }
}

final class ViewApiEventListener: ApiEventReceiver, UserInterfaceListener {
    func onControlsHide(_ event: ControlsHideEvent, view: PlayerView) {
        send("BitmovinPlayerCore.ControlsHideEvent", timestamp: event.timestamp)
    }
    func onControlsShow(_ event: ControlsShowEvent, view: PlayerView) {
        send("BitmovinPlayerCore.ControlsShowEvent", timestamp: event.timestamp)
    }
    func onFullscreenDisabled(_ event: FullscreenDisabledEvent, view: PlayerView) {
        send("BitmovinPlayerCore.FullscreenDisabledEvent", timestamp: event.timestamp)
    }
    func onFullscreenEnabled(_ event: FullscreenEnabledEvent, view: PlayerView) {
        send("BitmovinPlayerCore.FullscreenEnabledEvent", timestamp: event.timestamp)
    }
    func onFullscreenEnter(_ event: FullscreenEnterEvent, view: PlayerView) {
        send("BitmovinPlayerCore.FullscreenEnterEvent", timestamp: event.timestamp)
    }
    func onFullscreenExit(_ event: FullscreenExitEvent, view: PlayerView) {
        send("BitmovinPlayerCore.FullscreenExitEvent", timestamp: event.timestamp)
    }
    func onPictureInPictureAvailabilityChanged(_ event: PictureInPictureAvailabilityChangedEvent, view: PlayerView) {
        send("BitmovinPlayerCore.PictureInPictureAvailabilityChangedEvent", timestamp: event.timestamp)
    }
    func onPictureInPictureEnter(_ event: PictureInPictureEnterEvent, view: PlayerView) {
        send("BitmovinPlayerCore.PictureInPictureEnterEvent", timestamp: event.timestamp)
    }
    func onPictureInPictureEntered(_ event: PictureInPictureEnteredEvent, view: PlayerView) {
        send("BitmovinPlayerCore.PictureInPictureEnteredEvent", timestamp: event.timestamp)
    }
    func onPictureInPictureExit(_ event: PictureInPictureExitEvent, view: PlayerView) {
        send("BitmovinPlayerCore.PictureInPictureExitEvent", timestamp: event.timestamp)
    }
    func onPictureInPictureExited(_ event: PictureInPictureExitedEvent, view: PlayerView) {
        send("BitmovinPlayerCore.PictureInPictureExitedEvent", timestamp: event.timestamp)
    }
    func onScalingModeChanged(_ event: ScalingModeChangedEvent, view: PlayerView) {
        send("BitmovinPlayerCore.ScalingModeChangedEvent", timestamp: event.timestamp)
    }
    func onTimelineMarkerEnter(_ event: TimelineMarkerEnterEvent, view: PlayerView) {
        send("BitmovinPlayerCore.TimelineMarkerEnterEvent", timestamp: event.timestamp)
    }
    func onTimelineMarkerExit(_ event: TimelineMarkerExitEvent, view: PlayerView) {
        send("BitmovinPlayerCore.TimelineMarkerExitEvent", timestamp: event.timestamp)
    }
    #if !os(tvOS)
    func onVideoBoundsChanged(_ event: VideoBoundsChangedEvent, view: PlayerView) {
        send("BitmovinPlayerCore.VideoBoundsChangedEvent", timestamp: event.timestamp)
    }
    #endif
}

#if !os(tvOS)
class OfflineApiEventListener: ApiEventReceiver, OfflineContentManagerListener {
    #if !os(tvOS)
    func onAvailableTracksFetched(_ event: AvailableTracksFetchedEvent, offlineContentManager: OfflineContentManager) {
        send("BitmovinPlayerCore.AvailableTracksFetchedEvent", timestamp: event.timestamp)
    }
    #endif
    #if !os(tvOS)
    func onContentDownloadCanceled(_ event: ContentDownloadCanceledEvent, offlineContentManager: OfflineContentManager) {
        send("BitmovinPlayerCore.ContentDownloadCanceledEvent", timestamp: event.timestamp)
    }
    #endif
    #if !os(tvOS)
    func onContentDownloadFinished(_ event: ContentDownloadFinishedEvent, offlineContentManager: OfflineContentManager) {
        send("BitmovinPlayerCore.ContentDownloadFinishedEvent", timestamp: event.timestamp)
    }
    #endif
    #if !os(tvOS)
    func onContentDownloadProgressChanged(_ event: ContentDownloadProgressChangedEvent, offlineContentManager: OfflineContentManager) {
        send("BitmovinPlayerCore.ContentDownloadProgressChangedEvent", timestamp: event.timestamp)
    }
    #endif
    #if !os(tvOS)
    func onContentDownloadResumed(_ event: ContentDownloadResumedEvent, offlineContentManager: OfflineContentManager) {
        send("BitmovinPlayerCore.ContentDownloadResumedEvent", timestamp: event.timestamp)
    }
    #endif
    #if !os(tvOS)
    func onContentDownloadSuspended(_ event: ContentDownloadSuspendedEvent, offlineContentManager: OfflineContentManager) {
        send("BitmovinPlayerCore.ContentDownloadSuspendedEvent", timestamp: event.timestamp)
    }
    #endif
    #if !os(tvOS)
    func onContentUrlMigrationFinished(_ event: ContentUrlMigrationFinishedEvent, offlineContentManager: OfflineContentManager) {
        send("BitmovinPlayerCore.ContentUrlMigrationFinishedEvent", timestamp: event.timestamp)
    }
    #endif
    #if !os(tvOS)
    func onOfflineContentLicenseExpired(_ event: OfflineContentLicenseExpiredEvent, offlineContentManager: OfflineContentManager) {
        send("BitmovinPlayerCore.OfflineContentLicenseExpiredEvent", timestamp: event.timestamp)
    }
    #endif
    #if !os(tvOS)
    func onOfflineContentLicenseRenewed(_ event: OfflineContentLicenseRenewedEvent, offlineContentManager: OfflineContentManager) {
        send("BitmovinPlayerCore.OfflineContentLicenseRenewedEvent", timestamp: event.timestamp)
    }
    #endif
    #if !os(tvOS)
    func onOfflineError(_ event: OfflineErrorEvent, offlineContentManager: OfflineContentManager) {
        send("BitmovinPlayerCore.OfflineErrorEvent", timestamp: event.timestamp)
    }
    #endif
}
#endif
