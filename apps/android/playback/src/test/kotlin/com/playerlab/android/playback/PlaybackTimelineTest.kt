package com.playerlab.android.playback

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PlaybackTimelineTest {
    private val live = PlayerSnapshot(
        isLive = true, duration = Double.POSITIVE_INFINITY,
        maxTimeShift = -300.0, timeShift = 0.0, currentTime = 1000.0,
    )

    @Test fun clampToWindow() {
        assertEquals(-300.0, PlaybackTimeline.clampToWindow(-500.0, -300.0))
        assertEquals(-100.0, PlaybackTimeline.clampToWindow(-100.0, -300.0))
        assertEquals(0.0, PlaybackTimeline.clampToWindow(5.0, -300.0))      // positive → edge
        assertEquals(0.0, PlaybackTimeline.clampToWindow(-100.0, 0.0))      // no window → edge
        assertEquals(0.0, PlaybackTimeline.clampToWindow(Double.NaN, -300.0))
    }

    @Test fun liveEdge() {
        assertTrue(PlaybackTimeline.isAtLiveEdge(0.0))
        assertTrue(PlaybackTimeline.isAtLiveEdge(-0.5))
        assertFalse(PlaybackTimeline.isAtLiveEdge(-2.0))
        assertTrue(PlaybackTimeline.isAtLiveEdge(-2.0, epsilon = 3.0))
        assertFalse(PlaybackTimeline.isAtLiveEdge(Double.NaN))
    }

    @Test fun windowBehindProgress() {
        assertEquals(300.0, PlaybackTimeline.windowDuration(-300.0))
        assertEquals(0.0, PlaybackTimeline.windowDuration(0.0))
        assertEquals(60.0, PlaybackTimeline.behindLive(-60.0))
        assertEquals(0.0, PlaybackTimeline.behindLive(5.0))
        assertEquals(0.5, PlaybackTimeline.seekProgress(-150.0, -300.0))
        assertEquals(1.0, PlaybackTimeline.seekProgress(0.0, -300.0))
        assertEquals(1.0, PlaybackTimeline.seekProgress(0.0, 0.0))
    }

    @Test fun deriveState() {
        assertEquals(PlaybackMode.LIVE_DVR, PlaybackTimeline.deriveState(live, TimelineConfig(timeShiftEnabled = true)).mode)
        assertEquals(PlaybackMode.LIVE_NO_DVR, PlaybackTimeline.deriveState(live, TimelineConfig(timeShiftEnabled = false)).mode)
        assertFalse(PlaybackTimeline.deriveState(live.copy(maxTimeShift = 0.0), TimelineConfig(timeShiftEnabled = true)).dvrAvailable)
        val vod = PlayerSnapshot(false, 3600.0, 0.0, 0.0, 120.0)
        assertEquals(PlaybackMode.VOD, PlaybackTimeline.deriveState(vod, TimelineConfig(timeShiftEnabled = true)).mode)
    }

    @Test fun liveVodClassification() {
        assertTrue(PlaybackTimeline.isLiveStream(live))
        assertFalse(PlaybackTimeline.isLiveStream(live.copy(duration = 3600.0)))
        assertTrue(PlaybackTimeline.isLiveStream(live.copy(duration = 0.0)))
        assertTrue(PlaybackTimeline.detectLiveToVod(live, live.copy(duration = 3600.0)))
        assertFalse(PlaybackTimeline.detectLiveToVod(live, live))
    }

    @Test fun labels() {
        assertEquals("LIVE", PlaybackTimeline.formatBehindLive(0.0))
        assertEquals("-12s behind", PlaybackTimeline.formatBehindLive(-12.0))
        assertEquals("-1m 05s behind", PlaybackTimeline.formatBehindLive(-65.0))
        assertEquals("1h 02m", PlaybackTimeline.formatDuration(3725.0))
        assertEquals("0s", PlaybackTimeline.formatDuration(Double.POSITIVE_INFINITY))
    }
}
