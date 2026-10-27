import XCTest
@testable import PlaybackCore

final class PlaybackCommandStateTests: XCTestCase {
    func testPlaybackRequiresTheCurrentSourceToBeReadyAndErrorFree() {
        var state = PlaybackCommandState()
        XCTAssertEqual(state.rejection(for: .playback), .loadSource)
        state.source = .loading
        XCTAssertEqual(state.rejection(for: .playback), .waitForSource)
        state.source = .failed
        XCTAssertEqual(state.rejection(for: .playback), .recoverSource)
        state.source = .ready
        XCTAssertNil(state.rejection(for: .playback))
        state.playerDestroyed = true
        XCTAssertEqual(state.rejection(for: .playback), .createPlayer)
    }

    func testSeekAndTimeShiftFollowFreshTimelineRatherThanThePreset() {
        var state = ready()
        state.duration = 60
        XCTAssertNil(state.rejection(for: .seek, value: 30))
        XCTAssertEqual(state.rejection(for: .seek, value: 61), .outsideSeekRange)
        XCTAssertEqual(state.rejection(for: .timeShift, value: -10), .liveOnly)
        state.live = true
        state.duration = .infinity
        XCTAssertEqual(state.rejection(for: .seek, value: 10), .vodOnly)
        XCTAssertEqual(state.rejection(for: .timeShift, value: -10), .noLiveWindow)
        state.maxTimeShift = -30
        XCTAssertNil(state.rejection(for: .timeShift, value: -10))
        XCTAssertEqual(state.rejection(for: .timeShift, value: -31), .outsideSeekRange)
        state.rewindEnabled = false
        XCTAssertEqual(state.rejection(for: .timeShift, value: -10), .rewindDisabled)
        state.rewindEnabled = true
        state.sdkTimeShiftEnabled = false
        XCTAssertEqual(state.rejection(for: .timeShift, value: 0), .rewindDisabled)
        state.sdkTimeShiftEnabled = true
        state.finalizedLive = true
        XCTAssertEqual(state.rejection(for: .timeShift, value: 0), .liveOnly)
        state.live = false
        state.duration = 60
        XCTAssertNil(state.rejection(for: .seek, value: 10))
    }

    func testAdSkipNeedsActualActiveSkippableAdAndSupportedProgrammaticUi() {
        var state = ready()
        XCTAssertEqual(state.rejection(for: .adSkip), .noActiveAd)
        state.linearAdActive = true
        XCTAssertEqual(state.rejection(for: .adSkip), .adNotSkippable)
        state.adSkippableAfter = 5
        state.adPosition = 4.99
        XCTAssertEqual(state.rejection(for: .adSkip), .adNotSkippable)
        state.adPosition = 5
        XCTAssertNil(state.rejection(for: .adSkip))
        XCTAssertEqual(state.rejection(for: .seek, value: 0), .linearAdActive)
        state.programmaticAdSkipSupported = false
        XCTAssertEqual(state.rejection(for: .adSkip), .useImaSkipButton)
        state.linearAdActive = false
        XCTAssertEqual(state.rejection(for: .adSkip), .noActiveAd)
        state.linearAdActive = true
        state.programmaticAdSkipSupported = true
        state.adSkippableAfter = .nan
        XCTAssertEqual(state.rejection(for: .adSkip), .adNotSkippable)
    }

    func testLiveEdgeRecoveryRemainsAvailableWhenOnlyRewindControlsAreDisabled() {
        var state = ready()
        state.live = true
        state.maxTimeShift = -30
        state.rewindEnabled = false
        XCTAssertNil(state.rejection(for: .timeShift), "The catalog must allow selecting the valid zero-offset recovery")
        XCTAssertNil(state.rejection(for: .timeShift, value: 0))
        XCTAssertEqual(state.rejection(for: .timeShift, value: -5), .rewindDisabled)

        state.sdkTimeShiftEnabled = false
        XCTAssertEqual(state.rejection(for: .timeShift), .rewindDisabled)
        XCTAssertEqual(state.rejection(for: .timeShift, value: 0), .rewindDisabled)
        state.sdkTimeShiftEnabled = true
        state.linearAdActive = true
        XCTAssertEqual(state.rejection(for: .timeShift, value: 0), .linearAdActive)
        state.linearAdActive = false
        state.finalizedLive = true
        XCTAssertEqual(state.rejection(for: .timeShift, value: 0), .liveOnly)
        state.finalizedLive = false
        state.source = .failed
        XCTAssertEqual(state.rejection(for: .timeShift, value: 0), .recoverSource)
    }

    func testZeroOffsetIsValidWithoutRewindWindowButNonzeroOffsetsStillRequireIt() {
        var state = ready()
        state.live = true
        XCTAssertNil(state.rejection(for: .timeShift))
        XCTAssertNil(state.rejection(for: .timeShift, value: 0))
        XCTAssertEqual(state.rejection(for: .timeShift, value: -1), .noLiveWindow)
        state.maxTimeShift = .nan
        XCTAssertEqual(state.rejection(for: .timeShift, value: 0), .noLiveWindow)
        state.maxTimeShift = -30
        XCTAssertEqual(state.rejection(for: .timeShift, value: .nan), .outsideSeekRange)
        XCTAssertEqual(state.rejection(for: .timeShift, value: 1), .outsideSeekRange)
    }

    private func ready() -> PlaybackCommandState {
        var state = PlaybackCommandState()
        state.source = .ready
        return state
    }
}
