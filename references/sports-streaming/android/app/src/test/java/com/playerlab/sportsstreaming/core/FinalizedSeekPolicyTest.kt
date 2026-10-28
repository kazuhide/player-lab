package com.playerlab.sportsstreaming.core

import com.playerlab.sportsstreaming.PlaybackUiState
import org.junit.Assert.*
import org.junit.Test

class FinalizedSeekPolicyTest {
    @Test fun finalizedLiveSourceCannotSilentlyClampRelativeJumpsIntoItsNewVodWindow() {
        fun asset(id: String, kind: AssetKind) = MediaAsset(id, "event", "sports:$id", id, null, kind,
            mapOf(StreamProtocol.HLS to "https://media.example.invalid/$id.m3u8"), emptyList(),
            if (kind == AssetKind.ARCHIVE) 180_000 else null, null, emptyList())
        val catalog = SportsCatalog(listOf(SportsEvent("event", "Event", null, EventStatus.ENDED, ArchiveStatus.READY,
            "live", "archive", null)), listOf(asset("live", AssetKind.LIVE), asset("archive", AssetKind.ARCHIVE)))
        val held = PlaybackUiState(catalog = catalog, selectedEventId = "event", activeAssetId = "live", loadingSource = false,
            isLive = false, isPaused = true, positionMs = 107_742, durationMs = 59_999)
        assertTrue("Play/pause and explicit recovery must remain available", held.canControlPlayback)
        assertFalse(held.canSeekBack)
        assertFalse(held.canSeekForward)
        val archive = held.copy(activeAssetId = "archive", durationMs = 180_000)
        assertTrue(archive.canSeekBack)
        assertTrue(archive.canSeekForward)
        val live = held.copy(isLive = true, earliestTimeShiftSeconds = -56.0, timeShiftSeconds = -30.0, durationMs = null)
        assertTrue(live.canSeekBack)
        assertTrue(live.canSeekForward)
    }
}
