package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test

class ReceiverPositionTest {
    private val request = PlaybackRequest(5, "SP-LIVE-EVENT", "cast:receiver")
    private val origin = 1_793_163_588_000L
    @Test fun liveUtcComesFromTheBoundSdkAxisWithoutAddingItsOffsetToCafTime() {
        val result = ReceiverPosition.resolve(AssetKind.LIVE, 24_696_272,
            SourceUtcReading(request, true, origin + 81_968), request, origin)
        assertEquals(81_968L, result.sourcePositionMs)
        assertEquals(origin + 81_968, result.viewedUtcMs)
    }
    @Test fun unknownOrStaleSdkUtcCannotBeReplacedWithRawCafPosition() {
        for (reading in listOf(SourceUtcReading(request, true, null), SourceUtcReading(request, false, origin + 10),
            SourceUtcReading(request.copy(generation = 4), true, origin + 10))) {
            val result = ReceiverPosition.resolve(AssetKind.LIVE, 24_696_272, reading, request, origin)
            assertNull(result.sourcePositionMs); assertNull(result.viewedUtcMs)
        }
    }
    @Test fun preparedVodKeepsItsActualCafPositionWithoutAClockOffset() {
        val result = ReceiverPosition.resolve(AssetKind.ARCHIVE, 45_000, SourceUtcReading(null, false, null), request, null)
        assertEquals(45_000L, result.sourcePositionMs); assertNull(result.viewedUtcMs)
    }
}
