package com.showcase.app

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
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

/** Requires an authorized Player license and network; verifies playback after GUI configuration. */
@RunWith(AndroidJUnit4::class)
class PlayerConfigurationPlaybackInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val errors = CopyOnWriteArrayList<Int>()

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
        click("apply-player")
        ui.runOnUiThread {
            assertTrue("Player must restart", controller.player !== previous)
            observe(controller.player)
        }
        await("Configured VOD starts automatically") {
            val player = controller.player
            player.source?.loadingState == LoadingState.Loaded && player.duration.isFinite() &&
                player.duration > 10 && player.isPlaying
        }
        var firstPosition = 0.0
        ui.runOnUiThread {
            val player = controller.player
            firstPosition = player.currentTime
            assertTrue("First VOD position must honor the 10 s offset", firstPosition in 9.0..13.0)
            assertTrue("Playback must start muted", player.isMuted)
            assertEquals("Configured VOD", player.source?.config?.title)
            assertEquals(1_500_000, player.config.adaptationConfig.maxSelectableVideoBitrate)
        }
        await("Configured playback advances") { controller.player.isPlaying && controller.player.currentTime > firstPosition + 1 }
    }

    private fun observe(player: Player) {
        player.on(PlayerEvent.Error::class) { errors += it.code.value }
        player.on(SourceEvent.Error::class) { errors += it.code.value }
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
