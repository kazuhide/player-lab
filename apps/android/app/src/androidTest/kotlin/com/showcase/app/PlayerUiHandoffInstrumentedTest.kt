package com.showcase.app

import android.graphics.Rect
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.lifecycle.Lifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.PlayerView
import com.bitmovin.player.api.deficiency.DeficiencyData
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
    private val errorPhases = CopyOnWriteArrayList<String>()
    private val lifecycleSnapshots = CopyOnWriteArrayList<String>()
    @Volatile private var phase = "initial playback"

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

    @Test
    fun resumedPlayerPlaysAfterExplicitRequestAndUiReplacement() {
        val controller = ui.activity.controller
        val player = controller.player
        ui.runOnUiThread {
            player.on(PlayerEvent.Error::class) { recordError(it.code.value, it.message, it.deficiencyData) }
            player.on(SourceEvent.Error::class) { recordError(it.code.value, it.message, it.deficiencyData) }
            player.mute()
        }
        ui.onNodeWithText("VOD HLS").performScrollTo().performClick()
        await("VOD source loaded") { player.duration.isFinite() && player.duration > 0 }
        ui.runOnUiThread { player.play() }
        await("VOD playback starts") { player.isPlaying && player.currentTime > 1 }
        ui.onNodeWithTag("allow-dvr").performScrollTo().performClick()
        val source = controller.configuredSource
        val settings = controller.playerSettings
        val allowDvr = controller.timeShiftEnabled
        var selectedUi = "Default"

        for (mode in listOf("Sports", "Cinema")) {
            val previous = onMain { playerViews().single { it.player === player } }
            phase = "$mode host stop"
            ui.runOnUiThread { lifecycleSnapshots += "$mode before stop at=${SystemClock.uptimeMillis()} playing=${player.isPlaying} paused=${player.isPaused} position=${player.currentTime}" }
            ui.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
            ui.activityRule.scenario.onActivity { activity ->
                assertEquals("Host must enter the stopped state", Lifecycle.State.CREATED, activity.lifecycle.currentState)
                assertTrue("Backgrounding retains the player", activity.controller.player === player)
            }
            phase = "$mode host resume"
            ui.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
            ui.runOnUiThread { lifecycleSnapshots += "$mode after resume at=${SystemClock.uptimeMillis()} playing=${player.isPlaying} paused=${player.isPaused} position=${player.currentTime}" }
            ui.onNodeWithText(selectedUi).assertIsNotEnabled()
            phase = "$mode UI replacement"
            ui.onNodeWithText(mode).performScrollTo().performClick()
            ui.onNodeWithText(mode).assertIsNotEnabled()
            selectedUi = mode
            await("$mode replacement attaches after resume") {
                playerViews().singleOrNull()?.let { it !== previous && it.player === player } == true
            }
            ui.runOnUiThread {
                assertTrue("Resume retains the source", controller.configuredSource === source)
                assertEquals(settings, controller.playerSettings)
                assertEquals(allowDvr, controller.timeShiftEnabled)
                assertTrue("Resume retains muted playback", player.isMuted)
                assertEquals(null, previous.player)
                val active = playerViews().single()
                val bounds = Rect()
                assertTrue("Resumed player view intersects the viewport", active.isShown && active.getGlobalVisibleRect(bounds) && !bounds.isEmpty)
            }
            // Host lifecycle callbacks can leave playback paused after foregrounding.
            phase = "$mode explicit Play"
            ui.runOnUiThread { player.play() }
            val position = onMain { player.currentTime }
            await("$mode playback advances after an explicit request following background/resume") {
                player.isPlaying && player.currentTime > position + 1
            }
            ui.runOnUiThread { lifecycleSnapshots += "$mode advanced at=${SystemClock.uptimeMillis()} position=${player.currentTime}" }
        }

        phase = "Activity close"
        ui.activityRule.scenario.close()
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            assertTrue("Activity teardown invalidates its owned player", player.isDestroyed)
            assertTrue("No Player/Source error before teardown completes: $errors; phases=$errorPhases; lifecycle=$lifecycleSnapshots", errors.isEmpty())
        }
    }

    private fun recordError(code: Int, message: String, data: DeficiencyData?) {
        errors += code
        // Classify the SDK operation without logging opaque messages or source URLs.
        val cause = (data as? DeficiencyData.Throwable)?.cause
        val messages = listOfNotNull(message, cause?.message, cause?.cause?.message)
        val operation = when {
            messages.any { it.contains("surface", ignoreCase = true) } -> "surface"
            messages.any { it.contains("release", ignoreCase = true) } -> "release"
            else -> "unclassified"
        }
        errorPhases += "$phase at=${SystemClock.uptimeMillis()} code=$code operation=$operation"
    }

    private fun <T> onMain(action: () -> T): T {
        var result: T? = null
        ui.runOnUiThread { result = action() }
        return requireNotNull(result)
    }

    private fun await(label: String, predicate: () -> Boolean) {
        try {
            ui.waitUntil(timeoutMillis = 40_000) {
                onMain { predicate() } || errors.isNotEmpty() || ui.activity.controller.lastErrorCode != null
            }
        } catch (timeout: ComposeTimeoutException) {
            val state = onMain {
                val player = ui.activity.controller.player
                "playing=${player.isPlaying} paused=${player.isPaused} position=${player.currentTime} host=${ui.activity.lifecycle.currentState}"
            }
            throw AssertionError("$label; $state; lifecycle=$lifecycleSnapshots; errors=$errors; phases=$errorPhases", timeout)
        }
        assertTrue("$label; Player/Source error codes: $errors; phases=$errorPhases", errors.isEmpty())
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
