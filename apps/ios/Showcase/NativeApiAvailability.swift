import Foundation
import BitmovinPlayer
import PlaybackCore

/// Point-in-time capabilities from public Apple SDK objects, never source URL heuristics.
struct NativeApiContext {
    var playback = PlaybackCommandState()
    var hasConfiguredSource = false
    var hasSource = false
    var audioIDs = Set<String>()
    var subtitleIDs = Set<String>()
    var enteredCueIDs = Set<String>()
    var hasFairplay = false
    var fairplayRequestIndices = Set<Int>()
    var hasView = false
    var fullscreenAvailable = false
    var fullscreenActive = false
    var pipAvailable = false
    var pipActive = false
    var hasImaManager = false
    var activeAdIsIma = false
    var hasInterstitialRegistry = false
    var hasWebMessageHandler = false
    var castAvailable = false
    var castActive = false
    var playlistSourceCount = 0
    var ownedSuspensionIndices = Set<Int>()

    /// Catalog queries omit arguments; dispatch checks the exact entered identifiers and ranges.
    func rejection(for operation: ApiOperation, arguments: [String: String]? = nil) -> String? {
        if operation == .destroyAndRecreate { return nil }
        if playback.playerDestroyed { return PlaybackCommandState.Rejection.createPlayer.rawValue }
        let value = arguments?["value"] ?? ""
        switch operation {
        case .reload, .loadConfig:
            return hasConfiguredSource ? nil : "Apply source settings first."
        case .unload:
            return hasSource ? nil : "Load a source first."
        case .play, .pause, .speed, .canPlay, .bitrate, .bufferLevel:
            return playback.rejection(for: .playback)?.rawValue
        case .seek:
            return playback.rejection(for: .seek, value: arguments.flatMap { Double($0["value"] ?? "") })?.rawValue
        case .timeShift:
            return playback.rejection(for: .timeShift, value: arguments.flatMap { Double($0["value"] ?? "") })?.rawValue
        case .sourceLatency:
            return playback.rejection(for: .liveLatency)?.rawValue
        case .audio, .subtitle, .removeSubtitle, .cueEnter, .cueExit:
            // Clearing subtitles is a recovery action even when the new source has no tracks.
            if operation == .subtitle && (arguments == nil || value.isEmpty) { return nil }
            if let reason = playback.rejection(for: .playback) { return reason.rawValue }
            let ids = operation == .audio ? audioIDs : operation == .cueExit ? enteredCueIDs : subtitleIDs
            let id = operation == .cueEnter || operation == .cueExit ? arguments?["track"] : arguments?["value"]
            return ids.isEmpty || id.map({ !ids.contains($0) }) == true ? "Choose an existing track on the current source." : nil
        case .sourceMetadata:
            return hasSource ? nil : "Load a source first."
        case .renewFairplay:
            if let reason = playback.rejection(for: .playback) { return reason.rawValue }
            let index = arguments.flatMap { Int($0["index"] ?? "") }
            return !hasFairplay || fairplayRequestIndices.isEmpty || index.map({ !fairplayRequestIndices.contains($0) }) == true ? "Wait for an acquired FairPlay request on the current source." : nil
        case .sourceThumbnail, .legacyThumbnail, .thumbnail, .renderThumbnail, .subtitleAdd:
            return playback.rejection(for: .playback)?.rawValue
        case .renderSourceThumbnail:
            let index = arguments.flatMap { Int($0["index"] ?? "") }
            return playlistSourceCount == 0 || index.map({ !(0..<playlistSourceCount).contains($0) }) == true ? "Choose an existing SDK playlist source index." : nil
        case .playerAdSchedule, .advertisingSchedule:
            return playback.rejection(for: .adSchedule)?.rawValue
        case .playerAdSkip, .advertisingSkip:
            return playback.rejection(for: .adSkip)?.rawValue
        case .imaClicked, .imaDiscard:
            return playback.linearAdActive && activeAdIsIma && hasImaManager ? nil : "Wait for an active IMA ad and its current ads manager."
        case .enterFullscreen, .exitFullscreen, .enterPiP, .exitPiP, .viewScaling,
             .enablePiP, .rotateView, .layoutView, .viewSubtitleStyles, .posterImage,
             .playerAdContainer, .advertisingContainer:
            guard hasView else { return "Enable the native PlayerView host before invoking a view API." }
            if operation == .enterFullscreen && !fullscreenAvailable { return "Fullscreen is unavailable on the current player view." }
            if operation == .exitFullscreen && !fullscreenActive { return "Enter fullscreen first." }
            if operation == .enterPiP && !pipAvailable { return "Picture in Picture is unavailable on the current player view." }
            if operation == .exitPiP && !pipActive { return "Enter Picture in Picture first." }
            return nil
        case .trackingRegister, .trackingRegisterMultiple, .trackingQuery:
            return hasSource && hasInterstitialRegistry ? nil : "Wait for an SDK interstitial mapping registry on the current source."
        case .sharePlayEnd, .sharePlayEndAt:
            let index = arguments.flatMap { Int($0["index"] ?? "") }
            return ownedSuspensionIndices.isEmpty || index.map({ !ownedSuspensionIndices.contains($0) }) == true ? "Begin a SharePlay suspension on the current player first." : nil
        case .remoteConfigPreview:
            return hasConfiguredSource || hasSource ? nil : "Apply source settings first."
        case .cast:
            return castAvailable ? nil : "Enable casting and wait for an available cast target."
        case .stopCast:
            return castActive ? nil : "Start a cast session first."
        #if os(tvOS)
        case .allowsAirPlay, .airPlayPicker:
            return "This AirPlay control is unavailable on tvOS."
        case .tvMenu, .tvContextActions, .tvInfoActions, .tvInfoControllers:
            return hasView ? nil : "Enable the native PlayerView host before invoking a view API."
        case .tvMarkers:
            return hasSource ? nil : "Load a source first."
        #else
        case .messageSend, .messageSendWithData:
            return hasWebMessageHandler ? nil : "Enable BitmovinUserInterfaceConfig.customMessageHandler and apply the player configuration first."
        case .pipSkipControls, .hidePiPControls:
            return hasView ? nil : "Enable the native PlayerView host before invoking a view API."
        #endif
        default: return nil
        }
    }
}

extension PlayerModel {
    @MainActor
    func apiContext() -> NativeApiContext {
        var context = NativeApiContext()
        let player = self.player
        context.playback.playerDestroyed = player.isDestroyed
        context.hasConfiguredSource = sourceSettings != nil
        guard !player.isDestroyed else { return context }
        let source = player.source
        context.hasSource = source != nil
        if let source {
            context.playback.source = apiSession.playerFailed || apiSession.failedSource === source ? .failed
                : source.loadingState == .loaded && (apiSession.readySource === source || player.isPlaying || player.isPaused) ? .ready : .loading
        }
        context.playback.live = player.isLive && !(player.duration.isFinite && player.duration > 0)
        context.playback.finalizedLive = !dvr.isLive && context.playback.live
        context.playback.duration = player.duration
        context.playback.maxTimeShift = player.maxTimeShift
        context.playback.rewindEnabled = timeShiftEnabled
        context.playback.sdkTimeShiftEnabled = playerSettings.sdkTimeShiftEnabled
        let activeAd = player.ads.activeAd
        context.playback.linearAdActive = player.isAd || activeAd?.isLinear == true
        if let activeAd, apiSession.activeAd === activeAd {
            context.playback.adSkippableAfter = (activeAd as? LinearAd)?.skippableAfter ?? .nan
            context.playback.adPosition = apiSession.adPosition
            context.activeAdIsIma = apiSession.adClientType == .ima
        }
        #if !os(tvOS)
        context.playback.programmaticAdSkipSupported = !context.activeAdIsIma || player.config.advertisingConfig.ima.preferredUiType == .disabled
        context.hasWebMessageHandler = playerCallbackJournal.messageHandler != nil
        context.castAvailable = player.config.remoteControlConfig.isCastEnabled && player.isCastAvailable
        #endif
        context.castActive = player.isCasting || player.isWaitingForDevice
        context.audioIDs = Set(player.availableAudio.map(\.identifier))
        context.subtitleIDs = Set(player.availableSubtitles.map(\.identifier))
        context.enteredCueIDs = Set(apiObjects.enteredCues.filter { $0.value.source === source }.keys)
        context.hasFairplay = source?.sourceConfig.drmConfig is FairplayConfig
        context.fairplayRequestIndices = Set(apiObjects.acquiredLicenses.enumerated().filter { $0.element.source === source }.map(\.offset))
        context.hasImaManager = playerCallbackJournal.adsManager != nil
        context.hasInterstitialRegistry = playerCallbackJournal.interstitialRegistry != nil
        context.playlistSourceCount = player.playlist.sources.count
        context.ownedSuspensionIndices = Set(apiObjects.sharePlaySuspensions.enumerated().filter { $0.element.player === player }.map(\.offset))
        if let view = apiPlayerView, view.player === player {
            context.hasView = true
            context.fullscreenAvailable = view.isFullscreenAvailable
            context.fullscreenActive = view.isFullscreen
            context.pipAvailable = view.isPictureInPictureAvailable
            context.pipActive = view.isPictureInPicture
        }
        return context
    }
}

/// Always subscribed; optional event-log recording never owns command eligibility.
final class NativeApiSession: NSObject, PlayerListener, SourceListener {
    weak var readySource: Source?
    weak var failedSource: Source?
    var playerFailed = false
    weak var activeAd: Ad?
    var adClientType: AdSourceType?
    var adPosition: TimeInterval = .nan
    private weak var model: PlayerModel?
    private weak var owner: Player?
    private weak var observedSource: Source?

    init(model: PlayerModel, player: Player) { self.model = model; owner = player }
    func reset() { readySource = nil; failedSource = nil; playerFailed = false; activeAd = nil; adClientType = nil; adPosition = .nan }
    func bind(to source: Source?) {
        guard observedSource !== source else { return }
        observedSource?.remove(listener: self)
        observedSource = source
        source?.add(listener: self)
    }

    private func update(_ player: Player, source: Source?, _ change: @escaping (NativeApiSession) -> Void) {
        DispatchQueue.main.async { [weak self, weak player, weak source] in
            guard let self, let player, self.owner === player, let model = self.model, model.player === player,
                  player.source === source else { return }
            change(self)
            model.refreshApiAvailability()
        }
    }
    func onReady(_ event: ReadyEvent, player: Player) {
        let source = player.source
        update(player, source: source) { $0.readySource = source; $0.failedSource = nil }
    }
    func onSourceLoad(_ event: SourceLoadEvent, player: Player) {
        update(player, source: event.source) { $0.reset(); $0.bind(to: event.source) }
    }
    func onSourceError(_ event: SourceErrorEvent, source: Source) {
        guard let player = owner else { return }
        update(player, source: source) { if $0.observedSource === source { $0.failedSource = source } }
    }
    func onPlayerError(_ event: PlayerErrorEvent, player: Player) {
        update(player, source: player.source) { $0.playerFailed = true }
    }
    func onAdStarted(_ event: AdStartedEvent, player: Player) {
        update(player, source: player.source) { $0.activeAd = event.ad; $0.adClientType = event.clientType; $0.adPosition = 0 }
    }
    func onTimeChanged(_ event: TimeChangedEvent, player: Player) {
        let ad = player.ads.activeAd
        update(player, source: player.source) { state in
            if let ad, state.activeAd === ad { state.adPosition = event.currentTime }
        }
    }
    func onAdFinished(_ event: AdFinishedEvent, player: Player) { finishAd(event.ad, player: player) }
    func onAdSkipped(_ event: AdSkippedEvent, player: Player) { finishAd(event.ad, player: player) }
    func onAdBreakFinished(_ event: AdBreakFinishedEvent, player: Player) {
        update(player, source: player.source) { $0.activeAd = nil; $0.adClientType = nil; $0.adPosition = .nan }
    }
    private func finishAd(_ ad: Ad, player: Player) {
        update(player, source: player.source) { if $0.activeAd === ad { $0.activeAd = nil; $0.adClientType = nil; $0.adPosition = .nan } }
    }
}
