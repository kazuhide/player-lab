import Foundation

/// Normalizes the SDK time for one source. ENDLIST can change the SDK's time
/// domain. Carry its observed offset over only across a continuous transition.
struct PresentationClock {
    private var lastLive: (relative: Double, offset: Double, uptime: Double)?
    private var finalizedOffset: Double?
    private var origin: Double?

    mutating func read(absolute: Double, relative: Double, live: Bool, origin: Double, end: Double?,
                       uptime: Double, speed: Double) -> Double? {
        if self.origin != origin {
            self = PresentationClock()
            self.origin = origin
        }
        guard let end, end >= origin, relative.isFinite else { return nil }
        let direct = absolute * 1000
        if direct.isFinite, (origin...end).contains(direct) {
            if live {
                lastLive = (relative, absolute - relative, uptime)
                finalizedOffset = nil
            }
            return direct
        }
        guard !live else { return nil }
        if finalizedOffset == nil, let previous = lastLive {
            let elapsed = uptime - previous.uptime
            self.lastLive = nil
            guard (0...2).contains(elapsed), speed.isFinite, speed > 0,
                  abs(relative - previous.relative) <= elapsed * speed + 1 else { return nil }
            finalizedOffset = previous.offset
        }
        guard let offset = finalizedOffset else { return nil }
        let converted = (relative + offset) * 1000
        return (origin...end).contains(converted) ? converted : nil
    }
}
