import XCTest
@testable import DvrKit

final class DvrTests: XCTestCase {
    private let live = PlayerSnapshot(
        isLive: true, duration: .infinity, maxTimeShift: -300, timeShift: 0, currentTime: 1000
    )

    func testClampToWindow() {
        XCTAssertEqual(Dvr.clampToWindow(-500, maxTimeShift: -300), -300)
        XCTAssertEqual(Dvr.clampToWindow(-100, maxTimeShift: -300), -100)
        XCTAssertEqual(Dvr.clampToWindow(5, maxTimeShift: -300), 0)        // positive → edge
        XCTAssertEqual(Dvr.clampToWindow(-100, maxTimeShift: 0), 0)        // no window → edge
        XCTAssertEqual(Dvr.clampToWindow(.nan, maxTimeShift: -300), 0)     // NaN → edge
    }

    func testIsAtLiveEdge() {
        XCTAssertTrue(Dvr.isAtLiveEdge(0))
        XCTAssertTrue(Dvr.isAtLiveEdge(-0.5))
        XCTAssertFalse(Dvr.isAtLiveEdge(-2))
        XCTAssertTrue(Dvr.isAtLiveEdge(-2, epsilon: 3))
        XCTAssertFalse(Dvr.isAtLiveEdge(.nan))
    }

    func testWindowBehindProgress() {
        XCTAssertEqual(Dvr.windowDuration(-300), 300)
        XCTAssertEqual(Dvr.windowDuration(0), 0)
        XCTAssertEqual(Dvr.behindLive(-60), 60)
        XCTAssertEqual(Dvr.behindLive(5), 0)
        XCTAssertEqual(Dvr.seekProgress(-150, maxTimeShift: -300), 0.5)
        XCTAssertEqual(Dvr.seekProgress(0, maxTimeShift: -300), 1)
        XCTAssertEqual(Dvr.seekProgress(0, maxTimeShift: 0), 1)
    }

    func testDeriveState() {
        let dvr = Dvr.deriveState(live, config: DvrConfig(timeShiftEnabled: true))
        XCTAssertEqual(dvr.mode, .liveDvr)
        XCTAssertTrue(dvr.dvrAvailable)
        XCTAssertTrue(dvr.atLiveEdge)
        XCTAssertEqual(dvr.windowDuration, 300)

        XCTAssertEqual(Dvr.deriveState(live, config: DvrConfig(timeShiftEnabled: false)).mode, .liveNoDvr)

        let unsettled = PlayerSnapshot(isLive: true, duration: .infinity, maxTimeShift: 0, timeShift: 0, currentTime: 0)
        XCTAssertFalse(Dvr.deriveState(unsettled, config: DvrConfig(timeShiftEnabled: true)).dvrAvailable)

        let vod = PlayerSnapshot(isLive: false, duration: 3600, maxTimeShift: 0, timeShift: 0, currentTime: 120)
        XCTAssertEqual(Dvr.deriveState(vod, config: DvrConfig(timeShiftEnabled: true)).mode, .vod)
    }

    func testLiveVodClassification() {
        XCTAssertTrue(Dvr.isLiveStream(live))
        XCTAssertFalse(Dvr.isLiveStream(PlayerSnapshot(isLive: true, duration: 3600, maxTimeShift: 0, timeShift: 0, currentTime: 0)))
        XCTAssertTrue(Dvr.isLiveStream(PlayerSnapshot(isLive: true, duration: 0, maxTimeShift: 0, timeShift: 0, currentTime: 0)))
        let vod = PlayerSnapshot(isLive: false, duration: 3600, maxTimeShift: 0, timeShift: 0, currentTime: 0)
        XCTAssertTrue(Dvr.detectLiveToVod(prev: live, next: vod))
        XCTAssertFalse(Dvr.detectLiveToVod(prev: live, next: live))
    }

    func testCompletedLiveSourceKeepsNativeTimingButDisablesLiveCommandsDuringReplay() {
        let ended = PlayerSnapshot(isLive: true, duration: .infinity, maxTimeShift: -60,
                                   timeShift: -10, currentTime: 1060, liveSourceFinalized: true)
        let state = Dvr.deriveState(ended, config: DvrConfig(timeShiftEnabled: true))
        XCTAssertEqual(state.mode, .endedLive)
        XCTAssertFalse(state.isLive)
        XCTAssertFalse(state.dvrAvailable)
        XCTAssertFalse(state.atLiveEdge)
        XCTAssertEqual(state.windowDuration, 0)
        XCTAssertEqual(state.behindLive, 0)
        XCTAssertTrue(ended.isLive)
        XCTAssertTrue(ended.duration.isInfinite)
        XCTAssertFalse(Dvr.detectLiveToVod(prev: live, next: ended))
        XCTAssertEqual(Dvr.deriveState(live, config: DvrConfig(timeShiftEnabled: true)).mode, .liveDvr)
        let finite = PlayerSnapshot(isLive: false, duration: 60, maxTimeShift: 0,
                                    timeShift: 0, currentTime: 60, liveSourceFinalized: true)
        XCTAssertEqual(Dvr.deriveState(finite, config: DvrConfig(timeShiftEnabled: true)).mode, .vod)
    }

    func testLabels() {
        XCTAssertEqual(Dvr.formatBehindLive(0), "LIVE")
        XCTAssertEqual(Dvr.formatBehindLive(-0.5), "LIVE")
        XCTAssertEqual(Dvr.formatBehindLive(-12), "-12s behind")
        XCTAssertEqual(Dvr.formatBehindLive(-65), "-1m 05s behind")
        XCTAssertEqual(Dvr.formatDuration(12), "12s")
        XCTAssertEqual(Dvr.formatDuration(3725), "1h 02m")
        XCTAssertEqual(Dvr.formatDuration(.infinity), "0s")
    }
}
