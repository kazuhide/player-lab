import SwiftUI
import BitmovinPlayer
import Combine
import AVFAudio

@MainActor
final class SportsSession: Playback {
    @Published var catalog: EventCatalog?
    @Published var event: Event?
    @Published var update: EventUpdate?
    @Published var asset: SportAsset?
    @Published var archiveTargetID: String? { didSet { maybeContinue() } }
    var targetArchive: SportAsset? {
        guard let event else { return nil }
        return catalog?.archive(for: event, selectedID: archiveTargetID)
    }
    @Published var autoContinue = false { didSet { maybeContinue() } }
    @Published var statusError = false
    @Published private(set) var readinessRetriesExhausted = false
    @Published var notice: String?
    private(set) var handoffs = HandoffLedger()
    private var pendingHandoff: UUID?
    private struct ArchiveSeek {
        let target: Double
        let issued: TimeInterval
        var started = false
    }
    private var positioning: ArchiveSeek?
    private var established = false
    private let seekArchive: (Player, Double) -> Void
    private var observation: Task<Void, Never>?
    private var seekSubscriptions = Set<AnyCancellable>()
    private var positionChanges: AnyCancellable?

    private func stopObservation() {
        seekSubscriptions.removeAll()
        observation?.cancel()
        observation = nil
        positioning = nil
        pendingHandoff = nil
    }

    private var onLocalRoute: Bool {
        #if os(iOS)
        return !AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .airPlay }
        #else
        return true
        #endif
    }

    private var clock = PresentationClock()
    private var generation = UUID()
    private struct OpenRequest {
        let asset: SportAsset
        let seek: Double?
        let play: Bool
        let restoreUTC: Double?
        let archiveHandoff: Bool
    }
    private var currentRequest: OpenRequest?
    private var pendingSeek: Double?
    private var savedLive: (utc: Double, play: Bool)?
    private var returnToUTC: Double?
    var canReturn: Bool {
        guard !statusError, status == "live", let utc = savedLive?.utc, let start = update?.seekableUtcStartMs,
              let end = update?.seekableUtcEndMs, start <= end else { return false }
        return (start..<end).contains(utc)
    }
    var statusPollingFinished: Bool { readinessRetriesExhausted || (!statusError && update?.pollingFinished == true) }
    var status: String? { update?.status ?? event?.status }
    var archiveReady: Bool { (update?.archiveStatus ?? event?.archiveStatus) == "ready" }
    var assets: [SportAsset] { catalog?.assets.filter { $0.eventId == event?.id } ?? [] }

    init(seekArchive: @escaping (Player, Double) -> Void = { $0.seek(time: $1) }) {
        self.seekArchive = seekArchive
        super.init()
        replacePlayer()
    }

    func fetchCatalog() async {
        do {
            let result = try await Media.fetch("catalog.json", as: EventCatalog.self)
            guard let first = result.events.first else { throw URLError(.cannotDecodeContentData) }
            catalog = result
            chooseEvent(first)
        } catch { problem = "Event catalog unavailable." }
    }

    func chooseEvent(_ next: Event) {
        stopObservation()
        positionChanges = nil
        resetSelection()
        player?.unload()
        generation = UUID()
        event = next
        update = nil
        asset = nil
        archiveTargetID = next.archiveAssetId
        savedLive = nil
        currentRequest = nil
        established = false
        returnToUTC = nil
        pendingSeek = nil
        notice = nil
        statusError = false
        readinessRetriesExhausted = false
    }

    func poll(fetch: (String) async throws -> EventUpdate = { try await Media.fetch($0, as: EventUpdate.self) },
              interval: UInt64 = 2_000_000_000,
              endedRetryDelays: [UInt64] = [2_000_000_000, 5_000_000_000, 10_000_000_000]) async {
        guard let event, let path = event.statusUrl else { return }
        let token = generation
        readinessRetriesExhausted = false
        var endedAttempt = 0
        while !Task.isCancelled && token == generation {
            do {
                let fresh = try await fetch(path)
                guard !Task.isCancelled, token == generation else { return }
                guard fresh.applies(to: event) else { throw URLError(.cannotDecodeContentData) }
                update = fresh
                statusError = false
                _ = utc()
                maybeContinue()
                if fresh.pollingFinished { return }
            } catch { if !Task.isCancelled && token == generation { statusError = true } }
            var delay = interval
            if status == "ended" {
                guard endedAttempt < endedRetryDelays.count else {
                    readinessRetriesExhausted = true
                    return
                }
                delay = endedRetryDelays[endedAttempt]
                endedAttempt += 1
            }
            do { try await Task.sleep(nanoseconds: delay) } catch { return }
        }
    }

    func utc() -> Double? {
        guard let player, ready, owns(player), asset?.kind == "live",
              let origin = update?.utcStartMs ?? asset?.utcStartMs else { return nil }
        return clock.read(absolute: player.currentTime(.absoluteTime), relative: player.currentTime(.relativeTime),
                          live: player.isLive, origin: origin, end: update?.presentationEndMs,
                          uptime: ProcessInfo.processInfo.systemUptime, speed: Double(player.playbackSpeed))
    }

    override func observe(_ player: Player) {
        super.observe(player)
        positionChanges = player.events.on(SeekedEvent.self).receive(on: DispatchQueue.main).sink { [weak self, weak player] _ in
            guard let self, let player, self.established, self.ready, self.owns(player) else { return }
            let seconds = player.currentTime(.relativeTime)
            if seconds.isFinite, seconds >= 0 { self.position = seconds }
        }
    }

    override func onTimeChanged(_ event: TimeChangedEvent, player: Player) {
        super.onTimeChanged(event, player: player)
        if owns(player), asset?.kind == "live" {
            _ = utc()
            maybeContinue()
        }
    }

    func mappedPosition(for archive: SportAsset) -> Double? {
        guard !statusError, archiveReady, archive.kind == "archive", archive.eventId == event?.id, let time = utc() else { return nil }
        if let fresh = update?.archiveMapping, fresh.assetId == archive.id { return fresh.position(for: time) }
        return ArchiveMap(assetId: archive.id, durationMs: archive.measuredDurationMs, utcStartMs: archive.utcStartMs,
                          utcMappings: archive.utcMappings).position(for: time)
    }

    private func maybeContinue() {
        if autoContinue, !isBackgrounded, status == "ended", asset?.kind == "live" { continueAtViewedPosition() }
    }

    override func setBackgrounded(_ backgrounded: Bool) {
        super.setBackgrounded(backgrounded)
        if backgrounded { pendingHandoff = nil } else { maybeContinue() }
    }

    func continueAtViewedPosition() {
        guard let archive = targetArchive, let seconds = mappedPosition(for: archive) else { return }
        open(archive, seek: seconds, play: desiredPlayback)
    }

    func canOpen(_ next: SportAsset) -> Bool {
        guard next.eventId == event?.id else { return false }
        switch next.kind {
        case "archive": return archiveReady
        case "live": return status == "live" || status == "ended"
        case "clip": return true
        default: return false
        }
    }

    func open(_ next: SportAsset, seek: Double? = nil, play: Bool = true, restoreUTC: Double? = nil) {
        guard player != nil, canOpen(next) else { return }
        if asset?.kind == "live", next.kind == "clip" {
            savedLive = utc().map { ($0, desiredPlayback) }
        }
        let handoff = asset?.kind == "live" && next.kind == "archive" && seek != nil
        load(OpenRequest(asset: next, seek: seek, play: play, restoreUTC: restoreUTC, archiveHandoff: handoff))
    }

    func retry() {
        guard problem != nil, let request = currentRequest, request.asset.id == asset?.id else { return }
        load(request)
    }

    private func load(_ request: OpenRequest) {
        let next = request.asset
        guard let player, canOpen(next), request.restoreUTC == nil || status == "live" else { return }
        stopObservation()
        if request.archiveHandoff, let seek = request.seek, onLocalRoute,
           seek.isFinite, seek >= 0, seek < Double(Int.max) / 1000 {
            pendingHandoff = handoffs.begin(eventId: next.eventId, videoId: next.videoId,
                                            positionMs: Int((seek * 1000).rounded()), play: request.play)
        }
        resetSelection()
        currentRequest = request
        established = false
        clock = PresentationClock()
        asset = next
        pendingSeek = request.seek
        returnToUTC = request.restoreUTC
        desiredPlayback = request.play
        notice = nil
        do {
            let captions = next.subtitleTracks.map { Caption(url: $0.url, language: $0.language, label: $0.label) }
            let source = try Media.source(path: next.streams.hls, title: next.title, videoId: next.videoId,
                                         captions: captions, isLive: next.kind == "live")
            activeSource = source
            observe(player)
            player.load(source: source)
        } catch { failed("Invalid event media address.") }
    }

    func backToLive(restore: Bool) {
        guard let live = assets.first(where: { $0.id == event?.liveAssetId }), status == "live" else { return }
        if restore {
            guard canReturn, let savedLive else { return }
            open(live, play: savedLive.play, restoreUTC: savedLive.utc)
        } else { open(live) }
    }

    override func prepared(_ player: Player) {
        guard problem == nil else { return }
        if let target = returnToUTC {
            returnToUTC = nil
            guard player.isLive, let current = utc() else {
                notice = "Previous live position unavailable. Choose Live edge to rejoin."
                player.pause()
                return
            }
            let offset = (target - current) / 1000 + player.timeShift
            guard (player.maxTimeShift...0).contains(offset) else {
                notice = "Previous position is outside the DVR window."
                player.pause()
                return
            }
            player.timeShift = offset
        }
        if let seconds = pendingSeek {
            pendingSeek = nil
            guard seconds >= 0, seconds < player.duration, let source = activeSource else {
                rejectPosition(player, mismatch: true)
                return
            }
            positionArchive(player, source: source, target: seconds)
            return
        }
        guard positioning == nil else { return }
        established = true
        super.prepared(player)
        maybeContinue()
    }

    private func observedPosition(_ player: Player) -> Int? {
        let time = player.currentTime(.relativeTime)
        guard time.isFinite, time >= 0, time < Double(Int.max) / 1000 else { return nil }
        return Int((time * 1000).rounded())
    }

    private func positionArchive(_ player: Player, source: Source, target: Double) {
        let issued = ProcessInfo.processInfo.systemUptime
        positioning = ArchiveSeek(target: target, issued: issued)
        if let request = pendingHandoff { handoffs.seekIssued(request, uptime: issued) }
        player.events.on(SeekEvent.self).receive(on: DispatchQueue.main).sink { [weak self, weak player, weak source] event in
            guard let self, let player, let source, self.owns(player), self.activeSource === source,
                  event.to.source === source else { return }
            self.archiveSeekStarted(event, player: player)
        }.store(in: &seekSubscriptions)
        player.events.on(SeekedEvent.self).receive(on: DispatchQueue.main).sink { [weak self, weak player, weak source] _ in
            guard let self, let player, let source, self.activeSource === source, self.owns(player) else { return }
            self.archiveSeekCompleted(player, seconds: player.currentTime(.relativeTime))
        }.store(in: &seekSubscriptions)
        observation = Task { [weak self, weak source] in
            while !Task.isCancelled {
                guard let self, let source, self.activeSource === source, let player = self.player,
                      self.ready, player.source === source else { return }
                let now = ProcessInfo.processInfo.systemUptime
                if now - issued > HandoffLedger.confirmationWindow {
                    if self.positioning != nil { self.rejectPosition(player, mismatch: false) }
                    else { self.stopObservation() }
                    return
                }
                if self.positioning == nil {
                    guard let request = self.pendingHandoff, let asset = self.asset, self.onLocalRoute,
                          !self.isBackgrounded, self.desiredPlayback == self.currentRequest?.play else {
                        self.stopObservation()
                        return
                    }
                    if self.handoffs.observe(request, videoId: asset.videoId, positionMs: self.observedPosition(player),
                                             isPlaying: player.isPlaying, isPaused: player.isPaused,
                                             readyStopped: !self.desiredPlayback && !player.isPlaying, uptime: now) {
                        self.stopObservation()
                        return
                    }
                }
                do { try await Task.sleep(nanoseconds: 200_000_000) } catch { return }
            }
        }
        seekArchive(player, target)
    }

    func archiveSeekStarted(_ event: SeekEvent, player: Player) {
        guard owns(player), event.to.source === activeSource else { return }
        guard let attempt = positioning else { stopObservation(); return }
        guard !attempt.started, abs(event.to.time - attempt.target) <= 0.001 else {
            rejectPosition(player, mismatch: true)
            return
        }
        positioning?.started = true
    }

    func archiveSeekCompleted(_ player: Player, seconds: Double) {
        guard owns(player), let attempt = positioning else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard now - attempt.issued <= HandoffLedger.confirmationWindow else {
            rejectPosition(player, mismatch: false)
            return
        }
        guard attempt.started, seconds.isFinite, seconds >= 0, abs(seconds - attempt.target) <= 1 else {
            rejectPosition(player, mismatch: true)
            return
        }
        if let request = pendingHandoff, let asset, onLocalRoute {
            _ = handoffs.seekCompleted(request, videoId: asset.videoId, positionMs: observedPosition(player), uptime: now)
        } else { pendingHandoff = nil }
        positioning = nil
        position = seconds
        established = true
        super.prepared(player)
    }

    private func rejectPosition(_ player: Player, mismatch: Bool) {
        if mismatch, let request = pendingHandoff { handoffs.fail(request, reason: .position) }
        stopObservation()
        player.pause()
        super.failed("The viewed position is unavailable in this archive.")
    }

    override func onPlaying(_ event: PlayingEvent, player: Player) {
        guard owns(player) else { return }
        if problem != nil || (!established && currentRequest?.seek != nil) {
            player.pause()
            return
        }
        super.onPlaying(event, player: player)
    }

    override func onPaused(_ event: PausedEvent, player: Player) {
        guard established else { return }
        super.onPaused(event, player: player)
    }

    override func failed(_ reason: String) {
        if established, let request = currentRequest, request.asset.kind == "archive" {
            let seconds = position ?? request.seek
            currentRequest = OpenRequest(asset: request.asset, seek: seconds, play: desiredPlayback,
                                         restoreUTC: nil, archiveHandoff: false)
        }
        if let request = pendingHandoff { handoffs.fail(request) }
        established = false
        stopObservation()
        super.failed(reason)
    }

    override func onPlaybackFinished(_ event: PlaybackFinishedEvent, player: Player) {
        guard owns(player) else { return }
        playing = false
        clearCaptions()
        record("Finished")
        if asset?.kind == "clip", status == "live" { backToLive(restore: false) }
    }
}
