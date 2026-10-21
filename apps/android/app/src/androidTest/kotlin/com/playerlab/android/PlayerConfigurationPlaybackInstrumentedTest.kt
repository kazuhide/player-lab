package com.playerlab.android

import android.os.SystemClock
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import com.bitmovin.player.api.source.LoadingState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Requires an authorized Player license and network; verifies playback after GUI configuration. */
@RunWith(AndroidJUnit4::class)
class PlayerConfigurationPlaybackInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val errors = CopyOnWriteArrayList<Int>()
    private val startupReady = AtomicBoolean()
    private val firstFrameRendered = AtomicBoolean()
    private val firstRenderedPosition = AtomicReference<Double?>()
    private val loadPlayingPosition = AtomicReference<Double?>()

    @Test
    fun appliedSourceOffsetAndPlayerSettingsAutoplayMutedVodAfterRestart() {
        val controller = ui.activity.controller
        ui.runOnUiThread { observe(controller.player) }
        click("configuration-toggle")
        field("source-url", Sources.all.first { it.id == "vod-hls" }.url)
        click("source-type-Hls")
        field("source-title", "Configured VOD")
        field("source-offset", "10")
        click("source-reference-Start")
        click("apply-source")
        val previous = controller.player
        click("config-autoplay")
        click("config-muted")
        field("config-startup", "1")
        field("config-restart", "2")
        field("config-forward", "20")
        field("config-max-bitrate", "1500000")
        // Observe the replacement in the same main-thread turn as the real Apply action,
        // before asynchronous Ready or render events can be delivered.
        ui.onNodeWithTag("apply-player").performScrollTo().assertIsDisplayed()
            .performSemanticsAction(SemanticsActions.OnClick) { action ->
                assertTrue("Apply action must run", action())
                assertTrue("Player must restart", controller.player !== previous)
                observe(controller.player, startup = true)
            }
        await("Configured VOD starts automatically") {
            val player = controller.player
            val loadPlaying = player.source?.loadingState == LoadingState.Loaded && player.duration.isFinite() &&
                player.duration > 10 && player.isPlaying
            if (loadPlaying && loadPlayingPosition.compareAndSet(null, player.currentTime)) {
                println("VOD_STARTUP_SAFE phase=load-playing ms=${SystemClock.uptimeMillis()} position=${player.currentTime} ready=${startupReady.get()} frame=${firstFrameRendered.get()}")
            }
            loadPlaying && startupReady.get() && firstFrameRendered.get() && firstRenderedPosition.get() != null
        }
        var firstPosition = 0.0
        ui.runOnUiThread {
            val player = controller.player
            firstPosition = requireNotNull(firstRenderedPosition.get())
            println("VOD_STARTUP_SAFE phase=accepted ms=${SystemClock.uptimeMillis()} position=$firstPosition current=${player.currentTime} initialLoadPlaying=${loadPlayingPosition.get()}")
            assertTrue("First rendered VOD position must honor the 10 s offset; observed=$firstPosition", firstPosition in 9.0..13.0)
            assertTrue("Playback must start muted", player.isMuted)
            assertEquals("Configured VOD", player.source?.config?.title)
            assertEquals(1_500_000, player.config.adaptationConfig.maxSelectableVideoBitrate)
        }
        await("Configured playback advances") { controller.player.isPlaying && controller.player.currentTime > firstPosition + 1 }
    }

    private fun observe(player: Player, startup: Boolean = false) {
        player.on(PlayerEvent.Error::class) { errors += it.code.value }
        player.on(SourceEvent.Error::class) { errors += it.code.value }
        if (!startup) return
        val source = requireNotNull(ui.activity.controller.configuredSource)
        fun ownsSource() = player === ui.activity.controller.player && player.source === source &&
            ui.activity.controller.configuredSource === source
        player.on(PlayerEvent.Ready::class) {
            if (ownsSource()) {
                startupReady.set(true)
                println("VOD_STARTUP_SAFE phase=ready ms=${SystemClock.uptimeMillis()} position=${player.currentTime}")
            }
        }
        player.on(PlayerEvent.RenderFirstFrame::class) {
            if (ownsSource()) {
                firstFrameRendered.set(true)
                println("VOD_STARTUP_SAFE phase=frame ms=${SystemClock.uptimeMillis()} position=${player.currentTime}")
            }
        }
        player.on(PlayerEvent.TimeChanged::class) {
            if (ownsSource() && startupReady.get() && firstFrameRendered.get() &&
                firstRenderedPosition.compareAndSet(null, it.time)) {
                // Capture the first fresh native timestamp, including zero. Do not wait for a passing range.
                println("VOD_STARTUP_SAFE phase=first-position ms=${SystemClock.uptimeMillis()} position=${it.time}")
            }
        }
    }

    private fun await(label: String, condition: () -> Boolean) {
        ui.waitUntil(40_000) {
            var ready = false
            ui.runOnUiThread { ready = condition() }
            ready || errors.isNotEmpty() || ui.activity.controller.lastErrorCode != null
        }
        assertTrue("$label; Player/Source error codes: $errors", errors.isEmpty())
        assertEquals("$label; app error code", null, ui.activity.controller.lastErrorCode)
    }

    private fun click(tag: String) = ui.onNodeWithTag(tag).performScrollTo().assertIsDisplayed().performClick()
    private fun field(tag: String, value: String) {
        ui.onNodeWithTag(tag).performScrollTo().performTextReplacement(value)
        closeSoftKeyboard()
    }
}
