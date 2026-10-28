package com.playerlab.elearning

import org.junit.Assert.*
import org.junit.Test

class PlaybackCheckpointTest {
    @Test fun selectedOffsetSurvivesUnavailableAndLoadingClocks() {
        val checkpoint = PlaybackCheckpoint(754_000)
        checkpoint.sample(0.0, 780.0)
        checkpoint.sample(Double.NaN, 780.0)
        assertEquals(754_000L, checkpoint.positionMs)
    }

    @Test fun fatalResetPreservesTheLastUsableClock() {
        val checkpoint = PlaybackCheckpoint(0)
        checkpoint.ready()
        checkpoint.sample(754.25, 780.0)
        checkpoint.unavailable()
        checkpoint.sample(0.0, 780.0)
        assertEquals(754_250L, checkpoint.positionMs)
    }

    @Test fun readyClockAcceptsACompletedSeekToZero() {
        val checkpoint = PlaybackCheckpoint(754_000)
        checkpoint.ready()
        checkpoint.sample(0.0, 780.0)
        assertEquals(0L, checkpoint.positionMs)
    }

    @Test fun invalidClockOrDurationCannotReplaceAUsablePosition() {
        val checkpoint = PlaybackCheckpoint(754_000)
        checkpoint.ready()
        listOf(Double.NaN, Double.POSITIVE_INFINITY, -1.0, 781.0).forEach { checkpoint.sample(it, 780.0) }
        listOf(Double.NaN, Double.POSITIVE_INFINITY, 0.0, -1.0).forEach { checkpoint.sample(0.0, it) }
        assertEquals(754_000L, checkpoint.positionMs)
    }
}
