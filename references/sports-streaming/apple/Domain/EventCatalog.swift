import Foundation

struct SportAsset: Decodable, Identifiable {
    struct Delivery: Decodable { let hls: String }
    struct Track: Decodable { let url: String; let language: String; let label: String }
    let id: String
    let eventId: String
    let kind: String
    let videoId: String
    let title: String
    let titleJa: String?
    var displayTitle: String { Locale.preferredLanguages.first?.hasPrefix("ja") == true ? titleJa ?? title : title }
    let streams: Delivery
    let subtitleTracks: [Track]
    let utcStartMs: Double?
    let utcMappings: [ArchiveMap.Interval]?
    let measuredDurationMs: Double?
}

struct Event: Decodable, Identifiable {
    let id: String
    let title: String
    let titleJa: String?
    var displayTitle: String { Locale.preferredLanguages.first?.hasPrefix("ja") == true ? titleJa ?? title : title }
    let liveAssetId: String?
    let archiveAssetId: String?
    let status: String
    let archiveStatus: String
    let statusUrl: String?
}
struct EventCatalog: Decodable {
    let events: [Event]
    let assets: [SportAsset]
}

struct ArchiveMap: Decodable {
    struct Interval: Decodable {
        let utcStartMs: Double
        let utcEndMs: Double
        let archiveStartMs: Double
    }
    let assetId: String
    let durationMs: Double?
    let utcStartMs: Double?
    let utcMappings: [Interval]?

    func position(for utc: Double?) -> Double? {
        guard let utc, utc.isFinite, let durationMs, durationMs > 0 else { return nil }
        let offset: Double
        if let intervals = utcMappings, !intervals.isEmpty {
            var previousUTC = -Double.infinity
            var previousEnd = 0.0
            var match: Double?
            for row in intervals {
                let end = row.archiveStartMs + (row.utcEndMs - row.utcStartMs)
                guard row.utcStartMs >= previousUTC, row.utcStartMs < row.utcEndMs,
                      row.archiveStartMs >= previousEnd, end <= durationMs else { return nil }
                if (row.utcStartMs..<row.utcEndMs).contains(utc) {
                    match = row.archiveStartMs + (utc - row.utcStartMs)
                }
                previousUTC = row.utcEndMs
                previousEnd = end
            }
            guard let match else { return nil }
            offset = match
        } else {
            guard let utcStartMs else { return nil }
            offset = utc - utcStartMs
        }
        return (0..<durationMs).contains(offset) ? offset / 1000 : nil
    }
}

struct EventUpdate: Decodable {
    let id: String
    let liveAssetId: String?
    let archiveAssetId: String?
    let status: String
    let archiveStatus: String
    let utcStartMs: Double?
    let seekableUtcStartMs: Double?
    let seekableUtcEndMs: Double?
    let archiveMapping: ArchiveMap?

    /// The fixture publisher removes the DVR window after ENDLIST. The full
    /// archive's measured duration still bounds a timestamp from this source.
    var presentationEndMs: Double? {
        if let seekableUtcEndMs { return seekableUtcEndMs }
        guard status == "ended", archiveStatus == "ready", let mapping = archiveMapping,
              mapping.assetId == archiveAssetId, let origin = utcStartMs else { return nil }
        if let end = mapping.utcMappings?.last?.utcEndMs { return end }
        guard mapping.utcStartMs == origin, let duration = mapping.durationMs, duration > 0 else { return nil }
        return origin + duration
    }

    func applies(to event: Event) -> Bool {
        id == event.id && liveAssetId == event.liveAssetId && archiveAssetId == event.archiveAssetId &&
        (archiveMapping == nil || (archiveMapping?.assetId == event.archiveAssetId && archiveStatus == "ready"))
    }
}
