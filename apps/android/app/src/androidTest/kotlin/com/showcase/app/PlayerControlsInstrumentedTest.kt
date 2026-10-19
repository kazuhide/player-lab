package com.showcase.app

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import com.showcase.dvr.PlaybackMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/** Licensed runtime checks against the actual app controls, SDK and shared Web UI. */
@RunWith(AndroidJUnit4::class)
class PlayerControlsInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val errors = CopyOnWriteArrayList<Int>()

    @Test
    fun sharedUiPlaybackSourceSwitchAndDvrControls() {
        val controller = ui.activity.controller
        val player = controller.player
        ui.runOnUiThread {
            player.on(PlayerEvent.Error::class) { errors.add(it.code.value) }
            player.on(SourceEvent.Error::class) { errors.add(it.code.value) }
            player.mute()
        }

        ui.onNodeWithText("Sports").performScrollTo().performClick()
        ui.onNodeWithText("VOD HLS").performScrollTo().performClick()
        await("finite VOD duration") {
            player.duration > 0 && player.duration.isFinite() && controller.dvr.mode == PlaybackMode.VOD
        }
        var shared: WebView? = null
        await("shared UI WebView attaches") {
            shared = descendants(ui.activity.window.decorView).filterIsInstance<WebView>().firstOrNull()
            shared != null
        }
        val webView = requireNotNull(shared)
        awaitJavascript(webView, """
            typeof bitmovin?.playerui?.UIFactory?.buildSportsUI === 'function' &&
            !!document.querySelector('.bmpui-ui-skin-sports') &&
            [...document.querySelectorAll('link[rel="stylesheet"]')]
              .some(link => link.href.includes('bitmovinplayer-ui.css'))
        """.trimIndent())
        assertEquals("true", javascript(webView, """
            (() => {
              const button = [...document.querySelectorAll('.bmpui-ui-playbacktogglebutton')]
                .find(button => button.getBoundingClientRect().width > 0);
              if (!button) return false;
              button.click();
              return true;
            })()
        """.trimIndent()))
        var start = 0.0
        ui.runOnUiThread { start = player.currentTime }
        await("shared UI starts advancing playback") { player.isPlaying && player.currentTime > start + 1 }

        ui.onNodeWithText("Live DASH + DVR").performScrollTo().performClick()
        await("live source loads") { player.isLive }
        ui.runOnUiThread { player.play() }
        await("live source supplies a rewind window") { controller.dvr.dvrAvailable }
        ui.onNodeWithText("-10s").performScrollTo().performClick()
        await("rewind changes the SDK offset") { player.timeShift < -3 }
        ui.onNodeWithText("Live edge").performScrollTo().performClick()
        await("return to live updates the SDK offset") { abs(player.timeShift) < 3 }
        ui.onNode(isToggleable()).performClick()
        ui.runOnUiThread { assertFalse(controller.dvr.dvrAvailable) }
        ui.onNode(isToggleable()).performClick()
        ui.runOnUiThread { assertTrue(controller.dvr.dvrAvailable) }
        ui.onNodeWithText("VOD HLS").performScrollTo().performClick()
        await("VOD state after source switch") { controller.dvr.mode == PlaybackMode.VOD }
        assertTrue("Player/Source error codes: $errors", errors.isEmpty())
    }

    private fun await(label: String, predicate: () -> Boolean) {
        ui.waitUntil(timeoutMillis = 40_000) {
            var ready = false
            ui.runOnUiThread { ready = predicate() }
            ready || errors.isNotEmpty() || ui.activity.controller.lastErrorCode != null
        }
        assertTrue("$label; Player/Source error codes: $errors", errors.isEmpty())
        assertEquals("$label; app Player/Source error code", null, ui.activity.controller.lastErrorCode)
    }

    private fun javascript(view: WebView, script: String): String? {
        val done = CountDownLatch(1)
        var result: String? = null
        ui.runOnUiThread { view.evaluateJavascript(script) { result = it; done.countDown() } }
        assertTrue("Web UI JavaScript callback timed out", done.await(5, TimeUnit.SECONDS))
        return result
    }

    private fun awaitJavascript(view: WebView, script: String) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(40)
        while (System.nanoTime() < deadline && errors.isEmpty()) {
            if (javascript(view, script) == "true") return
            Thread.sleep(100)
        }
        assertTrue("Shared UI DOM/styles did not load; error codes: $errors", false)
    }

    private fun descendants(view: View): List<View> =
        if (view is ViewGroup) (0 until view.childCount).flatMap { index ->
            val child = view.getChildAt(index)
            listOf(child) + descendants(child)
        } else emptyList()
}
