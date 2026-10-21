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
        func put(_ id: String, _ value: String) { rows.append(.init(id: id, value: value)) }
        put("PlayerFactory.sdkVersion", PlayerFactory.sdkVersion)
        put("PlayerCoreFactory.sdkVersion", PlayerCoreFactory.sdkVersion)
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
        put("Player.thumbnails", "Rendering mode: \(player.thumbnails.renderingMode)")
        put("Player.ads", "Active ad: \(player.ads.activeAd != nil); active break: \(player.ads.activeAdBreak != nil)")
        put("AdvertisingApi.activeAd", player.ads.activeAd == nil ? "None" : "Present")
        put("AdvertisingApi.activeAdBreak", player.ads.activeAdBreak == nil ? "None" : "Present")
        put("AdvertisingApi.schedule", "\(player.ads.schedule.count) ad items")
        put("Player.availableAudio", player.availableAudio.prefix(32).map { "\($0.identifier): \($0.label) [\($0.language ?? "und")]" }.joined(separator: "\n"))
        put("Player.availableSubtitles", player.availableSubtitles.prefix(32).map { "\($0.identifier): \($0.label) [\($0.language ?? "und")]" }.joined(separator: "\n"))
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
            put("PlayerView.events", "Object \(ObjectIdentifier(view.events).hashValue); typed listener recording: \(apiEventsEnabled)")
            put("PlayerView.contentOverlay", "Object \(ObjectIdentifier(view.contentOverlay).hashValue)")
            #if !os(tvOS)
            put("PlayerView.videoBounds", String(describing: view.videoBounds))
            #endif
        }
        setApiState(rows)
    }

    private static func qualityText(_ quality: VideoQuality) -> String {
        "\(quality.identifier): \(quality.width)×\(quality.height), \(quality.bitrate) bit/s"
    }
}
