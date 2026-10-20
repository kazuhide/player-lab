package com.showcase.app

import android.graphics.Rect
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bitmovin.player.PlayerView
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

/** Licensed checks for surface handoff while the same SDK player keeps playing. */
@RunWith(AndroidJUnit4::class)
class PlayerUiHandoffInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val errors = CopyOnWriteArrayList<Int>()

    @Test
    fun playingPlayerSurvivesRepeatedUiModeHandoffs() {
        val controller = ui.activity.controller
        val player = controller.player
        ui.runOnUiThread {
            player.on(PlayerEvent.Error::class) { errors.add(it.code.value) }
            player.on(SourceEvent.Error::class) { errors.add(it.code.value) }
            player.mute()
        }
        ui.onNodeWithText("VOD HLS").performScrollTo().performClick()
        await("VOD source loaded") { player.duration.isFinite() && player.duration > 0 }
        ui.runOnUiThread { player.play() }
        await("VOD playback starts") { player.isPlaying && player.currentTime > 1 }

        repeat(3) { cycle ->
            for (mode in listOf("Sports", "Live (DVR)", "Cinema", "Default")) {
                val previous = onMain { playerViews().single { it.player === player } }
                ui.onNodeWithText(mode).performScrollTo().performClick()
                ui.onNodeWithText(mode).assertIsNotEnabled()
                await("$mode view attaches in cycle $cycle") {
                    val views = playerViews()
                    views.size == 1 && views.single() !== previous && views.single().player === player
                }
                ui.runOnUiThread {
                    assertTrue("UI changes retain the player", controller.player === player)
                    assertEquals("Retired view detaches from the shared player", null, previous.player)
                    val active = playerViews().single()
                    val bounds = Rect()
                    assertTrue("Active view is shown", active.isShown)
                    assertTrue("Active view intersects the viewport", active.getGlobalVisibleRect(bounds) && !bounds.isEmpty)
                }
                val position = onMain { player.currentTime }
                await("$mode playback advances in cycle $cycle") {
                    player.isPlaying && player.currentTime > position + 0.5
                }
            }
        }
    }

    private fun <T> onMain(action: () -> T): T {
        var result: T? = null
        ui.runOnUiThread { result = action() }
        return requireNotNull(result)
    }

    private fun await(label: String, predicate: () -> Boolean) {
        ui.waitUntil(timeoutMillis = 40_000) {
            onMain { predicate() } || errors.isNotEmpty() || ui.activity.controller.lastErrorCode != null
        }
        assertTrue("$label; Player/Source error codes: $errors", errors.isEmpty())
        assertEquals("$label; app Player/Source error code", null, ui.activity.controller.lastErrorCode)
    }

    private fun playerViews(): List<PlayerView> = descendants(ui.activity.window.decorView).filterIsInstance<PlayerView>()

    private fun descendants(view: View): List<View> = if (view is ViewGroup) {
        (0 until view.childCount).flatMap { index ->
            val child = view.getChildAt(index)
            listOf(child) + descendants(child)
        }
    } else emptyList()
}
