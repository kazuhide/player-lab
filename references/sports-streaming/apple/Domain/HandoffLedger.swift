import Foundation

/// In-memory records of local, mapped archive requests. Recording a request
/// and confirming its observed position are separate operations.
struct HandoffLedger {
    static let confirmationWindow: TimeInterval = 5

    private struct Observation {
        let positionMs: Int
        let uptime: TimeInterval
    }
    enum Failure: String { case load = "load-failed", position = "position-mismatch" }

    private struct Record {
        let id: UUID
        let at: Date
        let eventId: String
        let videoId: String
        let targetMs: Int?
        let play: Bool
        var seekIssuedAt: TimeInterval?
        var landing: Observation?
        var confirmedMs: Int?
        var failure: Failure?
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

    mutating func fail(_ id: UUID, reason: Failure = .load) {
        guard let index = records.firstIndex(where: { $0.id == id }), records[index].confirmedMs == nil else { return }
        records[index].failure = reason
    }

    mutating func seekIssued(_ id: UUID, uptime: TimeInterval) {
        guard let index = records.firstIndex(where: { $0.id == id }) else { return }
        records[index].seekIssuedAt = uptime
    }

    mutating func seekCompleted(_ id: UUID, videoId: String, positionMs: Int?, uptime: TimeInterval) -> Bool {
        guard let index = records.firstIndex(where: { $0.id == id }) else { return false }
        let record = records[index]
        guard record.failure == nil, record.videoId == videoId, let issued = record.seekIssuedAt else { return false }
        // Consume the single completion even when the SDK landed short. Later
        // playback or another seek cannot establish where this request landed.
        records[index].seekIssuedAt = nil
        guard (0...Self.confirmationWindow).contains(uptime - issued),
              let positionMs, positionMs >= 0, let target = record.targetMs,
              abs(Double(positionMs) - Double(target)) <= 1000 else { return false }
        records[index].landing = Observation(positionMs: positionMs, uptime: uptime)
        return true
    }

    mutating func observe(_ id: UUID, videoId: String, positionMs: Int?, isPlaying: Bool,
                          isPaused: Bool, readyStopped: Bool, uptime: TimeInterval) -> Bool {
        guard let index = records.firstIndex(where: { $0.id == id }) else { return false }
        let record = records[index]
        guard record.failure == nil, videoId == record.videoId, let landing = record.landing,
              let positionMs, positionMs >= 0 else { return false }
        if record.confirmedMs != nil { return true }
        let elapsed = uptime - landing.uptime
        guard (0...Self.confirmationWindow).contains(elapsed) else { return false }
        let advance = Double(positionMs) - Double(landing.positionMs)
        if record.play {
            // The fastest selectable speed is 2x. A jump to a different
            // position is evidence of another navigation, not playback.
            guard isPlaying, !isPaused, advance > 0, advance <= elapsed * 2000 + 250 else { return false }
        } else {
            guard !isPlaying, abs(advance) <= 250, isPaused || (readyStopped && elapsed >= 0.2) else { return false }
        }
        records[index].confirmedMs = landing.positionMs
        return true
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
                    "confirmed": confirmed as Any, "failure": record.failure?.rawValue as Any,
                    "receiverQoe": NSNull()]
        }
        let start = records.map(\.at).min() ?? now
        let end = max(now, records.map(\.at).max() ?? now)
        let document: [String: Any] = ["schemaVersion": 1, "source": "local-device-records",
            "period": ["start": dates.string(from: start), "end": dates.string(from: end)], "records": rows]
        return try JSONSerialization.data(withJSONObject: document, options: [.prettyPrinted, .sortedKeys])
    }
}
