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
    @Published var notice: String?
    private(set) var handoffs = HandoffLedger()
    private var pendingHandoff: UUID?
    private var observation: Task<Void, Never>?
    private var seekSubscriptions = Set<AnyCancellable>()

    private func stopObservation() {
        seekSubscriptions.removeAll()
        observation?.cancel()
        observation = nil
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
    var statusPollingFinished: Bool { !statusError && update?.pollingFinished == true }
    var status: String? { update?.status ?? event?.status }
    var archiveReady: Bool { (update?.archiveStatus ?? event?.archiveStatus) == "ready" }
    var assets: [SportAsset] { catalog?.assets.filter { $0.eventId == event?.id } ?? [] }

    override init() {
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
        resetSelection()
        player?.unload()
        generation = UUID()
        event = next
        update = nil
        asset = nil
        archiveTargetID = next.archiveAssetId
        savedLive = nil
        currentRequest = nil
        returnToUTC = nil
        pendingSeek = nil
        notice = nil
        statusError = false
    }

    func poll(fetch: (String) async throws -> EventUpdate = { try await Media.fetch($0, as: EventUpdate.self) },
              interval: UInt64 = 2_000_000_000) async {
        guard let event, let path = event.statusUrl else { return }
        let token = generation
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
            do { try await Task.sleep(nanoseconds: interval) } catch { return }
        }
    }

    func utc() -> Double? {
        guard let player, ready, owns(player), asset?.kind == "live",
              let origin = update?.utcStartMs ?? asset?.utcStartMs else { return nil }
        return clock.read(absolute: player.currentTime(.absoluteTime), relative: player.currentTime(.relativeTime),
                          live: player.isLive, origin: origin, end: update?.presentationEndMs,
                          uptime: ProcessInfo.processInfo.systemUptime, speed: Double(player.playbackSpeed))
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
        if backgrounded { stopObservation() } else { maybeContinue() }
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
            guard seconds >= 0, seconds < player.duration else {
                notice = "This position is outside the archive."
                player.pause()
                return
            }
            if let request = pendingHandoff, let source = activeSource, let asset {
                observeHandoff(request, player: player, source: source, videoId: asset.videoId, target: seconds)
            }
            player.seek(time: seconds)
        }
        super.prepared(player)
        maybeContinue()
    }

    private func observedPosition(_ player: Player) -> Int? {
        let time = player.currentTime(.relativeTime)
        guard time.isFinite, time >= 0, time < Double(Int.max) / 1000 else { return nil }
        return Int((time * 1000).rounded())
    }

    private func observeHandoff(_ request: UUID, player: Player, source: Source, videoId: String, target: Double) {
        let issued = ProcessInfo.processInfo.systemUptime
        handoffs.seekIssued(request, uptime: issued)
        var started = false
        player.events.on(SeekEvent.self).receive(on: DispatchQueue.main).sink { [weak self, weak source] event in
            guard let self, let source, self.pendingHandoff == request, self.activeSource === source else { return }
            guard !started, event.to.source === source, abs(event.to.time - target) <= 0.001 else {
                self.stopObservation()
                return
            }
            started = true
        }.store(in: &seekSubscriptions)
        player.events.on(SeekedEvent.self).receive(on: DispatchQueue.main).sink { [weak self, weak player, weak source] _ in
            guard let self, let player, let source, self.pendingHandoff == request, self.owns(player),
                  self.activeSource === source else { return }
            guard started, self.handoffs.seekCompleted(request, videoId: videoId, positionMs: self.observedPosition(player),
                                                      uptime: ProcessInfo.processInfo.systemUptime) else {
                self.stopObservation()
                return
            }
        }.store(in: &seekSubscriptions)
        observation = Task { [weak self, weak source] in
            while !Task.isCancelled {
                guard let self, let source, self.pendingHandoff == request, self.activeSource === source,
                      let player = self.player, self.ready, player.source === source else { return }
                let now = ProcessInfo.processInfo.systemUptime
                if self.isBackgrounded || !self.onLocalRoute || now - issued > HandoffLedger.confirmationWindow ||
                    self.desiredPlayback != self.currentRequest?.play {
                    self.stopObservation()
                    return
                }
                if self.handoffs.observe(request, videoId: videoId, positionMs: self.observedPosition(player),
                                         isPlaying: player.isPlaying, isPaused: player.isPaused,
                                         readyStopped: !self.desiredPlayback && !player.isPlaying,
                                         uptime: now) {
                    self.stopObservation()
                    return
                }
                do { try await Task.sleep(nanoseconds: 200_000_000) } catch { return }
            }
        }
    }

    override func failed(_ reason: String) {
        if let request = pendingHandoff { handoffs.fail(request) }
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
