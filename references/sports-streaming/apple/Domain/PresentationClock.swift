import Foundation

/// Tracks the relationship between the native player's UTC and relative clocks
/// for one source. The publisher can temporarily withdraw the presentation end.
struct PresentationClock {
    private var anchor: (relative: Double, offset: Double, uptime: Double)?
    private var finalizedOffset: Double?
    private var origin: Double?
    private var knownEnd: Double?

    mutating func read(absolute: Double, relative: Double, live: Bool, origin: Double, end: Double?,
                       uptime: Double, speed: Double) -> Double? {
        if self.origin != origin {
            self = PresentationClock()
            self.origin = origin
        }
        guard origin.isFinite, relative.isFinite, uptime.isFinite else { return nil }
        if let end {
            guard end.isFinite, end >= origin else { return nil }
            knownEnd = end
        }

        let direct = absolute * 1000
        let offset = absolute - relative
        let previous = anchor
        let elapsed = previous.map { uptime - $0.uptime } ?? .infinity
        // Status also samples a paused source every two seconds. Allow for timer jitter.
        let continuous = previous.map {
            (0...3).contains(elapsed) && speed.isFinite && speed > 0 &&
            abs(relative - $0.relative) <= elapsed * speed + 1
        } ?? false
        let boundedUTC = knownEnd.map { (origin...$0).contains(direct) } ?? false
        let sameClock = previous.map { abs(offset - $0.offset) <= 0.25 } ?? false
        if boundedUTC || (live && continuous && sameClock) {
            anchor = (relative, offset, uptime)
            finalizedOffset = nil
            return end != nil && boundedUTC ? direct : nil
        }

        // ENDLIST can make both native API variants return the relative clock.
        // A contradictory UTC reading cannot establish this change of domain.
        guard !live, abs(absolute - relative) <= 0.25 else { return nil }
        if finalizedOffset == nil, let previous {
            anchor = nil
            guard continuous else { return nil }
            finalizedOffset = previous.offset
        }
        // A relative-only sample is usable after the publisher supplies bounds
        // again. Even after a DVR seek, always convert the current SDK sample.
        guard let end, let finalizedOffset else { return nil }
        let converted = (relative + finalizedOffset) * 1000
        return (origin...end).contains(converted) ? converted : nil
    }
}
