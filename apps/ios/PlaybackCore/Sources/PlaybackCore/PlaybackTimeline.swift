import Foundation

/// Playback timing and live seek-window calculations, independent of the Player SDK.
/// The live edge is `0`, the past is negative, and the lower window bound is
/// `maxTimeShift` (`<= 0`).

public enum PlaybackMode: String {
    case vod
    case endedLive = "ended-live"
    case liveDvr = "live-dvr"
    case liveNoDvr = "live-no-dvr"
}

/// A point-in-time read of the player (built from the Bitmovin iOS `Player` props).
public struct PlayerSnapshot {
    public let isLive: Bool
    /// `.infinity` for an ongoing live stream, finite for VOD.
    public let duration: TimeInterval
    /// `<= 0`; may be `0` for HLS until the buffer fills.
    public let maxTimeShift: TimeInterval
    /// Current offset in `[maxTimeShift, 0]`; `0` is the live edge.
    public let timeShift: TimeInterval
    public let currentTime: TimeInterval
    /// A native completion finalized this loaded live source. Replaying the same
    /// source does not make its live edge move again.
    public let liveSourceFinalized: Bool

    public init(
        isLive: Bool,
        duration: TimeInterval,
        maxTimeShift: TimeInterval,
        timeShift: TimeInterval,
        currentTime: TimeInterval,
        liveSourceFinalized: Bool = false
    ) {
        self.isLive = isLive
        self.duration = duration
        self.maxTimeShift = maxTimeShift
        self.timeShift = timeShift
        self.currentTime = currentTime
        self.liveSourceFinalized = liveSourceFinalized
    }
}

public struct TimelineConfig {
    public let timeShiftEnabled: Bool
    public let liveEdgeEpsilon: TimeInterval

    public init(timeShiftEnabled: Bool, liveEdgeEpsilon: TimeInterval = 1) {
        self.timeShiftEnabled = timeShiftEnabled
        self.liveEdgeEpsilon = liveEdgeEpsilon
    }
}

public struct TimelineState {
    public let mode: PlaybackMode
    public let isLive: Bool
    public let dvrAvailable: Bool
    public let windowDuration: TimeInterval
    public let behindLive: TimeInterval
    public let atLiveEdge: Bool
    public let seekProgress: Double
}

public enum PlaybackTimeline {
    /// Clamp a requested offset into the legal window `[maxTimeShift, 0]`.
    public static func clampToWindow(_ requested: TimeInterval, maxTimeShift: TimeInterval) -> TimeInterval {
        guard requested.isFinite else { return 0 }
        guard maxTimeShift.isFinite, maxTimeShift < 0 else { return 0 }
        return min(0, max(maxTimeShift, requested))
    }

    /// True within `epsilon` seconds of the live edge (offset `0`).
    public static func isAtLiveEdge(_ timeShift: TimeInterval, epsilon: TimeInterval = 1) -> Bool {
        timeShift.isFinite && abs(timeShift) <= epsilon
    }

    /// Window length in seconds (`>= 0`). For HLS this is `0` until the buffer fills.
    public static func windowDuration(_ maxTimeShift: TimeInterval) -> TimeInterval {
        (maxTimeShift.isFinite && maxTimeShift < 0) ? -maxTimeShift : 0
    }

    /// Distance behind the live edge in seconds (`>= 0`).
    public static func behindLive(_ timeShift: TimeInterval) -> TimeInterval {
        (timeShift.isFinite && timeShift < 0) ? -timeShift : 0
    }

    /// Normalized scrubber position in `[0, 1]`: `0` = oldest, `1` = live edge.
    public static func seekProgress(_ timeShift: TimeInterval, maxTimeShift: TimeInterval) -> Double {
        let win = windowDuration(maxTimeShift)
        guard win > 0 else { return 1 }
        let offset = clampToWindow(timeShift, maxTimeShift: maxTimeShift)
        return (win + offset) / win
    }

    /// Whether the DVR window has settled (HLS reads `0` until the buffer fills).
    public static func isWindowSettled(_ maxTimeShift: TimeInterval) -> Bool {
        maxTimeShift < 0
    }

    /// A finite, positive duration is the authoritative VOD signal; `0`/`NaN`/`.infinity`
    /// is treated as live (live duration is `.infinity`; `0`/`NaN` is "not yet known").
    public static func isLiveStream(_ s: PlayerSnapshot) -> Bool {
        if s.duration.isFinite && s.duration > 0 { return false }
        return true
    }

    public static func deriveState(_ s: PlayerSnapshot, config: TimelineConfig) -> TimelineState {
        let endedLive = isLiveStream(s) && s.liveSourceFinalized
        let live = isLiveStream(s) && !endedLive
        let win = windowDuration(s.maxTimeShift)
        let dvrAvailable = live && config.timeShiftEnabled && win > 0
        let mode: PlaybackMode = endedLive ? .endedLive : (!live ? .vod : (dvrAvailable ? .liveDvr : .liveNoDvr))
        let offset = clampToWindow(s.timeShift, maxTimeShift: s.maxTimeShift)
        return TimelineState(
            mode: mode,
            isLive: live,
            dvrAvailable: dvrAvailable,
            windowDuration: live ? win : 0,
            behindLive: live ? behindLive(offset) : 0,
            atLiveEdge: live ? isAtLiveEdge(offset, epsilon: config.liveEdgeEpsilon) : false,
            seekProgress: live ? seekProgress(offset, maxTimeShift: s.maxTimeShift) : 1
        )
    }

    /// True when a live stream has just finalized into VOD between two snapshots.
    /// On iOS, `DurationChanged` can be missing on live→VOD, so the app polls
    /// snapshots on `TimeChanged` and feeds them here.
    public static func detectLiveToVod(prev: PlayerSnapshot, next: PlayerSnapshot) -> Bool {
        isLiveStream(prev) && !isLiveStream(next)
    }

    // MARK: - Labels (§7)

    public static func formatDuration(_ seconds: TimeInterval) -> String {
        guard seconds.isFinite else { return "0s" }
        let total = max(0, Int(seconds))
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 { return "\(h)h \(pad(m))m" }
        if m > 0 { return "\(m)m \(pad(s))s" }
        return "\(s)s"
    }

    /// `"LIVE"` at the edge, otherwise the behind-live offset, e.g. `"-1m 05s behind"`.
    public static func formatBehindLive(
        _ timeShift: TimeInterval,
        epsilon: TimeInterval = 1,
        liveLabel: String = "LIVE"
    ) -> String {
        if isAtLiveEdge(timeShift, epsilon: epsilon) { return liveLabel }
        return "-\(formatDuration(behindLive(timeShift))) behind"
    }

    private static func pad(_ n: Int) -> String {
        n < 10 ? "0\(n)" : "\(n)"
    }
}
