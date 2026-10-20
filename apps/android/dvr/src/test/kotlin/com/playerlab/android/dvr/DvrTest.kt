package com.playerlab.android.dvr

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DvrTest {
    private val live = PlayerSnapshot(
        isLive = true, duration = Double.POSITIVE_INFINITY,
        maxTimeShift = -300.0, timeShift = 0.0, currentTime = 1000.0,
    )

    @Test fun clampToWindow() {
        assertEquals(-300.0, Dvr.clampToWindow(-500.0, -300.0))
        assertEquals(-100.0, Dvr.clampToWindow(-100.0, -300.0))
        assertEquals(0.0, Dvr.clampToWindow(5.0, -300.0))      // positive → edge
        assertEquals(0.0, Dvr.clampToWindow(-100.0, 0.0))      // no window → edge
        assertEquals(0.0, Dvr.clampToWindow(Double.NaN, -300.0))
    }

    @Test fun liveEdge() {
        assertTrue(Dvr.isAtLiveEdge(0.0))
        assertTrue(Dvr.isAtLiveEdge(-0.5))
        assertFalse(Dvr.isAtLiveEdge(-2.0))
        assertTrue(Dvr.isAtLiveEdge(-2.0, epsilon = 3.0))
        assertFalse(Dvr.isAtLiveEdge(Double.NaN))
    }

    @Test fun windowBehindProgress() {
        assertEquals(300.0, Dvr.windowDuration(-300.0))
        assertEquals(0.0, Dvr.windowDuration(0.0))
        assertEquals(60.0, Dvr.behindLive(-60.0))
        assertEquals(0.0, Dvr.behindLive(5.0))
        assertEquals(0.5, Dvr.seekProgress(-150.0, -300.0))
        assertEquals(1.0, Dvr.seekProgress(0.0, -300.0))
        assertEquals(1.0, Dvr.seekProgress(0.0, 0.0))
    }

    @Test fun deriveState() {
        assertEquals(PlaybackMode.LIVE_DVR, Dvr.deriveState(live, DvrConfig(timeShiftEnabled = true)).mode)
        assertEquals(PlaybackMode.LIVE_NO_DVR, Dvr.deriveState(live, DvrConfig(timeShiftEnabled = false)).mode)
        assertFalse(Dvr.deriveState(live.copy(maxTimeShift = 0.0), DvrConfig(timeShiftEnabled = true)).dvrAvailable)
        val vod = PlayerSnapshot(false, 3600.0, 0.0, 0.0, 120.0)
        assertEquals(PlaybackMode.VOD, Dvr.deriveState(vod, DvrConfig(timeShiftEnabled = true)).mode)
    }

    @Test fun liveVodClassification() {
        assertTrue(Dvr.isLiveStream(live))
        assertFalse(Dvr.isLiveStream(live.copy(duration = 3600.0)))
        assertTrue(Dvr.isLiveStream(live.copy(duration = 0.0)))
        assertTrue(Dvr.detectLiveToVod(live, live.copy(duration = 3600.0)))
        assertFalse(Dvr.detectLiveToVod(live, live))
    }

    @Test fun labels() {
        assertEquals("LIVE", Dvr.formatBehindLive(0.0))
        assertEquals("-12s behind", Dvr.formatBehindLive(-12.0))
        assertEquals("-1m 05s behind", Dvr.formatBehindLive(-65.0))
        assertEquals("1h 02m", Dvr.formatDuration(3725.0))
        assertEquals("0s", Dvr.formatDuration(Double.POSITIVE_INFINITY))
    }
}
