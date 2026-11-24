import SwiftUI
import BitmovinPlayer

@MainActor
final class SportsSession: Playback {
    @Published var catalog: EventCatalog?
    @Published var event: Event?
    @Published var update: EventUpdate?
    @Published var asset: SportAsset?
    @Published var autoContinue = false
    @Published var statusError = false
    @Published var notice: String?
    private var clock = PresentationClock()
    private var generation = UUID()
    private var pendingSeek: Double?
    private var savedLive: (utc: Double, play: Bool)?
    private var returnToUTC: Double?
    var canReturn: Bool {
        guard !statusError, status == "live", let utc = savedLive?.utc, let start = update?.seekableUtcStartMs,
              let end = update?.seekableUtcEndMs, start <= end else { return false }
        return (start..<end).contains(utc)
    }
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
        resetSelection()
        player?.unload()
        generation = UUID()
        event = next
        update = nil
        asset = nil
        savedLive = nil
        returnToUTC = nil
        pendingSeek = nil
        notice = nil
        statusError = false
    }

    func poll() async {
        guard let event, let path = event.statusUrl else { return }
        let token = generation
        while !Task.isCancelled && token == generation {
            do {
                let fresh = try await Media.fetch(path, as: EventUpdate.self)
                guard !Task.isCancelled, token == generation else { return }
                guard fresh.applies(to: event) else { throw URLError(.cannotDecodeContentData) }
                update = fresh
                statusError = false
                if autoContinue && status == "ended", let archive = assets.first(where: { $0.id == event.archiveAssetId }),
                   let seconds = mappedPosition(for: archive) {
                    open(archive, seek: seconds, play: desiredPlayback)
                }
            } catch { if !Task.isCancelled && token == generation { statusError = true } }
            do { try await Task.sleep(nanoseconds: 2_000_000_000) } catch { return }
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
        if owns(player), asset?.kind == "live" { _ = utc() }
    }

    func mappedPosition(for archive: SportAsset) -> Double? {
        guard !statusError, archiveReady, archive.kind == "archive", archive.eventId == event?.id, let time = utc() else { return nil }
        if let fresh = update?.archiveMapping, fresh.assetId == archive.id { return fresh.position(for: time) }
        return ArchiveMap(assetId: archive.id, durationMs: archive.measuredDurationMs, utcStartMs: archive.utcStartMs,
                          utcMappings: archive.utcMappings).position(for: time)
    }

    func open(_ next: SportAsset, seek: Double? = nil, play: Bool = true, restoreUTC: Double? = nil) {
        guard let player, next.eventId == event?.id,
              next.kind != "archive" || archiveReady, next.kind != "live" || status == "live" else { return }
        if asset?.kind == "live", next.kind == "clip" {
            savedLive = utc().map { ($0, desiredPlayback) }
        }
        resetSelection()
        clock = PresentationClock()
        asset = next
        pendingSeek = seek
        returnToUTC = restoreUTC
        desiredPlayback = play
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
            player.seek(time: seconds)
        }
        super.prepared(player)
    }

    override func onPlaybackFinished(_ event: PlaybackFinishedEvent, player: Player) {
        guard owns(player) else { return }
        playing = false
        captionText = nil
        record("Finished")
        if asset?.kind == "clip", status == "live" { backToLive(restore: false) }
    }
}
