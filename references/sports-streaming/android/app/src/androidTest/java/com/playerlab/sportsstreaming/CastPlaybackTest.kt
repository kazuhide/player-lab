package com.playerlab.sportsstreaming

import android.content.Intent
import android.os.Bundle
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
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Explicit opt-in: this test selects only the receiverName passed by the device owner. */
@RunWith(AndroidJUnit4::class)
class CastPlaybackTest {
    @Test fun receiverReportsClipLiveArchiveAndPausedState() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val arguments = InstrumentationRegistry.getArguments()
        val receiver = requireNotNull(arguments.getString("receiverName")) { "Explicit authorized receiverName is required" }
        require(receiver.isNotBlank())
        val base = requireNotNull(arguments.getString("mediaBaseUrl")) { "A receiver-reachable mediaBaseUrl is required" }
        val protocol = StreamProtocol.valueOf(arguments.getString("protocol", "HLS").uppercase())
        val vodOnly = arguments.getString("vodOnly", "false").toBooleanStrict()
        instrumentation.sendStatus(0, Bundle().apply { putString("castQualificationScope", if (vodOnly) "prepared-vod-only" else "live-dvr-and-vod") })
        val clipA = arguments.getString("clipAssetId", "SP-CLIP-A")
        val clipB = arguments.getString("secondClipAssetId", "SP-CLIP-B")
        val live = arguments.getString("liveAssetId", "SP-LIVE-EVENT")
        val archive = arguments.getString("archiveAssetId", "SP-ARCH-S")
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java).putExtra("mediaBaseUrl", base)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            try {
                waitUntil(scenario, 30_000) { !it.playbackForTest().state.value.loadingCatalog && it.playbackForTest().state.value.catalog != null }
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
                    scenario.onActivity {
                        livePosition = requireNotNull(it.playbackForTest().receiverEvidenceForTest().positionMs)
                        it.playbackForTest().seekBy(-15.0)
                    }
                    waitUntil(scenario) {
                        val proof = it.playbackForTest().receiverEvidenceForTest()
                        proof.assetId == live && proof.positionMs != null && proof.positionMs < livePosition - 10_000
                    }
                    scenario.onActivity { it.playbackForTest().goLive() }
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
                scenario.onActivity { it.playbackForTest().selectAsset(archive, protocol) }
                waitForReceiver(scenario, archive, receiver)
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
                }
            }
        }
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
            session.player.isCasting && session.state.value.castName == receiver && proof.assetId == asset &&
                proof.positionMs != null && proof.playing == true
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
