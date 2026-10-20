package com.showcase.app

import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
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
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs

/** Licensed runtime checks against the actual app controls, SDK and shared Web UI. */
@RunWith(AndroidJUnit4::class)
class PlayerControlsInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val errors = CopyOnWriteArrayList<Int>()
    private val timeShiftCompletions = AtomicInteger()
    private val completedTimeShiftPosition = AtomicReference(Double.NaN)
    private val timeShiftObservations = CopyOnWriteArrayList<TimeShiftObservation>()
    private var pointerSide = false

    private data class TimeShiftObservation(
        val phase: String,
        val uptimeMs: Long,
        val position: Double,
        val target: Double?,
        val offset: Double,
    )

    @Test
    fun sharedUiPlaybackSourceSwitchAndDvrControls() {
        val controller = ui.activity.controller
        val player = controller.player
        ui.runOnUiThread {
            player.on(PlayerEvent.Error::class) { errors.add(it.code.value) }
            player.on(SourceEvent.Error::class) { errors.add(it.code.value) }
            player.on(PlayerEvent.TimeShift::class) {
                timeShiftObservations.add(
                    TimeShiftObservation("request", SystemClock.uptimeMillis(), it.position, it.target, player.timeShift),
                )
            }
            player.on(PlayerEvent.TimeShifted::class) {
                val position = player.currentTime
                completedTimeShiftPosition.set(position)
                timeShiftObservations.add(
                    TimeShiftObservation("completed", SystemClock.uptimeMillis(), position, null, player.timeShift),
                )
                timeShiftCompletions.incrementAndGet()
            }
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
        awaitJavascript(webView, """
            (() => {
              $visibleElementScript
              const button = visible('.bmpui-ui-playbacktogglebutton');
              if (!button) return false;
              button.click();
              return true;
            })()
        """.trimIndent(), "shared UI playback button becomes visible", revealControls = true)
        var start = 0.0
        ui.runOnUiThread { start = player.currentTime }
        await("shared UI starts advancing playback") { player.isPlaying && player.currentTime > start + 1 }

        ui.onNodeWithText("Live DASH + DVR").performScrollTo().performClick()
        await("live source loads") { player.isLive }
        ui.runOnUiThread { player.play() }
        await("live source supplies a rewind window") {
            controller.dvr.dvrAvailable && controller.dvr.windowDuration > 10
        }
        val rewindButton = ui.onNodeWithText("-10s").performScrollTo()
        var beforeRewind = 0
        var rewindTarget = Double.NaN
        ui.runOnUiThread {
            beforeRewind = timeShiftCompletions.get()
            rewindTarget = player.currentTime - player.timeShift - 10
        }
        assertTrue("Rewind target must be finite", rewindTarget.isFinite())
        rewindButton.performClick()
        awaitJavascript(webView, sharedLiveUiScript(atEdge = false), "rewind completes in the SDK and shared UI", revealControls = true) {
            val offset = player.timeShift
            timeShiftCompletions.get() > beforeRewind && offset.isFinite() && offset < 0 &&
                abs(completedTimeShiftPosition.get() - rewindTarget) <= 3
        }
        val beforeReturn = timeShiftCompletions.get()
        ui.onNodeWithText("Live edge").performScrollTo().performClick()
        awaitJavascript(webView, sharedLiveUiScript(atEdge = true), "return to live completes in the SDK and shared UI", revealControls = true) {
            timeShiftCompletions.get() > beforeReturn && abs(player.timeShift) < 1
        }
        ui.onNodeWithTag("allow-dvr").performScrollTo().performClick()
        ui.runOnUiThread { assertFalse(controller.dvr.dvrAvailable) }
        ui.onNodeWithTag("allow-dvr").performClick()
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

    private fun awaitJavascript(
        view: WebView,
        script: String,
        label: String = "Shared UI DOM/styles",
        revealControls: Boolean = false,
        predicate: () -> Boolean = { true },
    ) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(40)
        var readyPolls = 0
        while (System.nanoTime() < deadline && errors.isEmpty() && ui.activity.controller.lastErrorCode == null) {
            var ready = false
            ui.runOnUiThread { ready = predicate() }
            if (ready) {
                readyPolls++
                if (revealControls) movePointerInside(view)
                if (javascript(view, script) == "true") return
            }
            Thread.sleep(100)
        }
        var native = ""
        ui.runOnUiThread {
            val player = ui.activity.controller.player
            native = "completions=${timeShiftCompletions.get()} readyPolls=$readyPolls " +
                "position=${player.currentTime} completedPosition=${completedTimeShiftPosition.get()} " +
                "offset=${player.timeShift} maxOffset=${player.maxTimeShift} playing=${player.isPlaying} " +
                "observations=${timeShiftObservations.takeLast(8)}"
        }
        // Diagnose a missed native condition separately from hidden or stale Web UI state.
        // Only live-control text, numeric playback state and CSS visibility are captured.
        val dom = runCatching { javascript(view, """
            JSON.stringify([...document.querySelectorAll('.bmpui-ui-label-behindlive,.bmpui-ui-livebutton')].map(element => {
              const rect = element.getBoundingClientRect();
              return {text:element.textContent.trim(), classes:element.className, rect:{x:rect.x,y:rect.y,w:rect.width,h:rect.height},
                hiddenBy:[element,...(function*(){for(let n=element.parentElement;n;n=n.parentElement)yield n;})()].flatMap(node => {
                  const style=getComputedStyle(node);
                  return style.display==='none'||style.visibility!=='visible'||Number(style.opacity)<=0
                    ? [{classes:node.className,display:style.display,visibility:style.visibility,opacity:style.opacity}] : [];
                })};
            }))
        """.trimIndent()) }.getOrDefault("unavailable")
        assertTrue(
            "$label did not settle; error codes: $errors; startup code: ${ui.activity.controller.lastErrorCode}; $native; dom=$dom",
            false,
        )
    }

    private fun movePointerInside(view: WebView) {
        ui.runOnUiThread {
            val now = SystemClock.uptimeMillis()
            pointerSide = !pointerSide
            val x = view.width * if (pointerSide) 0.3f else 0.4f
            val event = MotionEvent.obtain(now, now, MotionEvent.ACTION_HOVER_MOVE, x, view.height / 3f, 0)
            event.source = InputDevice.SOURCE_MOUSE
            try {
                view.dispatchGenericMotionEvent(event)
            } finally {
                event.recycle()
            }
        }
    }

    private val visibleElementScript = """
        const visible = selector => [...document.querySelectorAll(selector)].find(element => {
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          for (let node = element; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) <= 0) return false;
          }
          return true;
        });
    """.trimIndent()

    private fun sharedLiveUiScript(atEdge: Boolean): String = """
        (() => {
          $visibleElementScript
          const label = visible('.bmpui-ui-label-behindlive');
          const button = visible('.bmpui-ui-livebutton');
          if (!label || !button) return false;
          const text = label.textContent.trim();
          return $atEdge
            ? text === 'LIVE' && button.classList.contains('bmpui-at-live-edge')
              && !button.classList.contains('bmpui-behind-live')
            : text.endsWith(' behind') && button.classList.contains('bmpui-behind-live')
              && !button.classList.contains('bmpui-at-live-edge');
        })()
    """.trimIndent()

    private fun descendants(view: View): List<View> =
        if (view is ViewGroup) (0 until view.childCount).flatMap { index ->
            val child = view.getChildAt(index)
            listOf(child) + descendants(child)
        } else emptyList()
}
