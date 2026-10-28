package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test

class ArchiveContinuationTest {
    private val request = PlaybackRequest(3, "live", "local")
    private val full = ArchiveMapping(120_000, 1_000_000)
    private val edited = ArchiveMapping(60_000, null, listOf(UtcInterval(1_030_000, 1_090_000, 0)))
    @Test fun pausedFullToEditedSelectionUsesTheNewMappingImmediately() {
        val reading = { SourceUtcReading(request, true, 1_045_000) }
        assertEquals(ArchivePosition.Available(45_000), ArchiveContinuation.resolve(full, request, reading))
        assertEquals(ArchivePosition.Available(15_000), ArchiveContinuation.resolve(edited, request, reading))
    }
    @Test fun aDeletedIntervalCannotReuseThePreviouslyAvailablePosition() {
        val reading = { SourceUtcReading(request, true, 1_015_000) }
        assertEquals(ArchivePosition.Available(15_000), ArchiveContinuation.resolve(full, request, reading))
        assertEquals(ArchivePosition.Unmapped, ArchiveContinuation.resolve(edited, request, reading))
    }
    @Test fun dispatchReadsTheCurrentSdkClockRatherThanAPreviousPreview() {
        var utc = 1_045_000L
        val reading = { SourceUtcReading(request, true, utc) }
        assertEquals(ArchivePosition.Available(15_000), ArchiveContinuation.resolve(edited, request, reading))
        utc = 1_065_000
        assertEquals(ArchivePosition.Available(35_000), ArchiveContinuation.resolve(edited, request, reading))
    }
    @Test fun replacedSourceAndStaleRequestCannotProvideTheHandoffPosition() {
        assertEquals(ArchivePosition.Unknown, ArchiveContinuation.resolve(full, request) { SourceUtcReading(request, false, 1_045_000) })
        assertEquals(ArchivePosition.Unknown, ArchiveContinuation.resolve(full, request) {
            SourceUtcReading(request.copy(generation = 4), true, 1_045_000)
        })
        assertEquals(ArchivePosition.Unknown, ArchiveContinuation.resolve(full, null) { SourceUtcReading(null, true, 1_045_000) })
    }
}
