import XCTest
@testable import PlaybackCore

final class PlaybackTimelineTests: XCTestCase {
    private let live = PlayerSnapshot(
        isLive: true, duration: .infinity, maxTimeShift: -300, timeShift: 0, currentTime: 1000
    )

    func testClampToWindow() {
        XCTAssertEqual(PlaybackTimeline.clampToWindow(-500, maxTimeShift: -300), -300)
        XCTAssertEqual(PlaybackTimeline.clampToWindow(-100, maxTimeShift: -300), -100)
        XCTAssertEqual(PlaybackTimeline.clampToWindow(5, maxTimeShift: -300), 0)        // positive → edge
        XCTAssertEqual(PlaybackTimeline.clampToWindow(-100, maxTimeShift: 0), 0)        // no window → edge
        XCTAssertEqual(PlaybackTimeline.clampToWindow(.nan, maxTimeShift: -300), 0)     // NaN → edge
    }

    func testIsAtLiveEdge() {
        XCTAssertTrue(PlaybackTimeline.isAtLiveEdge(0))
        XCTAssertTrue(PlaybackTimeline.isAtLiveEdge(-0.5))
        XCTAssertFalse(PlaybackTimeline.isAtLiveEdge(-2))
        XCTAssertTrue(PlaybackTimeline.isAtLiveEdge(-2, epsilon: 3))
        XCTAssertFalse(PlaybackTimeline.isAtLiveEdge(.nan))
    }

    func testWindowBehindProgress() {
        XCTAssertEqual(PlaybackTimeline.windowDuration(-300), 300)
        XCTAssertEqual(PlaybackTimeline.windowDuration(0), 0)
        XCTAssertEqual(PlaybackTimeline.behindLive(-60), 60)
        XCTAssertEqual(PlaybackTimeline.behindLive(5), 0)
        XCTAssertEqual(PlaybackTimeline.seekProgress(-150, maxTimeShift: -300), 0.5)
        XCTAssertEqual(PlaybackTimeline.seekProgress(0, maxTimeShift: -300), 1)
        XCTAssertEqual(PlaybackTimeline.seekProgress(0, maxTimeShift: 0), 1)
    }

    func testDeriveState() {
        let dvr = PlaybackTimeline.deriveState(live, config: TimelineConfig(timeShiftEnabled: true))
        XCTAssertEqual(dvr.mode, .liveDvr)
        XCTAssertTrue(dvr.dvrAvailable)
        XCTAssertTrue(dvr.atLiveEdge)
        XCTAssertEqual(dvr.windowDuration, 300)

        XCTAssertEqual(PlaybackTimeline.deriveState(live, config: TimelineConfig(timeShiftEnabled: false)).mode, .liveNoDvr)

        let unsettled = PlayerSnapshot(isLive: true, duration: .infinity, maxTimeShift: 0, timeShift: 0, currentTime: 0)
        XCTAssertFalse(PlaybackTimeline.deriveState(unsettled, config: TimelineConfig(timeShiftEnabled: true)).dvrAvailable)

        let vod = PlayerSnapshot(isLive: false, duration: 3600, maxTimeShift: 0, timeShift: 0, currentTime: 120)
        XCTAssertEqual(PlaybackTimeline.deriveState(vod, config: TimelineConfig(timeShiftEnabled: true)).mode, .vod)
    }

    func testLiveVodClassification() {
        XCTAssertTrue(PlaybackTimeline.isLiveStream(live))
        XCTAssertFalse(PlaybackTimeline.isLiveStream(PlayerSnapshot(isLive: true, duration: 3600, maxTimeShift: 0, timeShift: 0, currentTime: 0)))
        XCTAssertTrue(PlaybackTimeline.isLiveStream(PlayerSnapshot(isLive: true, duration: 0, maxTimeShift: 0, timeShift: 0, currentTime: 0)))
        let vod = PlayerSnapshot(isLive: false, duration: 3600, maxTimeShift: 0, timeShift: 0, currentTime: 0)
        XCTAssertTrue(PlaybackTimeline.detectLiveToVod(prev: live, next: vod))
        XCTAssertFalse(PlaybackTimeline.detectLiveToVod(prev: live, next: live))
    }

    func testCompletedLiveSourceKeepsNativeTimingButDisablesLiveCommandsDuringReplay() {
        let ended = PlayerSnapshot(isLive: true, duration: .infinity, maxTimeShift: -60,
                                   timeShift: -10, currentTime: 1060, liveSourceFinalized: true)
        let state = PlaybackTimeline.deriveState(ended, config: TimelineConfig(timeShiftEnabled: true))
        XCTAssertEqual(state.mode, .endedLive)
        XCTAssertFalse(state.isLive)
        XCTAssertFalse(state.dvrAvailable)
        XCTAssertFalse(state.atLiveEdge)
        XCTAssertEqual(state.windowDuration, 0)
        XCTAssertEqual(state.behindLive, 0)
        XCTAssertTrue(ended.isLive)
        XCTAssertTrue(ended.duration.isInfinite)
        XCTAssertFalse(PlaybackTimeline.detectLiveToVod(prev: live, next: ended))
        XCTAssertEqual(PlaybackTimeline.deriveState(live, config: TimelineConfig(timeShiftEnabled: true)).mode, .liveDvr)
        let finite = PlayerSnapshot(isLive: false, duration: 60, maxTimeShift: 0,
                                    timeShift: 0, currentTime: 60, liveSourceFinalized: true)
        XCTAssertEqual(PlaybackTimeline.deriveState(finite, config: TimelineConfig(timeShiftEnabled: true)).mode, .vod)
    }

    func testLabels() {
        XCTAssertEqual(PlaybackTimeline.formatBehindLive(0), "LIVE")
        XCTAssertEqual(PlaybackTimeline.formatBehindLive(-0.5), "LIVE")
        XCTAssertEqual(PlaybackTimeline.formatBehindLive(-12), "-12s behind")
        XCTAssertEqual(PlaybackTimeline.formatBehindLive(-65), "-1m 05s behind")
        XCTAssertEqual(PlaybackTimeline.formatDuration(12), "12s")
        XCTAssertEqual(PlaybackTimeline.formatDuration(3725), "1h 02m")
        XCTAssertEqual(PlaybackTimeline.formatDuration(.infinity), "0s")
    }
}
