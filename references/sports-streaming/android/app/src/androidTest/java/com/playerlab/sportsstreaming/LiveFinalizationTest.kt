package com.playerlab.sportsstreaming

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import com.bitmovin.player.api.source.Source
import com.playerlab.sportsstreaming.core.*
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs
import kotlin.math.roundToLong

/** Real short-event finalization; it does not qualify a normal-event endurance run. */
@RunWith(AndroidJUnit4::class)
class LiveFinalizationTest {
    @Test fun endedSourceRetainsUtcAndDispatchesTheCurrentEditedArchiveMapping() {
        val args = InstrumentationRegistry.getArguments()
        val protocol = StreamProtocol.valueOf(args.getString("protocol", "HLS").uppercase())
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra("mediaBaseUrl", requireNotNull(args.getString("mediaBaseUrl")))
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            var loadedListener: ((SourceEvent.Loaded) -> Unit)? = null
            var readyListener: ((PlayerEvent.Ready) -> Unit)? = null
            try {
                waitUntil(scenario) { it.state.value.catalog != null && !it.state.value.loadingCatalog }
                lateinit var eventId: String
                lateinit var liveId: String
                lateinit var archiveId: String
                lateinit var statusUrl: String
                var origin = 0L
                var durationMs = 0L
                var sdkReadyObserved = false
                var loadedObserved = false
                scenario.onActivity {
                    val session = it.playbackForTest()
                    val catalog = requireNotNull(session.state.value.catalog)
                    val live = requireNotNull(catalog.asset("SP-LIVE-S"))
                    val event = requireNotNull(catalog.event(live.eventId))
                    assertEquals("Start a fresh short event", EventStatus.LIVE, event.status)
                    eventId = event.id; liveId = live.id; archiveId = requireNotNull(event.archiveAssetId)
                    statusUrl = requireNotNull(event.statusUrl); origin = requireNotNull(live.utcStartMs)
                    durationMs = requireNotNull(catalog.asset(archiveId)?.durationMs)
                    assertTrue(durationMs in 120_000..240_000)
                    val loaded: (SourceEvent.Loaded) -> Unit = { eventLoaded ->
                        if (eventLoaded.source === session.player.source) {
                            loadedObserved = true
                            if (!sdkReadyObserved) assertFalse("Loaded metadata alone must not enable commands", session.state.value.canControlPlayback)
                        }
                    }
                    val ready: (PlayerEvent.Ready) -> Unit = { sdkReadyObserved = true }
                    loadedListener = loaded; readyListener = ready
                    session.player.on(SourceEvent.Loaded::class, loaded)
                    session.player.on(PlayerEvent.Ready::class, ready)
                    session.selectAsset(liveId, protocol)
                }
                waitUntil(scenario) { loadedObserved && sdkReadyObserved && it.state.value.canControlPlayback && it.player.isPlaying && it.player.isLive }
                val repository = CatalogRepository(InstrumentationRegistry.getInstrumentation().targetContext)
                fun status() = EventStatusParser.parse(runBlocking { repository.status(statusUrl) }, eventId, liveId, archiveId)
                assertTrue("Start while the short event is still young", requireNotNull(status().seekableUtcEndMs) - origin < 60_000)
                while (requireNotNull(status().seekableUtcEndMs) - origin < durationMs - 12_000) Thread.sleep(500)
                var shifted = false
                lateinit var heldSource: Source
                lateinit var heldRequest: PlaybackRequest
                lateinit var held: OwnershipSnapshot
                lateinit var session: PlaybackSession
                val shiftedListener: (PlayerEvent.TimeShifted) -> Unit = {
                    if (session.player.source === heldSource && session.coordinator.current == heldRequest) shifted = true
                }
                scenario.onActivity {
                    session = it.playbackForTest(); heldSource = requireNotNull(session.player.source)
                    heldRequest = requireNotNull(session.coordinator.current)
                    session.player.on(PlayerEvent.TimeShifted::class, shiftedListener)
                    session.seekBy(-15.0)
                }
                try { waitUntil(scenario) { shifted && it.player.source === heldSource && it.player.timeShift <= -10.0 } }
                finally { scenario.onActivity { it.playbackForTest().player.off(PlayerEvent.TimeShifted::class, shiftedListener) } }
                scenario.onActivity { it.playbackForTest().player.pause() }
                waitUntil(scenario) { it.player.isPaused && !it.player.isPlaying }
                var heldUtc = 0L
                var heldRelativeSeconds = 0.0
                var heldUtcRelativeOriginSeconds = 0.0
                scenario.onActivity {
                    held = it.playbackForTest().snapshot(); assertNotNull(held.impressionId)
                    val absoluteOffset = it.playbackForTest().player.playbackTimeOffsetToAbsoluteTime
                    val relativeOffset = it.playbackForTest().player.playbackTimeOffsetToRelativeTime
                    val absolute = (held.positionSeconds + absoluteOffset) * 1_000.0
                    assertTrue("Independent reference must be the live SDK timestamp", absolute.isFinite() && absolute >= origin)
                    heldUtc = absolute.roundToLong()
                    heldRelativeSeconds = held.positionSeconds + relativeOffset
                    heldUtcRelativeOriginSeconds = absoluteOffset - relativeOffset
                    SdkClockSnapshot.capture(it.playbackForTest(), "short-before")
                }
                var sawProcessing = false
                val deadline = SystemClock.elapsedRealtime() + 45_000
                while (SystemClock.elapsedRealtime() < deadline) {
                    val observed = status()
                    if (observed.eventStatus == EventStatus.ENDED) {
                        if (observed.archiveStatus == ArchiveStatus.PROCESSING) sawProcessing = true
                        if (observed.archiveStatus == ArchiveStatus.READY) break
                    }
                    Thread.sleep(250)
                }
                assertTrue("Event end and archive preparation must be distinct", sawProcessing)
                waitUntil(scenario) { !it.player.isLive && it.state.value.selectedEvent?.archiveStatus == ArchiveStatus.READY }
                scenario.onActivity {
                    val current = it.playbackForTest()
                    SdkClockSnapshot.capture(current, "short-after")
                    assertSame(heldSource, current.player.source); assertEquals(heldRequest, current.coordinator.current)
                    assertEquals(held.impressionId, current.snapshot().impressionId)
                    assertTrue(current.player.isPaused && !current.player.isPlaying)
                    val relativeNow = current.player.currentTime + current.player.playbackTimeOffsetToRelativeTime
                    assertEquals("The SDK-relative coordinate must remain continuous", heldRelativeSeconds, relativeNow, 1.0)
                    if (protocol == StreamProtocol.HLS)
                        assertEquals("The observed HLS raw coordinate must remain continuous", held.positionSeconds, current.player.currentTime, 1.0)
                    assertEquals("The independent same-snapshot offset transform must preserve UTC", heldUtc.toDouble(),
                        (relativeNow + heldUtcRelativeOriginSeconds) * 1_000.0, 1_000.0)
                    assertEquals("Fresh mapped UTC must retain the independently held position", heldUtc.toDouble(), requireNotNull(current.viewedUtcForCurrentSource()).toDouble(), 1_000.0)
                }
                waitUntil(scenario) { (it.state.value.archivePosition as? ArchivePosition.Available)?.positionMs?.let { value ->
                    abs(value - (heldUtc - origin)) < 600 } == true }
                val expectedEditedMs = heldUtc - origin - 60_000
                assertTrue("The held point must belong to the fixture's second retained edit", expectedEditedMs in 60_000..120_000)
                scenario.onActivity {
                    val current = it.playbackForTest()
                    current.setArchiveTarget("SP-ARCH-E")
                    current.continueInArchive()
                }
                waitUntil(scenario) { it.state.value.activeAssetId == "SP-ARCH-E" && it.state.value.canControlPlayback &&
                    !it.desiredPlaying && !it.player.isPlaying && abs(it.player.currentTime * 1_000 - expectedEditedMs) < 600 }
                Thread.sleep(1_000)
                scenario.onActivity {
                    assertFalse(it.playbackForTest().player.isPlaying)
                    assertFalse(it.playbackForTest().desiredPlaying)
                    assertEquals(expectedEditedMs.toDouble(), it.playbackForTest().player.currentTime * 1_000, 600.0)
                    val records = JSONObject(it.playbackForTest().handoffs.exportJson()).getJSONArray("records")
                    val confirmed = records.getJSONObject(records.length() - 1).getJSONObject("confirmed")
                    assertFalse("The observed archive handoff must preserve non-playing intent", confirmed.getBoolean("playWhenReady"))
                    assertEquals("sports:SP-ARCH-E", confirmed.getString("videoId"))
                    SdkClockSnapshot.capture(it.playbackForTest(), "short-archive-ready")
                    assertNotSame(heldSource, it.playbackForTest().player.source)
                    val impression = it.playbackForTest().snapshot().impressionId
                    assertNotNull("Paused archive load must establish its actual impression", impression)
                    assertNotEquals(held.impressionId, impression)
                    it.playbackForTest().player.play()
                }
                waitUntil(scenario) { it.player.isPlaying && it.player.currentTime * 1_000 > expectedEditedMs + 500 }
                scenario.onActivity {
                    val impression = it.playbackForTest().snapshot().impressionId
                    assertNotNull(impression); assertNotEquals(held.impressionId, impression)
                }
                InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply {
                    putString("finalizationResult", JSONObject().put("protocol", protocol.name).put("status", "passed")
                        .put("heldUtcMs", heldUtc).put("heldRawSeconds", held.positionSeconds)
                        .put("processingObserved", sawProcessing).put("editedStartMs", expectedEditedMs).toString())
                })
            } finally {
                scenario.onActivity {
                    loadedListener?.let { callback -> it.playbackForTest().player.off(SourceEvent.Loaded::class, callback) }
                    readyListener?.let { callback -> it.playbackForTest().player.off(PlayerEvent.Ready::class, callback) }
                    it.playbackForTest().player.pause()
                }
            }
        }
    }
    private fun waitUntil(scenario: ActivityScenario<MainActivity>, condition: (PlaybackSession) -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 45_000
        while (SystemClock.elapsedRealtime() < deadline) {
            var ready = false
            scenario.onActivity { assertNull(it.playbackForTest().lastErrorCode); assertFalse(it.playbackForTest().state.value.sourceFailed); ready = condition(it.playbackForTest()) }
            if (ready) return
            Thread.sleep(100)
        }
        var observed = ""
        scenario.onActivity {
            val session = it.playbackForTest(); val state = session.state.value
            observed = "asset=${state.activeAssetId},loading=${state.loadingSource},failed=${state.sourceFailed}," +
                "sdkPlaying=${session.player.isPlaying},sdkPaused=${session.player.isPaused}," +
                "position=${session.player.currentTime},desiredPlaying=${session.desiredPlaying}," +
                "archiveTarget=${state.archiveTargetId},archivePosition=${state.archivePosition}," +
                "request=${session.coordinator.current?.generation},sourceActive=${session.player.source?.isActive}"
        }
        fail("Required short-event SDK state was not observed: $observed")
    }
}
