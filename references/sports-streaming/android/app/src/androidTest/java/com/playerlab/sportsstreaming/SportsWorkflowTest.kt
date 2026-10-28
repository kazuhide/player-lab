package com.playerlab.sportsstreaming

import android.content.Intent
import android.os.Bundle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import com.bitmovin.analytics.api.CustomData
import com.bitmovin.player.api.analytics.SourceAnalyticsApi.Companion.analytics
import com.bitmovin.player.api.event.SourceEvent
import com.bitmovin.player.api.source.Source
import com.playerlab.sportsstreaming.core.PlaybackRequest
import com.playerlab.sportsstreaming.core.StreamProtocol
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SportsWorkflowTest {
    @Test fun explicitSelectionMetadataAndBoundedSeekUseTheActiveSource() {
        val args = InstrumentationRegistry.getArguments()
        val base = requireNotNull(args.getString("mediaBaseUrl"))
        val protocol = StreamProtocol.valueOf(args.getString("protocol", "HLS").uppercase())
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java).putExtra("mediaBaseUrl", base)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            var loadedListener: ((SourceEvent.Loaded) -> Unit)? = null
            try {
                waitUntil(scenario) { !it.playbackForTest().state.value.loadingCatalog && it.playbackForTest().state.value.catalog != null }
                scenario.onActivity {
                    assertNull("Opening the list must not autoplay", it.playbackForTest().player.source)
                    it.switchUiForTest(true)
                }
                assertRenderedControlAvailability(scenario)
                scenario.onActivity {
                    it.playbackForTest().selectAsset("SP-CLIP-A", protocol)
                }
                waitUntil(scenario) { it.playbackForTest().player.isPlaying && it.playbackForTest().state.value.canControlPlayback }
                var expectedSource: Source? = null
                var expectedRequest: PlaybackRequest? = null
                scenario.onActivity {
                    val session = it.playbackForTest()
                    val source = requireNotNull(session.player.source)
                    val expected = requireNotNull(session.state.value.catalog?.asset("SP-CLIP-A"))
                    assertEquals(expected.videoId, source.analytics?.metadata?.videoId)
                    assertEquals(CustomData(), source.analytics?.customData)
                    val listener: (SourceEvent.Loaded) -> Unit = { event ->
                        if (event.source !== source && event.source.config.url == expected.streams[protocol] &&
                            expectedRequest != null && session.coordinator.current == expectedRequest) expectedSource = event.source
                    }
                    loadedListener = listener
                    session.player.on(SourceEvent.Loaded::class, listener)
                    session.selectAsset("SP-CLIP-B", protocol)
                    session.selectAsset("SP-CLIP-A", protocol)
                    expectedRequest = requireNotNull(session.coordinator.current)
                }
                waitUntil(scenario) {
                    val session = it.playbackForTest()
                    val range = session.player.source?.seekableRange
                    expectedSource != null && session.coordinator.current == expectedRequest &&
                        session.player.source === expectedSource && expectedSource.isActive &&
                        session.state.value.canControlPlayback && !session.state.value.loadingSource && session.player.isPlaying &&
                        range != null && range.start.isFinite() && range.end.isFinite() && range.start <= 5.0 && range.end >= 15.0
                }
                scenario.onActivity {
                    val session = it.playbackForTest()
                    assertSame(expectedSource, session.player.source)
                    assertEquals(expectedRequest, session.coordinator.current)
                    assertFreshSeekBounds(session, 5.0)
                    session.player.pause()
                    session.seekTo(5_000)
                }
                waitUntil(scenario) { kotlin.math.abs(it.playbackForTest().player.currentTime - 5.0) < 0.6 &&
                    kotlin.math.abs((it.playbackForTest().state.value.positionMs ?: -10_000) - 5_000) < 600 && it.playbackForTest().player.isPaused }
                assertRenderedControlAvailability(scenario)
                scenario.onActivity { assertFreshSeekBounds(it.playbackForTest(), 0.0); it.playbackForTest().seekBy(-15.0) }
                waitUntil(scenario) { it.playbackForTest().player.currentTime < 0.6 &&
                    (it.playbackForTest().state.value.positionMs ?: 10_000) < 600 }
                assertRenderedControlAvailability(scenario)
                scenario.onActivity { assertFreshSeekBounds(it.playbackForTest(), 15.0); it.playbackForTest().seekBy(15.0) }
                waitUntil(scenario) { kotlin.math.abs(it.playbackForTest().player.currentTime - 15.0) < 0.6 &&
                    kotlin.math.abs((it.playbackForTest().state.value.positionMs ?: -10_000) - 15_000) < 600 }
                assertRenderedControlAvailability(scenario)
                scenario.onActivity { assertTrue(it.playbackForTest().player.isPaused) }
            } finally {
                loadedListener?.let { listener -> scenario.onActivity { it.playbackForTest().player.off(SourceEvent.Loaded::class, listener) } }
            }
        }
    }
    private fun assertFreshSeekBounds(session: PlaybackSession, target: Double) {
        assertTrue("The same GUI availability guard must admit the dispatched operation", session.state.value.canControlPlayback)
        val range = requireNotNull(session.player.source?.seekableRange)
        assertTrue("Read actual finite SDK bounds immediately before seeking", range.start.isFinite() && range.end.isFinite() &&
            range.start <= target && target <= range.end)
    }
    private fun assertRenderedControlAvailability(scenario: ActivityScenario<MainActivity>) {
        val controls = mutableListOf<Pair<String, Boolean>>()
        scenario.onActivity {
            val state = it.playbackForTest().state.value
            controls.add(it.getString(R.string.back_15) to state.canSeekBack)
            controls.add(it.getString(R.string.forward_15) to state.canSeekForward)
            controls.add(it.getString(if (state.isPlaying) R.string.pause else R.string.play) to state.canControlPlayback)
        }
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        controls.forEach { (label, enabled) ->
            var present = false
            val deadline = System.nanoTime() + 5_000_000_000L
            while (!present && System.nanoTime() < deadline) {
                present = runCatching {
                    val icon = device.findObject(By.desc(label).pkg("com.playerlab.sportsstreaming"))
                    // A label's leaf node inherits no disabled state; inspect its actual button action.
                    val button = generateSequence(icon) { it.parent }.take(8).firstOrNull { it.isClickable }
                    button != null && button.isEnabled == enabled
                }.getOrDefault(false)
                if (!present) Thread.sleep(100)
            }
            if (!present) {
                val details = device.findObjects(By.pkg("com.playerlab.sportsstreaming")).take(100).mapNotNull { node ->
                    runCatching {
                        val description = node.contentDescription.orEmpty().take(80)
                        val text = node.text.orEmpty().take(80)
                        if (description.isBlank() && text.isBlank()) null else {
                            val parents = generateSequence(node.parent) { it.parent }.take(4).map {
                                "${it.className}:enabled=${it.isEnabled}:clickable=${it.isClickable}"
                            }.joinToString(" > ")
                            "$description|$text|enabled=${node.isEnabled}:clickable=${node.isClickable}|$parents"
                        }
                    }.getOrNull()
                }.joinToString("\n")
                InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply { putString("workflowControls", details) })
            }
            assertTrue("Rendered control '$label' must use the app's availability predicate ($enabled)", present)
        }
    }
    private fun waitUntil(scenario: ActivityScenario<MainActivity>, predicate: (MainActivity) -> Boolean) {
        val deadline = System.nanoTime() + 45_000_000_000L
        while (System.nanoTime() < deadline) {
            var passed = false
            scenario.onActivity {
                assertNull("SDK error code ${it.playbackForTest().lastErrorCode}", it.playbackForTest().lastErrorCode)
                passed = predicate(it)
            }
            if (passed) return
            Thread.sleep(100)
        }
        fail("The active source did not reach the requested state")
    }
}
