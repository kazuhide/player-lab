import Foundation
import Combine
import BitmovinPlayer
import DvrKit

/// Which UI renders over the player. `default` is the SDK's own Web UI; the rest load our shared
/// `@showcase/ui-shared` bundle (bundled as an app resource — see scripts/sync-webui-bundle.sh)
/// and select one of its custom factories by name, demonstrating the §12 "build the UI once, reuse
/// it across web-capable targets" story. iOS renders the player UI as a Web UI, so the same bundle
/// the web app uses runs here unchanged. (Not applicable on tvOS — it uses the native System UI.)
enum UiMode: String, CaseIterable, Identifiable {
    case `default` = "Default"
    case sports = "Sports"
    case live = "Live (DVR)"
    case cinema = "Cinema"

    var id: String { rawValue }

    /// The `bitmovin.playerui.UIFactory.*` function the Web UI harness calls, or `nil` for the
    /// SDK default UI.
    var factoryFunction: String? {
        switch self {
        case .default: return nil
        case .sports: return "bitmovin.playerui.UIFactory.buildSportsUI"
        case .live: return "bitmovin.playerui.UIFactory.buildLiveUI"
        case .cinema: return "bitmovin.playerui.UIFactory.buildCinemaUI"
        }
    }
}

/// Wraps the Bitmovin Player and exposes DVR state (via `DvrKit`) to SwiftUI. The
/// DVR coordinate logic lives in `DvrKit`; this is the thin platform glue.
///
/// The Bitmovin SDK usage below (event classes, config properties, `events.on`)
/// type-checks against the SDK pinned in project.yml. CI builds the app for the
/// simulator; device playback needs a licensed app identifier.
final class PlayerModel: ObservableObject {
    /// The UI is fixed at player-creation time (it lives on `PlayerConfig.styleConfig`), so
    /// switching the factory recreates the player; SwiftUI rebuilds the view for each generation.
    @Published private(set) var player: Player
    @Published private(set) var uiMode: UiMode = .default
    @Published private(set) var playerGeneration = UUID()
    @Published private(set) var sourceSettings: SourceSettings?
    @Published private(set) var playerSettings = PlayerSettings()
    @Published private(set) var configurationStatus = "Startup defaults active"
    @Published private(set) var trackStatus = PlaybackTrackStatus()

    var configurationDraft: ConfigurationDraft {
        ConfigurationDraft(source: sourceSettings, player: playerSettings)
    }

    @Published private(set) var dvr: DvrState = Dvr.deriveState(
        PlayerSnapshot(isLive: false, duration: 0, maxTimeShift: 0, timeShift: 0, currentTime: 0),
        config: DvrConfig(timeShiftEnabled: true)
    )
    @Published private(set) var log: [String] = []
    @Published var timeShiftEnabled = true {
        didSet { refresh() }
    }

    private let licenseKey: String
    private let analyticsLicenseKey: String
    private var cancellables = Set<AnyCancellable>()
    private var sourceCompletionCancellables = Set<AnyCancellable>()
    private weak var completionSource: Source?
    private var liveSourceFinalized = false
    private var lastSnapshot: PlayerSnapshot?
    private var initialTrackSelection = InitialTrackSelectionGate()

    init(licenseKey: String, analyticsLicenseKey: String = "") {
        self.licenseKey = licenseKey
        self.analyticsLicenseKey = analyticsLicenseKey
        player = PlayerModel.makePlayer(
            licenseKey: licenseKey, analyticsLicenseKey: analyticsLicenseKey,
            uiMode: .default, settings: PlayerSettings())
        bindEvents()
    }

    /// Switch the player UI. Recreates the player (the UI is creation-time config), re-binds
    /// events, and reloads the current source so playback continues under the new UI.
    func setUiMode(_ mode: UiMode) {
        guard mode != uiMode else { return }
        uiMode = mode
        recreatePlayer()
        append("UI → \(mode.rawValue)")
    }

    func effect(for configuration: ValidatedConfiguration) -> ConfigurationEffect {
        if configuration.player != playerSettings { return .recreatePlayer }
        if configuration.source != sourceSettings { return .reloadSource }
        return .none
    }

    /// Validation completes before touching either the active source or player.
    @discardableResult
    func apply(_ draft: ConfigurationDraft) throws -> ConfigurationEffect {
        let configuration = try draft.validated()
        let effect = effect(for: configuration)
        guard effect != .none else { return .none }
        sourceSettings = configuration.source
        playerSettings = configuration.player
        switch effect {
        case .recreatePlayer: recreatePlayer()
        case .reloadSource: reloadCurrentSource()
        case .none: break
        }
        configurationStatus = effect.description
        append(effect.description)
        return effect
    }

    private func recreatePlayer() {
        let previous = player
        cancellables.removeAll()
        resetSourceCompletion()
        initialTrackSelection.retire()
        lastSnapshot = nil
        let next = PlayerModel.makePlayer(
            licenseKey: licenseKey, analyticsLicenseKey: analyticsLicenseKey,
            uiMode: uiMode, settings: playerSettings)
        player = next
        playerGeneration = UUID()
        bindEvents()
        reloadCurrentSource()
        refresh()
        previous.destroy()
    }

    private static func makePlayer(
        licenseKey: String, analyticsLicenseKey: String, uiMode: UiMode, settings: PlayerSettings
    ) -> Player {
        let config = PlayerConfig()
        config.key = licenseKey
        settings.apply(to: config)
        #if os(tvOS)
        // tvOS: native System UI — the Web UI is unavailable here (§12).
        config.styleConfig.userInterfaceType = .system
        #else
        // iOS: for a custom mode, point the Web UI at our shared bundle and select the factory.
        // `default` (or a missing bundle) leaves the SDK's built-in Web UI in place.
        if let factory = uiMode.factoryFunction,
           let js = Bundle.main.url(forResource: "bitmovinplayer-ui", withExtension: "js"),
           let css = Bundle.main.url(forResource: "bitmovinplayer-ui", withExtension: "css") {
            config.styleConfig.playerUiJs = js
            config.styleConfig.playerUiCss = css
            let uiConfig = BitmovinUserInterfaceConfig()
            uiConfig.uiManagerFactoryFunction = factory
            config.styleConfig.userInterfaceConfig = uiConfig
        }
        #endif
        // §15: the bundled analytics collector reports QoE to the Bitmovin dashboard
        // when a key is configured (repo-root .env → sync-env.sh → Local.xcconfig).
        guard !analyticsLicenseKey.isEmpty else {
            return PlayerFactory.createPlayer(playerConfig: config)
        }
        return PlayerFactory.createPlayer(
            playerConfig: config,
            analytics: .enabled(analyticsConfig: AnalyticsConfig(licenseKey: analyticsLicenseKey))
        )
    }

    func load(_ source: ShowcaseSource) {
        sourceSettings = SourceSettings(source)
        append("load \(source.label)")
        reloadCurrentSource()
    }

    func loadInitialSource() {
        guard sourceSettings == nil, let first = Sources.all.first else { return }
        load(first)
    }

    private func reloadCurrentSource() {
        guard let sourceSettings else { return }
        resetSourceCompletion()
        initialTrackSelection.retire()
        trackStatus = PlaybackTrackStatus()
        let source = SourceFactory.createSource(from: sourceSettings.makeSourceConfig())
        // Bind the intended source before load: an older queued event can arrive
        // while the SDK still reports the old current source.
        initialTrackSelection.bind(source)
        player.load(source: source)
    }

    func goToLiveEdge() {
        guard !liveSourceFinalized else { return }
        player.timeShift = 0
    }

    /// Inline tvOS System UI does not expose AVKit's fullscreen transport controls.
    func togglePlayback() {
        let player = self.player
        guard !player.isDestroyed, player.source != nil else { return }
        if player.isPlaying { player.pause() }
        else { player.play() }
    }

    /// Seek to an offset relative to the live edge (timeShift semantics), clamped.
    func seek(toOffsetFromEdge offset: TimeInterval) {
        guard !liveSourceFinalized else { return }
        guard timeShiftEnabled && playerSettings.sdkTimeShiftEnabled else {
            player.timeShift = 0
            return
        }
        player.timeShift = Dvr.clampToWindow(offset, maxTimeShift: player.maxTimeShift)
    }

    // MARK: - internals

    private func snapshot() -> PlayerSnapshot {
        PlayerSnapshot(
            isLive: player.isLive,
            duration: player.duration,
            maxTimeShift: player.maxTimeShift,
            timeShift: player.timeShift,
            currentTime: player.currentTime,
            liveSourceFinalized: liveSourceFinalized
        )
    }

    private func refresh() {
        let snap = snapshot()
        // §9: iOS can miss DurationChanged on live→VOD, so detect it from the
        // snapshot poll driven by TimeChanged.
        if let prev = lastSnapshot, Dvr.detectLiveToVod(prev: prev, next: snap) {
            append("live→VOD detected (poll)")
        }
        lastSnapshot = snap
        dvr = Dvr.deriveState(snap, config: DvrConfig(
            timeShiftEnabled: timeShiftEnabled && playerSettings.sdkTimeShiftEnabled))
        if let source = player.source, completionSource === source {
            let audio = player.audio
            let subtitle = player.availableSubtitles.isEmpty ? nil : player.subtitle
            trackStatus = PlaybackTrackStatus(
                audio: audio.map { "\($0.label) [\($0.language ?? "und")]" } ?? "Not available",
                subtitles: subtitle.map { track in
                    track.label + (track.language.map { " [\($0)]" } ?? "")
                } ?? "Off",
                position: snap.currentTime.isFinite ? snap.currentTime : 0)
        }
    }

    private func append(_ message: String) {
        log.insert(message, at: 0)
        if log.count > 80 { log.removeLast() }
    }

    private func resetSourceCompletion() {
        sourceCompletionCancellables.removeAll()
        completionSource = nil
        liveSourceFinalized = false
    }

    private func bindSourceCompletion(_ player: Player) {
        guard let source = player.source else { return }
        resetSourceCompletion()
        completionSource = source
        let loadedAsLive = player.isLive
        player.events.on(PlaybackFinishedEvent.self)
            .receive(on: DispatchQueue.main)
            .sink { [weak self, weak player, weak source] _ in
                guard let self, let player, let source,
                      self.player === player, self.completionSource === source,
                      player.source === source else { return }
                // Some ended HLS streams keep the native live/infinite getters.
                // Completion is authoritative; retain this source fact across replay.
                if loadedAsLive { self.liveSourceFinalized = true }
                self.append("PlaybackFinished")
                self.refresh()
            }
            .store(in: &sourceCompletionCancellables)
    }

    private func bindEvents() {
        // Bind against a local (not the @Published `player` property): repeated property-wrapper
        // access across these four Combine chains pushes the Swift type-checker past its
        // per-expression budget ("cannot infer closure parameter type" cascade).
        let player = self.player
        player.events.on(TimeChangedEvent.self)
            .receive(on: DispatchQueue.main)
            .sink { [weak self, weak player] _ in
                guard let self, let player, self.player === player else { return }
                self.refresh()
            }
            .store(in: &cancellables)
        player.events.on(SourceLoadedEvent.self)
            .receive(on: DispatchQueue.main)
            .sink { [weak self, weak player] event in
                guard let self, let player, self.player === player,
                      self.initialTrackSelection.owns(event.source),
                      player.source === event.source else { return }
                self.bindSourceCompletion(player)
                self.append("SourceLoaded"); self.refresh()
            }
            .store(in: &cancellables)
        player.events.on(ReadyEvent.self)
            // Ready has no Source payload. Capture the emitting player's source
            // before scheduling, so a retired Ready cannot select on a new load.
            .compactMap { [weak player] _ in player?.source }
            .receive(on: DispatchQueue.main)
            .sink { [weak self, weak player] source in
                guard let self, let player, self.player === player,
                      self.completionSource === source, player.source === source else { return }
                self.applyInitialTracks(player, source: source)
                self.refresh()
            }
            .store(in: &cancellables)
        player.events.on(AudioChangedEvent.self)
            .receive(on: DispatchQueue.main)
            .sink { [weak self, weak player] _ in
                guard let self, let player, self.player === player else { return }
                self.refresh()
            }
            .store(in: &cancellables)
        player.events.on(SubtitleChangedEvent.self)
            .receive(on: DispatchQueue.main)
            .sink { [weak self, weak player] _ in
                guard let self, let player, self.player === player else { return }
                self.refresh()
            }
            .store(in: &cancellables)
        player.events.on(TimeShiftedEvent.self)
            .receive(on: DispatchQueue.main)
            .sink { [weak self, weak player] _ in
                guard let self, let player, self.player === player else { return }
                self.append("TimeShifted"); self.refresh()
            }
            .store(in: &cancellables)
        // §5.3: recover from DVRWindowExceeded by snapping to the live edge.
        player.events.on(DvrWindowExceededEvent.self)
            .receive(on: DispatchQueue.main)
            .sink { [weak self, weak player] _ in
                guard let self, let player, self.player === player,
                      !self.liveSourceFinalized else { return }
                self.append("DVRWindowExceeded → recover")
                player.timeShift = 0
            }
            .store(in: &cancellables)
    }

    private func applyInitialTracks(_ player: Player, source: Source) {
        guard let preferences = sourceSettings?.initialTracks,
              let current = player.source else { return }
        guard initialTrackSelection.claim(eventSource: source, currentSource: current) else { return }
        // Select once at initial Ready: the tested 3.128 HLS startup restored its
        // default audio between SourceLoaded and Ready. Later UI choices stay intact.
        switch preferences.subtitleMode {
        case .automatic: break
        case .off: player.setSubtitle(trackIdentifier: nil)
        case .language:
            if let language = preferences.subtitleLanguage,
               let identifier = InitialTrackPreferences.matchingIdentifier(language,
                tracks: player.availableSubtitles.map { ($0.identifier, $0.language) }) {
                player.setSubtitle(trackIdentifier: identifier)
            } else { append("Initial subtitle language unavailable; kept SDK choice") }
        }
        if let language = preferences.audioLanguage {
            if let identifier = InitialTrackPreferences.matchingIdentifier(language,
                tracks: player.availableAudio.map { ($0.identifier, $0.language) }) {
                player.setAudio(trackIdentifier: identifier)
            } else { append("Initial audio language unavailable; kept SDK choice") }
        }
    }
}
