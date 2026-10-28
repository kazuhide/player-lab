package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test

class SourceUtcClockTest {
    private val origin = 1_790_000_000_000L
    private fun sample(position: Double, live: Boolean = true, offset: Double = origin / 1_000.0,
                       tick: Long = 1_000, destination: String = "local", token: String = "source") =
        UtcClockSample(token, destination, position, offset, live, origin, tick)

    @Test fun finalizedPausedSourceKeepsItsVerifiedTransformWithFreshRelativePosition() {
        val clock = SourceUtcClock("source")
        assertEquals(origin + 1_771_542, clock.read(sample(1_771.542)))
        assertEquals(origin + 1_771_542, clock.read(sample(1_771.542, live = false, offset = 0.0, tick = 1_250)))
        assertEquals(origin + 1_775_000, clock.read(sample(1_775.0, live = false, offset = Double.NaN, tick = 4_750)))
    }
    @Test fun finalizationCannotGuessARebasedRelativeTimeline() {
        val clock = SourceUtcClock("source")
        clock.read(sample(1_771.542))
        assertNull(clock.read(sample(0.0, live = false, offset = 0.0, tick = 1_250)))
        assertNull(clock.read(sample(1_771.542, live = false, offset = 0.0, tick = 1_500)))
    }
    @Test fun aNewSourceOrDestinationCannotInheritThePreviousTransform() {
        val clock = SourceUtcClock("source")
        clock.read(sample(45.0))
        assertNull(clock.read(sample(45.0, live = false, offset = 0.0, destination = "cast:receiver")))
        assertNull(SourceUtcClock("retry").read(sample(45.0, live = false, offset = 0.0, token = "retry")))
        assertNull(clock.read(sample(45.0, token = "previous-source")))
    }
    @Test fun lossOfTheAbsoluteOffsetWhileStillLiveDoesNotBecomeAClockGuess() {
        val clock = SourceUtcClock("source")
        clock.read(sample(45.0))
        assertNull(clock.read(sample(45.0, offset = Double.NaN)))
        assertNull(clock.read(sample(45.0).copy(verifiedUtcStartMs = null)))
    }
    @Test fun finalizedSdkSeekCannotAssumeTheOldLiveCoordinateOrigin() {
        val clock = SourceUtcClock("source")
        clock.read(sample(1_771.542))
        clock.read(sample(1_771.542, live = false, offset = 0.0, tick = 1_250))
        clock.invalidateAfterUnmappedSeek()
        assertNull(clock.read(sample(15.0, live = false, offset = 0.0, tick = 1_500)))
    }
    @Test fun anUnobservedBackgroundIntervalCannotProveCoordinateContinuity() {
        val clock = SourceUtcClock("source")
        clock.read(sample(45.0))
        assertNull(clock.read(sample(0.0, live = false, offset = 0.0, tick = 61_000)))
        val other = SourceUtcClock("source")
        other.read(sample(45.0, destination = "local:1"))
        assertNull(other.read(sample(45.0, live = false, offset = 0.0, destination = "local:2")))
    }
    @Test fun dashUnixToRelativeFinalizationUsesBothOffsetsFromTheSameLiveSnapshot() {
        val clock = SourceUtcClock("source")
        val epochSeconds = origin / 1_000.0
        assertEquals(origin + 107_741, clock.read(sample(epochSeconds + 107.741, offset = 0.0)
            .copy(relativeOffsetSeconds = -epochSeconds)))
        assertEquals(origin + 107_742, clock.read(sample(107.742, live = false, offset = 0.0, tick = 1_250)))
    }
    @Test fun receiverClockOutsideTheVerifiedEventCannotPretendToBeItsAuthoredUtc() {
        val actualOrigin = 1_793_163_588_000L
        val value = UtcClockSample("source", "cast:receiver:1", 39.130, 1_793_189_858.202, true,
            actualOrigin, 1_000, verifiedUtcEndMs = actualOrigin + 1_800_000)
        assertNull(SourceUtcClock("source").read(value))
    }
    @Test fun aRetainedFinalizedClockCannotEscapeTheVerifiedEventEnd() {
        val clock = SourceUtcClock("source")
        assertEquals(origin + 45_000, clock.read(sample(45.0).copy(verifiedUtcEndMs = origin + 60_000)))
        assertEquals(origin + 45_000, clock.read(sample(45.0, false, 0.0, 1_250).copy(verifiedUtcEndMs = origin + 60_000)))
        assertNull(clock.read(sample(61.0, false, 0.0, 17_000).copy(verifiedUtcEndMs = origin + 60_000)))
    }
}
