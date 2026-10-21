import Foundation
import BitmovinPlayer

struct ApiStateValue: Identifiable {
    let id: String
    let value: String
}

extension PlayerModel {
    @MainActor
    func refreshApiState() {
        let player = self.player
        var rows = [ApiStateValue(id: "Player.isDestroyed", value: String(player.isDestroyed))]
        guard !player.isDestroyed else { setApiState(rows); return }
        let subtitleIdentifiers = Set(player.availableSubtitles.map(\.identifier))
        apiObjects.enteredCues = apiObjects.enteredCues.filter { $0.value.source === player.source && subtitleIdentifiers.contains($0.key) }
        func put(_ id: String, _ value: String) { rows.append(.init(id: id, value: value)) }
        put("PlayerFactory.sdkVersion", PlayerFactory.sdkVersion)
        put("PlayerCoreFactory.sdkVersion", PlayerCoreFactory.sdkVersion)
        put("Presentation.host", presentation.rawValue)
        put("Player.factory", nativePlayerFactory.rawValue)
        put("EventSubscription.transport", apiEventTransport.rawValue)
        put("DebugConfig.logging", "Global SDK logging configuration")
        put("LoggingConfig.logger", DebugConfig.logging.logger.map { $0 is ConsoleLogger ? "ConsoleLogger" : $0 is NativeGuiLogger ? "Editable JavaScript Logger" : "Other Logger" } ?? "nil; logging disabled")
        put("Logger.level", DebugConfig.logging.logger.map { String($0.level.rawValue) } ?? "No logger")
        put("ConsoleLogger.level", "Inspector-owned ConsoleLogger: \(apiObjects.consoleLogger.level.rawValue)")
        if let logger = DebugConfig.logging.logger as? NativeGuiLogger { put("Logger.safeSummary", logger.summary) }
        put("Presentation.registeredLayer", String(apiObjects.presentationRegistration.layer?.player != nil))
        put("Presentation.registeredController", String(apiObjects.presentationRegistration.controller?.player != nil))
        if presentation == .sdkBindings {
            put("VideoPlayerView.isPictureInPictureEnabled(_:)", String(boundPiPEnabled))
            put("VideoPlayerView.isPictureInPictureAvailable(_:)", String(boundPiPAvailable))
            put("VideoPlayerView.isPictureInPictureActive(_:)", String(boundPiPActive))
            put("VideoPlayerView.scalingMode(_:)", String(describing: boundScalingMode))
        }
        put("Player.isMuted", String(player.isMuted))
        put("Player.isPaused", String(player.isPaused))
        put("Player.isPlaying", String(player.isPlaying))
        put("Player.isLive", String(player.isLive))
        put("Player.duration", "\(player.duration) seconds")
        put("Player.currentTime", "\(player.currentTime) seconds")
        put("Player.maxTimeShift", "\(player.maxTimeShift) seconds")
        put("Player.timeShift", "\(player.timeShift) seconds")
        put("Player.volume", String(player.volume))
        put("Player.playbackSpeed", String(player.playbackSpeed))
        put("Player.maxSelectableBitrate", "\(player.maxSelectableBitrate) bit/s")
        put("Player.isAd", String(player.isAd))
        put("Player.isAirPlayActive", String(player.isAirPlayActive))
        put("Player.isAirPlayAvailable", String(player.isAirPlayAvailable))
        put("Player.allowsAirPlay", String(player.allowsAirPlay))
        put("Player.isOutputObscured", String(player.isOutputObscured))
        put("Player.currentVideoFrameRate", "\(player.currentVideoFrameRate) frames/s")
        put("RemoteControlApi.isCasting", String(player.isCasting))
        put("RemoteControlApi.isWaitingForDevice", String(player.isWaitingForDevice))
        put("RemoteControlApi.isCastAvailable", String(player.isCastAvailable))
        put("Player.config", "autoplay=\(player.config.playbackConfig.isAutoplayEnabled); muted=\(player.config.playbackConfig.isMuted); Player key configured=\(!(player.config.key ?? "").isEmpty)")
        put("Player.events", "Object \(ObjectIdentifier(player.events).hashValue); typed listener recording: \(apiEventsEnabled)")
        put("Player.buffer", "Forward buffer: \(player.buffer.getLevel(.forwardDuration).level) seconds")
        put("Player.nowPlaying", "Enabled: \(player.nowPlaying.isEnabled)")
        put("Player.latency", "Current latency: \(player.latency.currentLatency) seconds; mode: \(player.latency.currentMode)")
        put("LatencyApi.currentLatency", "\(player.latency.currentLatency) seconds")
        put("LatencyApi.currentMode", String(describing: player.latency.currentMode))
        put("Player.playlist", "\(player.playlist.sources.count) sources")
        put("PlaylistApi.sources", player.playlist.sources.prefix(32).map { $0.sourceConfig.title ?? "Untitled" }.joined(separator: "\n"))
        put("Player.sharePlay", "In group: \(player.sharePlay.isInGroupSession); suspended: \(player.sharePlay.isSuspended)")
        put("SharePlayApi.isInGroupSession", String(player.sharePlay.isInGroupSession))
        put("SharePlayApi.isSuspended", String(player.sharePlay.isSuspended))
        put("SharePlayApi.suspensionReasons", player.sharePlay.suspensionReasons.map { $0.rawValue }.joined(separator: ", "))
        put("SharePlayApi.ownedSuspensions", apiObjects.sharePlaySuspensions.enumerated().map { "\($0.offset): \($0.element.suspension.reason.rawValue); began=\($0.element.suspension.beginDate)" }.joined(separator: "\n"))
        #if !os(tvOS)
        put("CustomMessageHandler.delegate", playerCallbackJournal.messageHandler.map { $0.delegate == nil ? "No delegate" : "App-owned editable callback delegate" } ?? "No configured handler")
        #endif
        if let registry = playerCallbackJournal.interstitialRegistry {
            put("InterstitialCustomAttributesMappingRegistry.clickThroughUrl", registry.clickThroughUrl == nil ? "nil" : "URL configured; value omitted")
            put("InterstitialCustomAttributesMappingRegistry.tracking", "Actual SDK registry; \(InterstitialTrackingEventTrigger.allCases.reduce(0) { $0 + registry.tracking.trackingEvents(for: $1).count }) tracking events")
        }
        put("Player.thumbnails", "Rendering mode: \(player.thumbnails.renderingMode)")
        put("ThumbnailsApi.container", player.thumbnails.container.map { "UIView \(ObjectIdentifier($0).hashValue); frame=\($0.frame)" } ?? "Not attached")
        put("ImaAdsManager.adCuePoints", playerCallbackJournal.adsManager.map { String(describing: $0.adCuePoints) } ?? "No current IMA ads manager")
        put("SubtitleTrackController.manualCues", "\(apiObjects.enteredCues.count) retained cues on the current source")
        put("FairplayLicenseAcquiredEvent.retainedRequests", apiObjects.acquiredLicenses.enumerated().filter { $0.element.source === player.source }.map { "\($0.offset): actual current-source request; URL and key data omitted" }.joined(separator: "\n"))
        put("CueParsedEvent.retainedCues", apiObjects.parsedCues.enumerated().map { "\($0.offset): \($0.element.startTime)–\($0.element.endTime)s; VTT=\($0.element.vtt != nil)" }.joined(separator: "\n"))
        put("Player.ads", "Active ad: \(player.ads.activeAd != nil); active break: \(player.ads.activeAdBreak != nil)")
        put("AdvertisingApi.activeAd", player.ads.activeAd == nil ? "None" : "Present")
        put("AdvertisingApi.activeAdBreak", player.ads.activeAdBreak == nil ? "None" : "Present")
        put("AdvertisingApi.schedule", "\(player.ads.schedule.count) ad items")
        put("Player.availableAudio", player.availableAudio.prefix(32).map { "\($0.identifier): \($0.label) [\($0.language ?? "und")]" }.joined(separator: "\n"))
        put("Player.availableSubtitles", player.availableSubtitles.prefix(32).map { "\($0.identifier): \($0.label) [\($0.language ?? "und")]" }.joined(separator: "\n"))
        put("SubtitleTrack.controller", player.availableSubtitles.prefix(32).map { "\($0.identifier): object \(ObjectIdentifier($0.controller).hashValue)" }.joined(separator: "\n"))
        let tracks: [Track] = player.availableAudio.map { $0 as Track } + player.availableSubtitles.map { $0 as Track }
        put("Track.type", tracks.prefix(64).map { "\($0.identifier): \($0.type)" }.joined(separator: "\n"))
        put("Player.audio", player.audio.map { "\($0.identifier): \($0.label)" } ?? "None")
        put("Player.subtitle", player.availableSubtitles.isEmpty ? "Off / unavailable" : player.subtitle.label)
        put("Player.availableVideoQualities", player.availableVideoQualities.prefix(32).map(Self.qualityText).joined(separator: "\n"))
        put("Player.videoPlaybackQuality", player.videoPlaybackQuality.map(Self.qualityText) ?? "Unavailable")
        put("Player.videoDownloadQuality", player.videoDownloadQuality.map(Self.qualityText) ?? "Unavailable")
        put("Player.videoQuality", player.videoQuality.map(Self.qualityText) ?? "Unavailable (deprecated getter)")
        if let source = player.source {
            put("Player.source", source.sourceConfig.title ?? "Untitled")
            put("Source.sourceConfig", "type=\(source.sourceConfig.type); title=\(source.sourceConfig.title ?? "")")
            put("Source.isAttachedToPlayer", String(source.isAttachedToPlayer))
            put("Source.isActive", String(source.isActive))
            put("Source.duration", "\(source.duration) seconds")
            put("Source.loadingState", String(describing: source.loadingState))
            put("Source.metadata", "\(source.metadata?.count ?? 0) keys; values are not exported")
            #if os(tvOS)
            put("Source.markers", source.markers.enumerated().map { "\($0.offset): time=\($0.element.time); duration=\($0.element.duration)" }.joined(separator: "\n"))
            #endif
            put("Source.events", "Object \(ObjectIdentifier(source.events).hashValue); typed listener recording: \(apiEventsEnabled)")
            put("Source.drm", "Object \(ObjectIdentifier(source.drm).hashValue)")
            put("SourceDrmApi.fairplay", "Object \(ObjectIdentifier(source.drm.fairplay).hashValue); license data is not displayed")
            put("Source.latency", "Recommended latency: \(source.latency.recommendedLatency) seconds")
            put("SourceLatencyApi.recommendedLatency", "\(source.latency.recommendedLatency) seconds")
            put("SourceLatencyApi.automaticallyPreservesLatency", String(source.latency.automaticallyPreservesLatency))
        } else { put("Player.source", "None") }
        if let view = apiPlayerView, view.player === player {
            put("PlayerView.player", "Current player generation")
            put("PlayerView.fullscreenHandler", view.fullscreenHandler == nil ? "Unavailable" : "App-owned fullscreen handler")
            put("FullscreenHandler.isFullscreen", String(view.fullscreenHandler?.isFullscreen ?? false))
            put("UserInterfaceApi.isFullscreenAvailable", String(view.isFullscreenAvailable))
            put("UserInterfaceApi.isFullscreen", String(view.isFullscreen))
            put("UserInterfaceApi.areControlsShown", String(view.areControlsShown))
            put("UserInterfaceApi.isPictureInPictureAvailable", String(view.isPictureInPictureAvailable))
            put("UserInterfaceApi.isPictureInPicture", String(view.isPictureInPicture))
            put("UserInterfaceApi.scalingMode", String(describing: view.scalingMode))
            put("PlayerView.pictureInPicture", "Enabled: \(view.pictureInPicture.isEnabled)")
            put("PlayerView.systemUi", view.systemUi.map { "Object \(ObjectIdentifier($0).hashValue)" } ?? "Not active for the current UI type")
            #if os(tvOS)
            if let ui = view.systemUi {
                put("SystemUiApi.transportBarCustomMenuItems", ui.transportBarCustomMenuItems.map(\.title).joined(separator: ", "))
                put("SystemUiApi.contextualActions", ui.contextualActions.map(\.title).joined(separator: ", "))
                put("SystemUiApi.infoViewActions", ui.infoViewActions.map(\.title).joined(separator: ", "))
                put("SystemUiApi.customInfoViewControllers", ui.customInfoViewControllers.map { $0.title ?? "Untitled" }.joined(separator: ", "))
            }
            #endif
            put("PlayerView.events", "Object \(ObjectIdentifier(view.events).hashValue); typed listener recording: \(apiEventsEnabled)")
            put("PlayerView.contentOverlay", "Object \(ObjectIdentifier(view.contentOverlay).hashValue)")
            put("ContentOverlayApi.view", "UIView \(ObjectIdentifier(view.contentOverlay.view).hashValue); frame=\(view.contentOverlay.view.frame)")
            put("PlayerView.tweaks", "Object \(ObjectIdentifier(view.tweaks).hashValue)")
            #if !os(tvOS)
            put("PictureInPictureApi.showSkipControls", String(view.pictureInPicture.showSkipControls))
            put("PlayerViewTweaksApi.hidePlaybackControlsInPictureInPicture", String(view.tweaks.hidePlaybackControlsInPictureInPicture))
            #endif
            #if !os(tvOS)
            put("PlayerView.videoBounds", String(describing: view.videoBounds))
            #endif
        }
        for item in playerCallbackJournal.snapshot { put("Callback.Player." + item.id, item.value) }
        for item in sourceCallbackJournal.snapshot { put("Callback.Source." + item.id, item.value) }
        setApiState(rows)
    }

    private static func qualityText(_ quality: VideoQuality) -> String {
        "\(quality.identifier): \(quality.width)×\(quality.height), \(quality.bitrate) bit/s"
    }
}
