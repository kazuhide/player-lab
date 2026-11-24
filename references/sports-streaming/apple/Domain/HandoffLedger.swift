import Foundation

/// In-memory records of local, mapped archive requests. Recording a request
/// and confirming its observed position are separate operations.
struct HandoffLedger {
    private struct Observation {
        let positionMs: Int
        let uptime: TimeInterval
    }
    private struct Record {
        let id: UUID
        let at: Date
        let eventId: String
        let videoId: String
        let targetMs: Int?
        let play: Bool
        var candidate: Observation?
        var confirmedMs: Int?
        var failed = false
    }

    private var records: [Record] = []

    mutating func begin(eventId: String, videoId: String, positionMs: Int?, play: Bool,
                        at: Date = Date()) -> UUID {
        let id = UUID()
        if records.count == 200 { records.removeFirst() }
        records.append(Record(id: id, at: at, eventId: eventId, videoId: videoId,
                              targetMs: positionMs, play: play))
        return id
    }

    mutating func fail(_ id: UUID) {
        guard let index = records.firstIndex(where: { $0.id == id }), records[index].confirmedMs == nil else { return }
        records[index].failed = true
    }

    mutating func observe(_ id: UUID, videoId: String, positionMs: Int?, isPlaying: Bool,
                          isPaused: Bool, readyStopped: Bool, uptime: TimeInterval) -> Bool {
        guard let index = records.firstIndex(where: { $0.id == id }) else { return false }
        let record = records[index]
        guard !record.failed, videoId == record.videoId, let target = record.targetMs,
              let positionMs, positionMs >= 0 else { return false }
        if record.confirmedMs != nil { return true }
        let nearTarget = abs(Double(positionMs) - Double(target)) <= 1000
        if record.play {
            guard isPlaying, !isPaused else { return false }
            if let candidate = record.candidate {
                guard positionMs > candidate.positionMs else { return false }
                records[index].confirmedMs = candidate.positionMs
                return true
            }
        } else {
            guard !isPlaying, nearTarget else { return false }
            if isPaused {
                records[index].confirmedMs = positionMs
                return true
            }
            guard readyStopped else { return false }
            if let candidate = record.candidate {
                guard uptime - candidate.uptime >= 0.2, abs(positionMs - candidate.positionMs) <= 250 else { return false }
                records[index].confirmedMs = candidate.positionMs
                return true
            }
        }
        if nearTarget { records[index].candidate = Observation(positionMs: positionMs, uptime: uptime) }
        return false
    }

    func export(at now: Date = Date()) throws -> Data {
        let dates = ISO8601DateFormatter()
        dates.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let rows: [[String: Any]] = records.map { record in
            let requested: [String: Any] = ["videoId": record.videoId,
                "positionMs": record.targetMs as Any, "playWhenReady": record.play]
            let confirmed: [String: Any]? = record.confirmedMs.map {
                ["videoId": record.videoId, "positionMs": $0, "playWhenReady": record.play, "positionAdvanced": record.play]
            }
            return ["requestId": record.id.uuidString, "requestedAt": dates.string(from: record.at),
                    "eventId": record.eventId, "transition": "live-to-archive", "requested": requested,
                    "confirmed": confirmed as Any, "failure": (record.failed ? "load-failed" : nil) as Any,
                    "receiverQoe": NSNull()]
        }
        let start = records.map(\.at).min() ?? now
        let end = max(now, records.map(\.at).max() ?? now)
        let document: [String: Any] = ["schemaVersion": 1, "source": "local-device-records",
            "period": ["start": dates.string(from: start), "end": dates.string(from: end)], "records": rows]
        return try JSONSerialization.data(withJSONObject: document, options: [.prettyPrinted, .sortedKeys])
    }
}
