package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test

class ArchiveMappingTest {
    @Test fun continuousUtcMapsToArchiveWithoutUsingLiveOffset() {
        val mapping = ArchiveMapping(durationMs = 180_000, utcStartMs = 1_000_000)
        assertEquals(ArchivePosition.Available(45_000), mapping.resolve(1_045_000))
    }
    @Test fun beforeArchiveDoesNotClampToZero() {
        assertEquals(ArchivePosition.Unmapped, ArchiveMapping(180_000, 1_000_000).resolve(999_999))
    }
    @Test fun archiveEndDoesNotReplayFromStart() {
        assertEquals(ArchivePosition.End, ArchiveMapping(180_000, 1_000_000).resolve(1_180_000))
    }
    @Test fun unknownUtcOrDurationNeverBecomesZero() {
        assertEquals(ArchivePosition.Unknown, ArchiveMapping(null, null).resolve(null))
        assertEquals(ArchivePosition.Unknown, ArchiveMapping(null, 1_000_000).resolve(1_045_000))
    }
    @Test fun editedArchiveMapsIncludedIntervalsAndRejectsRemovedBreak() {
        val mapping = ArchiveMapping(100_000, null, listOf(
            UtcInterval(1_010_000, 1_060_000, 0),
            UtcInterval(1_090_000, 1_140_000, 50_000),
        ))
        assertEquals(ArchivePosition.Available(70_000), mapping.resolve(1_110_000))
        assertEquals(ArchivePosition.Unmapped, mapping.resolve(1_075_000))
        assertEquals(ArchivePosition.End, mapping.resolve(1_140_000))
    }
    @Test(expected = IllegalArgumentException::class)
    fun overlappingUtcIntervalsAreRejected() {
        ArchiveMapping(100_000, null, listOf(UtcInterval(100, 200, 0), UtcInterval(150, 250, 100)))
    }
    @Test fun pausedHandoffSucceedsOnlyWithConfirmedPausedPosition() {
        val request = HandoffExpectation("archive", 40_000, playWhenReady = false)
        assertFalse(request.isConfirmed("archive", 40_000, isPlaying = true, isPaused = false, advancing = true))
        assertTrue(request.isConfirmed("archive", 40_500, isPlaying = false, isPaused = true, advancing = false))
        assertFalse(request.isConfirmed("other", 40_000, isPlaying = false, isPaused = true, advancing = false))
    }
    @Test fun playingHandoffRequiresAdvancingPlayback() {
        val request = HandoffExpectation("archive", 40_000, true)
        assertFalse(request.isConfirmed("archive", 40_000, true, false, false))
        assertTrue(request.isConfirmed("archive", 40_800, true, false, true))
        assertFalse(request.isConfirmed("archive", 41_001, true, false, true))
    }
}
