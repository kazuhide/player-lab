package com.playerlab.sportsstreaming

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.fragment.app.DialogFragment
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.playerlab.sportsstreaming.core.ArchiveStatus
import com.playerlab.sportsstreaming.core.AssetKind
import com.playerlab.sportsstreaming.core.StreamProtocol
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.source.Source
import com.playerlab.sportsstreaming.core.PlaybackRequest
import com.playerlab.sportsstreaming.core.ArchivePosition
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Explicit opt-in: this test selects only the receiverName passed by the device owner. */
@RunWith(AndroidJUnit4::class)
class CastPlaybackTest {
    @Test fun receiverReportsClipLiveArchiveAndPausedState() {
        runReceiverSequence(unknownMappingRecovery = false)
    }
    internal fun runReceiverSequence(unknownMappingRecovery: Boolean) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val arguments = InstrumentationRegistry.getArguments()
        val receiver = requireNotNull(arguments.getString("receiverName")) { "Explicit authorized receiverName is required" }
        require(receiver.isNotBlank())
        val base = requireNotNull(arguments.getString("mediaBaseUrl")) { "A receiver-reachable mediaBaseUrl is required" }
        val protocol = StreamProtocol.valueOf(arguments.getString("protocol", "HLS").uppercase())
        val vodOnly = arguments.getString("vodOnly", "false").toBooleanStrict()
        require(!unknownMappingRecovery || !vodOnly)
        instrumentation.sendStatus(0, Bundle().apply { putString("castQualificationScope",
            if (unknownMappingRecovery) "unknown-utc-explicit-recovery" else if (vodOnly) "prepared-vod-only" else "live-dvr-and-vod") })
        val clipA = arguments.getString("clipAssetId", "SP-CLIP-A")
        val clipB = arguments.getString("secondClipAssetId", "SP-CLIP-B")
        val live = if (unknownMappingRecovery) "SP-LIVE-S" else arguments.getString("liveAssetId", "SP-LIVE-EVENT")
        val archive = arguments.getString("archiveAssetId", "SP-ARCH-S")
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java).putExtra("mediaBaseUrl", base)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            var heldUnknownSource: Source? = null
            var heldUnknownLoadCount = -1
            var changedKeepScreenOn = false
            try {
                waitUntil(scenario, 30_000) { !it.playbackForTest().state.value.loadingCatalog && it.playbackForTest().state.value.catalog != null }
                if (unknownMappingRecovery) {
                    var statusUrl = ""
                    scenario.onActivity {
                        changedKeepScreenOn = it.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON == 0
                        if (changedKeepScreenOn) it.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        val catalog = requireNotNull(it.playbackForTest().state.value.catalog)
                        statusUrl = requireNotNull(catalog.event(catalog.asset(live)?.eventId)?.statusUrl)
                    }
                    val repository = CatalogRepository(instrumentation.targetContext)
                    val deadline = System.nanoTime() + 120_000_000_000L
                    while (true) {
                        val status = JSONObject(runBlocking { repository.status(statusUrl) })
                        assertEquals("live", status.getString("status"))
                        if (!status.isNull("seekableUtcStartMs") && !status.isNull("seekableUtcEndMs") &&
                            status.getLong("seekableUtcEndMs") - status.getLong("seekableUtcStartMs") >= 58_000) break
                        assertTrue("The receiver needs an actually published DVR window before loading", System.nanoTime() < deadline)
                        Thread.sleep(500)
                    }
                }
                scenario.onActivity { activity ->
                    val state = activity.playbackForTest().state.value
                    if (activity.playbackForTest().player.isCasting) assertEquals("Existing receiver is not authorized", receiver, state.castName)
                    activity.playbackForTest().selectAsset(clipA, protocol)
                }
                waitUntil(scenario) { it.playbackForTest().state.value.canControlPlayback && it.playbackForTest().player.isPlaying }
                var actualPaused = false
                var pausedPositionMs = 0L
                lateinit var initialSession: PlaybackSession
                val pausedListener: (PlayerEvent.Paused) -> Unit = { actualPaused = true }
                scenario.onActivity {
                    initialSession = it.playbackForTest()
                    initialSession.player.on(PlayerEvent.Paused::class, pausedListener)
                    initialSession.player.pause()
                }
                try {
                    waitUntil(scenario) { actualPaused && it.playbackForTest().player.isPaused && !it.playbackForTest().player.isPlaying }
                    scenario.onActivity { pausedPositionMs = (it.playbackForTest().player.currentTime * 1_000).toLong() }
                } finally { scenario.onActivity { it.playbackForTest().player.off(PlayerEvent.Paused::class, pausedListener) } }
                reportDiagnostics(scenario, receiver)
                scenario.onActivity {
                    assertTrue("Remote control must be enabled", it.playbackForTest().player.config.remoteControlConfig.isCastEnabled)
                    assertTrue("CastContext setup failed; inspect bounded diagnostics", it.playbackForTest().player.isCastAvailable)
                }
                var alreadyCasting = false
                scenario.onActivity {
                    alreadyCasting = it.playbackForTest().player.isCasting
                    if (!alreadyCasting) it.playbackForTest().toggleCasting()
                }
                if (!alreadyCasting) {
                    waitUntil(scenario, 5_000) { activity ->
                        activity.supportFragmentManager.fragments.any { (it as? DialogFragment)?.dialog?.isShowing == true }
                    }
                    reportDiagnostics(scenario, receiver)
                    val device = UiDevice.getInstance(instrumentation)
                    val exact = device.wait(Until.findObject(By.text(receiver)), 20_000)
                    assertNotNull("Authorized receiver was not found; no other receiver will be selected", exact)
                    exact.click()
                }
                waitUntil(scenario, 60_000) {
                    val session = it.playbackForTest()
                    val proof = session.receiverEvidenceForTest()
                    session.player.isCasting && session.state.value.castName == receiver && proof.assetId == clipA &&
                        proof.mediaSessionId != null && proof.paused == true && proof.playing == false &&
                        proof.positionMs?.let { position -> kotlin.math.abs(position - pausedPositionMs) <= 1_000 } == true
                }
                scenario.onActivity { it.playbackForTest().player.play() }
                waitForReceiver(scenario, clipA, receiver)
                var previousLoadId: Long? = null
                scenario.onActivity {
                    previousLoadId = it.playbackForTest().receiverEvidenceForTest().mediaSessionId
                    assertNotNull("Receiver confirmation needs its actual media-session identity", previousLoadId)
                    it.playbackForTest().selectAsset(clipA, protocol)
                }
                waitForReceiver(scenario, clipA, receiver)
                scenario.onActivity {
                    val current = it.playbackForTest().receiverEvidenceForTest().mediaSessionId
                    assertNotNull(current)
                    assertNotEquals("Same-URL selection must confirm a new actual receiver load", previousLoadId, current)
                    previousLoadId = current
                    it.playbackForTest().selectAsset(clipB, protocol)
                    it.playbackForTest().selectAsset(clipA, protocol)
                }
                waitForReceiver(scenario, clipA, receiver)
                scenario.onActivity {
                    assertNotEquals("Rapid A-to-B-to-A must not reuse the old A status", previousLoadId,
                        it.playbackForTest().receiverEvidenceForTest().mediaSessionId)
                }
                scenario.onActivity { it.playbackForTest().selectAsset(clipB, protocol) }
                reportDiagnostics(scenario, receiver)
                waitForReceiver(scenario, clipB, receiver)
                var beforePause = 0L
                scenario.onActivity { beforePause = it.playbackForTest().receiverEvidenceForTest().samples; it.playbackForTest().player.pause() }
                waitUntil(scenario) {
                    val proof = it.playbackForTest().receiverEvidenceForTest()
                    proof.assetId == clipB && proof.paused == true && proof.samples > beforePause
                }
                scenario.onActivity { it.playbackForTest().player.play() }
                waitForReceiver(scenario, clipB, receiver)
                if (!vodOnly) {
                    scenario.onActivity {
                        val asset = requireNotNull(it.playbackForTest().state.value.catalog?.asset(live))
                        assertEquals(AssetKind.LIVE, asset.kind)
                        it.playbackForTest().selectAsset(live, protocol)
                    }
                    waitForReceiver(scenario, live, receiver)
                    waitUntil(scenario, 60_000) { it.playbackForTest().player.isLive && it.playbackForTest().player.maxTimeShift <= -20.0 }
                    var livePosition = 0L
                    var source: Source? = null
                    var request: PlaybackRequest? = null
                    var mediaSession: Long? = null
                    var revision = 0L
                    scenario.onActivity {
                        val activeSession = it.playbackForTest()
                        source = activeSession.player.source; request = activeSession.coordinator.current
                        val before = activeSession.receiverEvidenceForTest()
                        mediaSession = before.mediaSessionId; revision = before.statusRevision
                        livePosition = requireNotNull(before.rawCafPositionMs)
                        activeSession.seekBy(-15.0)
                    }
                    waitUntil(scenario) {
                        val session = it.playbackForTest(); val proof = session.receiverEvidenceForTest()
                        session.player.source === source && session.coordinator.current == request &&
                            proof.mediaSessionId == mediaSession && proof.statusRevision > revision && proof.assetId == live &&
                            proof.rawCafPositionMs?.let { position -> position < livePosition - 10_000 } == true
                    }
                    reportDiagnostics(scenario, receiver)
                    scenario.onActivity {
                        val session = it.playbackForTest(); val proof = session.receiverEvidenceForTest()
                        assertTrue("The actual receiver must be behind its own live edge", requireNotNull(proof.rawCafSeekableEndMs) - requireNotNull(proof.rawCafPositionMs) > 10_000)
                        revision = proof.statusRevision
                        session.goLive()
                    }
                    waitUntil(scenario) {
                        val session = it.playbackForTest(); val proof = session.receiverEvidenceForTest()
                        val end = proof.rawCafSeekableEndMs; val position = proof.rawCafPositionMs
                        session.player.source === source && session.coordinator.current == request &&
                            proof.mediaSessionId == mediaSession && proof.statusRevision > revision && proof.assetId == live &&
                            proof.playing == true && end != null && position != null && end - position in 0..3_000 &&
                            session.player.timeShift > -3.0
                    }
                    reportDiagnostics(scenario, receiver)
                    if (unknownMappingRecovery) {
                        val repository = CatalogRepository(instrumentation.targetContext)
                        var statusUrl = ""; var durationMs = 0L
                        scenario.onActivity {
                            val catalog = requireNotNull(it.playbackForTest().state.value.catalog)
                            val event = requireNotNull(catalog.event(catalog.asset(live)?.eventId))
                            statusUrl = requireNotNull(event.statusUrl)
                            durationMs = requireNotNull(catalog.asset(event.archiveAssetId)?.durationMs)
                            assertTrue("Use the real short event for this recovery check", durationMs in 120_000..240_000)
                        }
                        fun status() = JSONObject(runBlocking { repository.status(statusUrl) })
                        val first = status()
                        assertTrue("Join early enough to hold a point before the event ends",
                            first.getLong("mediaUtcNow") - first.getLong("utcStartMs") < durationMs - 60_000)
                        val deadline = System.nanoTime() + 240_000_000_000L
                        while (true) {
                            val observed = status()
                            assertEquals("live", observed.getString("status"))
                            if (observed.getLong("mediaUtcNow") - observed.getLong("utcStartMs") >= durationMs - 12_000) break
                            assertTrue("The publisher must advance naturally", System.nanoTime() < deadline)
                            Thread.sleep(500)
                        }
                        scenario.onActivity { it.playbackForTest().player.pause() }
                        waitUntil(scenario) { it.playbackForTest().receiverEvidenceForTest().paused == true }
                        scenario.onActivity {
                            heldUnknownSource = it.playbackForTest().player.source
                            heldUnknownLoadCount = it.playbackForTest().loadCount
                        }
                    }
                }
                val archiveDeadline = System.nanoTime() + 240_000_000_000L
                var ready = false
                while (!ready && System.nanoTime() < archiveDeadline) {
                    scenario.onActivity {
                        val catalog = it.playbackForTest().state.value.catalog
                        val asset = catalog?.asset(archive)
                        ready = asset != null && catalog.event(asset.eventId)?.archiveStatus == ArchiveStatus.READY
                        if (!ready) it.playbackForTest().reloadCatalog()
                    }
                    if (!ready) Thread.sleep(5_000)
                }
                assertTrue("Archive did not become ready in real time", ready)
                var utcHandoffRows = 0
                if (unknownMappingRecovery) {
                    waitUntil(scenario) { it.playbackForTest().state.value.selectedEvent?.archiveStatus == ArchiveStatus.READY }
                    waitUntil(scenario) { it.playbackForTest().state.value.isLive == it.playbackForTest().player.isLive }
                    scenario.onActivity {
                        val session = it.playbackForTest()
                        val source = session.player.source; val count = session.loadCount
                        assertSame("Event end must not silently replace the held live Source", heldUnknownSource, source)
                        assertEquals(heldUnknownLoadCount, count)
                        assertFalse("Event end must retain non-playing intent", session.receiverEvidenceForTest().playing == true)
                        assertFalse(session.desiredPlaying)
                        assertNull("The default receiver must not invent an authored UTC mapping", session.viewedUtcForCurrentSource())
                        assertTrue(session.state.value.archivePosition is ArchivePosition.Unknown)
                        utcHandoffRows = utcHandoffCount(session)
                        session.continueInArchive()
                        assertSame("An unavailable current-position transition must keep the live Source", source, session.player.source)
                        assertEquals(count, session.loadCount)
                        assertEquals(utcHandoffRows, utcHandoffCount(session))
                        session.continueInArchive(fromStart = true)
                    }
                } else if (!vodOnly) {
                    var from = 0L; var revision = 0L; var mediaId: Long? = null
                    var liveSource: Source? = null; var liveRequest: PlaybackRequest? = null
                    scenario.onActivity {
                        val session = it.playbackForTest(); val proof = session.receiverEvidenceForTest()
                        from = requireNotNull(proof.rawCafPositionMs); revision = proof.statusRevision; mediaId = proof.mediaSessionId
                        liveSource = session.player.source; liveRequest = session.coordinator.current
                        session.seekBy(-15.0)
                    }
                    waitUntil(scenario) {
                        val session = it.playbackForTest(); val proof = session.receiverEvidenceForTest()
                        session.player.source === liveSource && session.coordinator.current == liveRequest &&
                            proof.mediaSessionId == mediaId && proof.statusRevision > revision &&
                            proof.rawCafPositionMs?.let { value -> value < from - 10_000 } == true
                    }
                }
                if (!unknownMappingRecovery) {
                    scenario.onActivity {
                        // Exercise the same immediate source change possible after the standard SDK UI's live action.
                        if (!vodOnly) it.playbackForTest().player.timeShift(0.0)
                        it.playbackForTest().selectAsset(archive, protocol)
                    }
                }
                waitForReceiver(scenario, archive, receiver)
                var archivePosition = 0L; var archiveMediaId: Long? = null
                scenario.onActivity {
                    val proof = it.playbackForTest().receiverEvidenceForTest()
                    archivePosition = requireNotNull(proof.positionMs); archiveMediaId = proof.mediaSessionId
                    if (unknownMappingRecovery) {
                        assertTrue("An explicit start must actually begin near zero", archivePosition in 0..1_000)
                        assertEquals("An explicit start is not a UTC-preserving handoff", utcHandoffRows, utcHandoffCount(it.playbackForTest()))
                    }
                }
                Thread.sleep(1_500)
                waitUntil(scenario) {
                    val proof = it.playbackForTest().receiverEvidenceForTest()
                    proof.assetId == archive && proof.mediaSessionId == archiveMediaId && proof.playing == true &&
                        proof.positionMs?.let { value -> value > archivePosition + 500 } == true
                }
                if (unknownMappingRecovery) scenario.onActivity {
                    val records = it.playbackForTest().handoffs.exportJson()
                    java.io.File(instrumentation.targetContext.filesDir, "receiver-continuation").apply { mkdirs() }
                        .resolve("${protocol.name.lowercase()}-records.json").writeText(records)
                    instrumentation.sendStatus(0, Bundle().apply {
                        putString("receiverContinuationResult", JSONObject().put("protocol", protocol.name)
                            .put("utcMapping", "unknown").put("currentPositionRejected", true)
                            .put("explicitStartVerified", true).put("utcHandoffRowsAdded", 0)
                            .put("receiverQoe", JSONObject.NULL).toString())
                    })
                }
                scenario.onActivity { it.playbackForTest().toggleCasting() }
                waitUntil(scenario) {
                    !it.playbackForTest().player.isCasting && !it.playbackForTest().player.isPlaying &&
                        it.playbackForTest().state.value.needsLocalReturnChoice
                }
            } finally {
                reportDiagnostics(scenario, receiver)
                scenario.onActivity {
                    if (it.playbackForTest().player.isCasting && it.playbackForTest().state.value.castName == receiver) {
                        it.playbackForTest().disconnectCasting()
                    }
                    it.playbackForTest().player.pause()
                    if (changedKeepScreenOn) it.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            }
        }
    }
    private fun utcHandoffCount(session: PlaybackSession): Int {
        val records = JSONObject(session.handoffs.exportJson()).getJSONArray("records")
        return (0 until records.length()).count { records.getJSONObject(it).getString("transition") == "live-to-archive" }
    }
    private fun reportDiagnostics(scenario: ActivityScenario<MainActivity>, receiver: String) {
        scenario.onActivity { activity ->
            val details = activity.playbackForTest().castDiagnosticsForTest(receiver)
            InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply {
                putString("castDiagnostics", details)
                putBoolean("windowFocused", activity.window.decorView.hasWindowFocus())
            })
        }
    }
    private fun waitForReceiver(scenario: ActivityScenario<MainActivity>, asset: String, receiver: String) {
        waitUntil(scenario, 60_000) {
            val session = it.playbackForTest()
            val proof = session.receiverEvidenceForTest()
            val position = if (session.state.value.catalog?.asset(asset)?.kind == AssetKind.LIVE) proof.rawCafPositionMs else proof.positionMs
            session.player.isCasting && session.state.value.castName == receiver && proof.assetId == asset &&
                position != null && proof.playing == true
        }
    }
    private fun waitUntil(scenario: ActivityScenario<MainActivity>, timeoutMs: Long = 45_000, predicate: (MainActivity) -> Boolean) {
        val deadline = System.nanoTime() + timeoutMs * 1_000_000
        while (System.nanoTime() < deadline) {
            var passed = false
            scenario.onActivity {
                assertNull("SDK error code ${it.playbackForTest().lastErrorCode}", it.playbackForTest().lastErrorCode)
                passed = predicate(it)
            }
            if (passed) return
            Thread.sleep(200)
        }
        fail("Required receiver playback state was not observed before the deadline")
    }
}
