package com.playerlab.sportsstreaming.core

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class HandoffLedgerTest {
    @Test fun loadAcceptanceAloneRemainsPending() {
        val ledger = HandoffLedger()
        ledger.begin("SP-EVENT-S", "live-to-archive", "sports:SP-ARCH-S", 45_000, true, 1_000_000)
        val row = JSONObject(ledger.exportJson(1_000_100)).getJSONArray("records").getJSONObject(0)
        assertTrue(row.isNull("confirmed"))
        assertTrue(row.isNull("failure"))
        assertTrue(row.isNull("receiverQoe"))
    }
    @Test fun confirmedPausedIntentUsesRealStateAndPosition() {
        val ledger = HandoffLedger()
        val id = ledger.begin("SP-EVENT-S", "live-to-archive", "sports:SP-ARCH-S", 45_000, false, 1_000_000)
        assertFalse(ledger.observe(id, "sports:SP-ARCH-S", 45_000, true, false, true))
        assertTrue(ledger.observe(id, "sports:SP-ARCH-S", 45_500, false, true, false))
        val root = JSONObject(ledger.exportJson(1_000_100))
        assertEquals("local-device-records", root.getString("source"))
        val confirmed = root.getJSONArray("records").getJSONObject(0).getJSONObject("confirmed")
        assertFalse(confirmed.getBoolean("playWhenReady"))
        assertFalse(confirmed.getBoolean("positionAdvanced"))
        assertEquals(45_500, confirmed.getLong("positionMs"))
    }
    @Test fun wrongAssetOrNonAdvancingPlaybackNeverConfirmsSuccess() {
        val ledger = HandoffLedger()
        val id = ledger.begin("SP-EVENT-S", "cast", "sports:SP-CLIP-A", 10_000, true, 1_000_000)
        assertFalse(ledger.observe(id, "sports:SP-CLIP-B", 10_000, true, false, true))
        assertFalse(ledger.observe(id, "sports:SP-CLIP-A", 10_000, true, false, false))
        assertTrue(ledger.observe(id, "sports:SP-CLIP-A", 10_500, true, false, true))
    }
    @Test fun boundedExportDoesNotRetainEvictedRequests() {
        val ledger = HandoffLedger()
        val first = ledger.begin("SP-EVENT-S", "cast", "sports:SP-LIVE-S", 0, false, 1_000_000)
        repeat(200) { ledger.begin("SP-EVENT-S", "cast", "sports:SP-LIVE-S", 0, false, 1_000_001L + it) }
        assertEquals(200, JSONObject(ledger.exportJson(1_001_000)).getJSONArray("records").length())
        assertFalse(ledger.observe(first, "sports:SP-LIVE-S", 0, false, true, false))
    }
    @Test fun failureIsExplicitAndCannotReplacePreviouslyConfirmedSuccess() {
        val ledger = HandoffLedger()
        val id = ledger.begin("SP-EVENT-S", "cast", "sports:SP-ARCH-S", 10, false, 1_000_000)
        ledger.fail(id, HandoffFailure.DISCONNECTED)
        assertFalse(ledger.observe(id, "sports:SP-ARCH-S", 10, false, true, false))
        val row = JSONObject(ledger.exportJson(1_000_100)).getJSONArray("records").getJSONObject(0)
        assertEquals("disconnected", row.getString("failure"))
    }
    @Test fun unknownRequestedLiveEdgeIsExplicitNullAndCannotConfirmSuccess() {
        val ledger = HandoffLedger()
        val id = ledger.begin("SP-EVENT-S", "cast", "sports:SP-LIVE-S", null, true, 1_000_000)
        assertFalse(ledger.observe(id, "sports:SP-LIVE-S", 50_000, true, false, true))
        val row = JSONObject(ledger.exportJson(1_000_100)).getJSONArray("records").getJSONObject(0)
        assertTrue(row.getJSONObject("requested").isNull("positionMs"))
        assertTrue(row.isNull("confirmed"))
    }
    @Test fun targetPositionIsVerifiedBeforeLaterClockAdvancement() {
        val ledger = HandoffLedger()
        val id = ledger.begin("SP-EVENT-S", "live-to-archive", "sports:SP-ARCH-S", 45_000, true, 1_000_000)
        assertFalse(ledger.observe(id, "sports:SP-ARCH-S", 45_100, true, false, false))
        assertTrue(ledger.observe(id, "sports:SP-ARCH-S", 47_000, true, false, true))
        val row = JSONObject(ledger.exportJson(1_003_000)).getJSONArray("records").getJSONObject(0)
        assertEquals(45_100, row.getJSONObject("confirmed").getLong("positionMs"))
        assertTrue(row.getJSONObject("confirmed").getBoolean("positionAdvanced"))
    }
}
