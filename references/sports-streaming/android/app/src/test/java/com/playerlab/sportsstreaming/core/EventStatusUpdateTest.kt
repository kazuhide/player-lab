package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test

class EventStatusUpdateTest {
    private val response = """{"id":"SP-EVENT-S","eventId":"SP-EVENT-S","status":"ended","archiveStatus":"ready",
       "liveAssetId":"SP-LIVE-S","archiveAssetId":"SP-ARCH-S","utcStartMs":1000000,
       "archiveMapping":{"assetId":"SP-ARCH-S","durationMs":180000,"utcStartMs":1000000,"utcMappings":[]},
       "observedAt":"2026-10-28T03:00:00Z"}"""
    @Test fun readyStatusCarriesOnlyVerifiedSameEventArchiveMapping() {
        val update = EventStatusParser.parse(response, "SP-EVENT-S", "SP-LIVE-S", "SP-ARCH-S")
        assertEquals(EventStatus.ENDED, update.eventStatus)
        assertEquals(ArchiveStatus.READY, update.archiveStatus)
        assertEquals(ArchivePosition.Available(45_000), update.archiveMapping!!.resolve(1_045_000))
    }
    @Test(expected = IllegalArgumentException::class)
    fun lateStatusFromOtherEventIsRejected() {
        EventStatusParser.parse(response, "SP-EVENT-30", "SP-LIVE-30", "SP-ARCH-30")
    }
    @Test(expected = IllegalArgumentException::class)
    fun anotherArchiveCannotReplaceChosenEventMapping() {
        EventStatusParser.parse(response.replace("\"assetId\":\"SP-ARCH-S\"", "\"assetId\":\"SP-ARCH-30\""),
            "SP-EVENT-S", "SP-LIVE-S", "SP-ARCH-S")
    }
    @Test fun unreadyStatusKeepsUnknownMapping() {
        val response = """{"id":"SP-EVENT-S","eventId":"SP-EVENT-S","status":"ended","archiveStatus":"processing",
          "liveAssetId":"SP-LIVE-S","archiveAssetId":"SP-ARCH-S","utcStartMs":null,"archiveMapping":null}"""
        val update = EventStatusParser.parse(response, "SP-EVENT-S", "SP-LIVE-S", "SP-ARCH-S")
        assertNull(update.archiveMapping)
        assertFalse(EventPlaybackState(update.eventStatus, update.archiveStatus).shouldInterruptLive)
    }
    @Test(expected = IllegalArgumentException::class)
    fun nonIntegerUtcDoesNotSilentlyBecomeAnEpoch() {
        EventStatusParser.parse(response.replace("1000000", "1000000.5"), "SP-EVENT-S", "SP-LIVE-S", "SP-ARCH-S")
    }
    @Test fun originalReturnRequiresVerifiedCurrentSeekableBounds() {
        val text = response.replace("\"observedAt\"", "\"seekableUtcStartMs\":1010000,\"seekableUtcEndMs\":1180000,\"observedAt\"")
        val update = EventStatusParser.parse(text, "SP-EVENT-S", "SP-LIVE-S", "SP-ARCH-S")
        assertTrue(update.containsSeekableUtc(1_045_000))
        assertFalse(update.containsSeekableUtc(1_000_000))
        assertFalse(update.containsSeekableUtc(1_180_000))
        assertFalse(EventStatusParser.parse(response, "SP-EVENT-S", "SP-LIVE-S", "SP-ARCH-S").containsSeekableUtc(1_045_000))
    }
}
