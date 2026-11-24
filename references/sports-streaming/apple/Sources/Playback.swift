import SwiftUI
import Combine
import BitmovinPlayer

/// Events are applied only to the player and source that own the current selection.
@MainActor
class Playback: NSObject, ObservableObject {
    @Published var player: Player?
    @Published var standardControls = true
    @Published var ready = false
    @Published var playing = false
    @Published var position: Double?
    @Published var captionText: String?
    @Published var problem: String?
    @Published var diagnostics: [String] = []
    private var subscriptions = Set<AnyCancellable>()
    var activeSource: Source?
    var desiredPlayback = true
    @Published var captionLanguage = ""
    @Published var speed: Float = 1

    func replacePlayer(learnerId: String? = nil) {
        if let player {
            subscriptions.removeAll()
            player.destroy()
        }
        resetSelection()
        player = Media.makePlayer(learnerId: learnerId)

    }

    func observe(_ player: Player) {
        subscriptions.removeAll()
        bind(player.events.on(ReadyEvent.self), player: player) { $0.onReady($1, player: $2) }
        bind(player.events.on(PlayingEvent.self), player: player) { $0.onPlaying($1, player: $2) }
        bind(player.events.on(PausedEvent.self), player: player) { $0.onPaused($1, player: $2) }
        bind(player.events.on(TimeChangedEvent.self), player: player) { $0.onTimeChanged($1, player: $2) }
        bind(player.events.on(PlayerErrorEvent.self), player: player) { $0.onPlayerError($1, player: $2) }
        bind(player.events.on(SourceErrorEvent.self), player: player) { $0.onSourceError($1, player: $2) }
        bind(player.events.on(CueEnterEvent.self), player: player) { $0.onCueEnter($1, player: $2) }
        bind(player.events.on(CueExitEvent.self), player: player) { $0.onCueExit($1, player: $2) }
        bind(player.events.on(PlaybackSpeedChangedEvent.self), player: player) { session, event, sender in
            if session.ready, session.owns(sender) { session.speed = event.to }
        }
        bind(player.events.on(SubtitleChangedEvent.self), player: player) { session, event, sender in
            if session.ready, session.owns(sender) {
                session.captionText = nil
                if let language = event.subtitleTrackNew?.language { session.captionLanguage = language }
                else if !sender.availableSubtitles.isEmpty { session.captionLanguage = "" }
            }
        }
        bind(player.events.on(SourceWarningEvent.self), player: player) { session, event, sender in
            guard session.owns(sender) else { return }
            let message = String(format: NSLocalizedString("Media warning (%@)", comment: ""), String(describing: event.code.rawValue))
            session.problem = message
            session.record(message)
        }
        bind(player.events.on(PlaybackFinishedEvent.self), player: player) { $0.onPlaybackFinished($1, player: $2) }
    }

    private func bind<E>(_ events: AnyPublisher<E, Never>, player: Player,
                         deliver: @escaping (Playback, E, Player) -> Void) {
        events.receive(on: DispatchQueue.main).sink { [weak self, weak player] event in
            guard let self, let player, player === self.player else { return }
            deliver(self, event, player)
        }.store(in: &subscriptions)
    }

    func onPlaybackFinished(_ event: PlaybackFinishedEvent, player: Player) {}

    func resetSelection() {
        subscriptions.removeAll()
        activeSource = nil
        ready = false
        playing = false
        position = nil
        captionText = nil
        problem = nil
    }

    func owns(_ sender: Player) -> Bool {
        sender === player && activeSource != nil && sender.source === activeSource
    }

    func record(_ label: String) {
        diagnostics.append(label)
        if diagnostics.count > 200 { diagnostics.removeFirst() }
    }

    func applyPreferences(_ sender: Player) {
        if sender.canPlay(atPlaybackSpeed: speed) { sender.playbackSpeed = speed }
        let track = sender.availableSubtitles.first { $0.language == captionLanguage }
        sender.setSubtitle(trackIdentifier: track?.identifier)
        captionText = nil
    }

    func seek(by delta: Double) {
        guard let player, ready, owns(player) else { return }
        if player.isLive {
            player.timeShift = min(0, max(player.maxTimeShift, player.timeShift + delta))
        } else if player.duration.isFinite, player.duration > 0 {
            player.seek(time: min(player.duration, max(0, player.currentTime + delta)))
        }
    }

    func onReady(_ event: ReadyEvent, player: Player) {
        guard owns(player) else { return }
        ready = true
        record("Ready")
        applyPreferences(player)
        prepared(player)
    }

    func prepared(_ player: Player) {
        if desiredPlayback { player.play() } else { player.pause() }
    }

    func onPlaying(_ event: PlayingEvent, player: Player) {
        guard owns(player) else { return }
        playing = true
        desiredPlayback = true
        record("Playing")
    }

    func onPaused(_ event: PausedEvent, player: Player) {
        guard owns(player), ready else { return }
        playing = false
        desiredPlayback = false
        record("Paused")
    }

    func onTimeChanged(_ event: TimeChangedEvent, player: Player) {
        guard ready, owns(player) else { return }
        let seconds = player.currentTime(.relativeTime)
        position = seconds.isFinite && seconds >= 0 ? seconds : nil
    }

    func onPlayerError(_ event: PlayerErrorEvent, player: Player) {
        guard player === self.player else { return }
        failed(String(format: NSLocalizedString("Player error (%@)", comment: ""), String(describing: event.errorCode)))
    }
    func onSourceError(_ event: SourceErrorEvent, player: Player) {
        guard owns(player) else { return }
        failed(String(format: NSLocalizedString("Media error (%@)", comment: ""), String(describing: event.errorCode)))
    }
    func failed(_ reason: String) {
        ready = false
        playing = false
        captionText = nil
        problem = reason
        record(reason)
    }
    func onCueEnter(_ event: CueEnterEvent, player: Player) {
        guard owns(player) else { return }
        captionText = event.text
    }
    func onCueExit(_ event: CueExitEvent, player: Player) {
        guard owns(player), event.text == captionText else { return }
        captionText = nil
    }
}
