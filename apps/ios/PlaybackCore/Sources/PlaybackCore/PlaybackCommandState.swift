import Foundation

/// A fresh Apple playback snapshot. SDK object ownership is checked by the native host.
public struct PlaybackCommandState {
    public enum SourceState { case empty, loading, ready, failed }
    public enum Command { case playback, seek, timeShift, adSchedule, adSkip, liveLatency }
    public enum Rejection: String {
        case createPlayer = "Create a player before invoking this API."
        case loadSource = "Load a source first."
        case waitForSource = "Wait for the current source to become ready."
        case recoverSource = "Reload the source or recreate the player after the playback error."
        case vodOnly = "This API requires on-demand content. Use time shift for live content."
        case liveOnly = "This API requires an active live source."
        case rewindDisabled = "Enable live rewind controls and SDK time shift first."
        case noLiveWindow = "Wait for a seekable live window."
        case outsideSeekRange = "Choose a position inside the current seekable range."
        case linearAdActive = "Wait for the active linear ad to finish."
        case noActiveAd = "Wait for an active linear ad."
        case adNotSkippable = "The active ad is not skippable at the current position."
        case useImaSkipButton = "Use the IMA Skip ad button, or configure IMA UI as disabled before loading."
    }

    public var source = SourceState.empty
    public var playerDestroyed = false
    public var live = false
    public var finalizedLive = false
    public var duration: TimeInterval = 0
    public var maxTimeShift: TimeInterval = 0
    public var rewindEnabled = true
    public var sdkTimeShiftEnabled = true
    public var linearAdActive = false
    public var adSkippableAfter: TimeInterval = .nan
    public var adPosition: TimeInterval = .nan
    public var programmaticAdSkipSupported = true

    public init() {}

    public func rejection(for command: Command, value: TimeInterval? = nil) -> Rejection? {
        if playerDestroyed { return .createPlayer }
        switch source {
        case .empty: return .loadSource
        case .loading: return .waitForSource
        case .failed: return .recoverSource
        case .ready: break
        }
        if command == .adSkip {
            guard linearAdActive else { return .noActiveAd }
            guard programmaticAdSkipSupported else { return .useImaSkipButton }
            guard adSkippableAfter.isFinite, adSkippableAfter >= 0,
                  adPosition.isFinite, adPosition >= adSkippableAfter else { return .adNotSkippable }
            return nil
        }
        if linearAdActive && (command == .seek || command == .timeShift) { return .linearAdActive }
        switch command {
        case .seek:
            guard !live, duration.isFinite, duration > 0 else { return .vodOnly }
            if let value, !value.isFinite || value < 0 || value > duration { return .outsideSeekRange }
        case .timeShift:
            guard live && !finalizedLive else { return .liveOnly }
            guard sdkTimeShiftEnabled else { return .rewindDisabled }
            guard maxTimeShift.isFinite, maxTimeShift <= 0 else { return .noLiveWindow }
            // The catalog and zero-offset recovery remain available when only
            // the app's rewind controls are disabled or the window is still zero.
            if value == nil || value == 0 { return nil }
            guard rewindEnabled else { return .rewindDisabled }
            guard maxTimeShift < 0 else { return .noLiveWindow }
            if let value, !value.isFinite || value < maxTimeShift || value > 0 { return .outsideSeekRange }
        case .liveLatency:
            guard live && !finalizedLive else { return .liveOnly }
        default: break
        }
        return nil
    }
}
