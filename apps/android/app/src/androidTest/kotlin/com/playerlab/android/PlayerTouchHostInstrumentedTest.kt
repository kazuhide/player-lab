package com.playerlab.android

import android.content.Context
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/** Local HTML and Android input only; these checks do not qualify licensed playback. */
@RunWith(AndroidJUnit4::class)
class PlayerTouchHostInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test
    fun innerOverflowReceivesRealTouchWhileTheOuterScreenRemainsScrollable() {
        lateinit var web: WebView
        ui.runOnIdle {
            ui.activity.controller.release()
            ui.activity.setContent {
                Column(Modifier.testTag("touch-outer").verticalScroll(rememberScrollState())) {
                    AndroidView(factory = { context ->
                        web = WebView(context).apply {
                            settings.javaScriptEnabled = true
                            loadDataWithBaseURL(null, fixture, "text/html", "UTF-8", null)
                        }
                        PlayerTouchHost(context, web)
                    }, onRelease = { host ->
                        host.releaseTouchOwnership()
                        (host.content as WebView).destroy()
                    }, modifier = Modifier.fillMaxWidth().height(220.dp))
                    Box(Modifier.fillMaxWidth().height(1200.dp))
                }
            }
        }
        ui.waitForIdle()
        ui.waitUntil(5_000) { read(web).optInt("scrollHeight") == 224 }
        val before = outerScroll()
        dragPanel(web)
        try {
            ui.waitUntil(5_000) { read(web).getDouble("scrollTop") > 40 }
        } catch (failure: androidx.compose.ui.test.ComposeTimeoutException) {
            throw AssertionError("Inner touch scroll stayed at ${read(web).getDouble("scrollTop")}; " +
                "outer moved ${outerScroll() - before}", failure)
        }
        assertTrue("Inner drag must keep the player in place", abs(outerScroll() - before) < 1f)
        dragPanel(web)
        val state = read(web)
        assertTrue("Last item is fully inside the painted panel", state.getDouble("lastTop") >= state.getDouble("top") &&
            state.getDouble("lastBottom") <= state.getDouble("bottom") + .5)
        val location = location(web)
        val x = location[0] + web.width / 2f
        val y = location[1] + ((state.getDouble("lastTop") + state.getDouble("lastBottom")) / 2 /
            state.getDouble("viewportHeight") * web.height).toFloat()
        gesture(x, y, x, y, 0)
        ui.waitUntil(5_000) { read(web).getBoolean("selected") }
        val height = ui.activity.window.decorView.height.toFloat()
        gesture(x, height * .82f, x, height * .56f)
        ui.waitUntil(5_000) { outerScroll() > before + 40 }
        println("PLAYER_TOUCH_SAFE localFixture=true innerScrolled=true playerStayedStill=true visibleItemTapped=true outsideScroll=true")
    }

    @Test
    fun cancelUnhandledInputFailureAndDetachReleaseTheOriginalParent() {
        ui.runOnIdle {
            ui.activity.controller.release()
            val decor = ui.activity.window.decorView as ViewGroup
            val parent = RecordingParent(ui.activity)
            var consume = true
            var fail = false
            val child = View(ui.activity).apply {
                setOnTouchListener { view, event ->
                    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
                        view.parent.requestDisallowInterceptTouchEvent(false)
                        if (fail) throw IllegalStateException("Expected test input failure")
                    }
                    consume
                }
            }
            val host = PlayerTouchHost(ui.activity, child)
            parent.addView(host, FrameLayout.LayoutParams(100, 100))
            decor.addView(parent, ViewGroup.LayoutParams(100, 100))
            parent.measure(View.MeasureSpec.makeMeasureSpec(100, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(100, View.MeasureSpec.EXACTLY))
            parent.layout(0, 0, 100, 100)
            fun send(action: Int): Boolean {
                val now = SystemClock.uptimeMillis()
                val event = MotionEvent.obtain(now, now, action, 50f, 50f, 0)
                try { return host.dispatchTouchEvent(event) } finally { event.recycle() }
            }
            try {
                for (end in listOf(MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL)) {
                    assertTrue(send(MotionEvent.ACTION_DOWN))
                    assertEquals("A child cannot release the parent's interception lock mid-touch", true, parent.requests.last())
                    send(end)
                    assertEquals("Completed/cancelled input releases its parent", false, parent.requests.last())
                }
                consume = false
                assertFalse(send(MotionEvent.ACTION_DOWN))
                assertEquals("Unhandled DOWN cannot retain the parent", false, parent.requests.last())
                consume = true
                fail = true
                val failure = runCatching { send(MotionEvent.ACTION_DOWN) }.exceptionOrNull()
                assertTrue("The original dispatch failure is preserved", failure is IllegalStateException)
                assertEquals("Failed dispatch releases its parent", false, parent.requests.last())
                fail = false
                send(MotionEvent.ACTION_DOWN)
                assertEquals(true, parent.requests.last())
                parent.removeView(host)
                assertEquals("Detaching during a touch releases the original parent", false, parent.requests.last())
                val released = parent.requests.size
                host.releaseTouchOwnership()
                assertEquals("Detachment clears the old parent reference", released, parent.requests.size)
            } finally {
                decor.removeView(parent)
            }
        }
    }

    private fun outerScroll() = ui.onNodeWithTag("touch-outer").fetchSemanticsNode()
        .config[SemanticsProperties.VerticalScrollAxisRange].value()

    private fun read(web: WebView): JSONObject {
        val done = CountDownLatch(1)
        var result: String? = null
        ui.runOnUiThread {
            web.evaluateJavascript("""(() => {
                const p=document.getElementById('panel'), last=document.getElementById('last');
                if (!p || !last) return {};
                const r=p.getBoundingClientRect(), l=last.getBoundingClientRect();
                return {scrollTop:p.scrollTop,scrollHeight:p.scrollHeight,top:r.top,bottom:r.bottom,
                    lastTop:l.top,lastBottom:l.bottom,viewportHeight:innerHeight,selected:last.dataset.selected==='true'};
            })()""".trimIndent()) { result = it; done.countDown() }
        }
        assertTrue("Read-only overflow callback", done.await(5, TimeUnit.SECONDS))
        return JSONObject(requireNotNull(result))
    }

    private fun location(web: WebView) = IntArray(2).also { ui.runOnIdle { web.getLocationOnScreen(it) } }

    private fun dragPanel(web: WebView) {
        val state = read(web)
        val point = location(web)
        val x = point[0] + web.width / 2f
        fun y(value: Double) = point[1] + (value / state.getDouble("viewportHeight") * web.height).toFloat()
        gesture(x, y(state.getDouble("bottom") - 10), x, y(state.getDouble("top") + 10))
    }

    private fun gesture(x1: Float, y1: Float, x2: Float, y2: Float, duration: Long = 500) {
        val down = SystemClock.uptimeMillis()
        fun send(action: Int, x: Float, y: Float) {
            val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0)
            event.source = InputDevice.SOURCE_TOUCHSCREEN
            try { InstrumentationRegistry.getInstrumentation().sendPointerSync(event) } finally { event.recycle() }
        }
        send(MotionEvent.ACTION_DOWN, x1, y1)
        try {
            if (duration > 0) for (step in 1..20) {
                SystemClock.sleep(duration / 20)
                send(MotionEvent.ACTION_MOVE, x1 + (x2 - x1) * step / 20, y1 + (y2 - y1) * step / 20)
            }
            send(MotionEvent.ACTION_UP, x2, y2)
        } catch (failure: Throwable) {
            runCatching { send(MotionEvent.ACTION_CANCEL, x2, y2) }
            throw failure
        }
    }

    private class RecordingParent(context: Context) : FrameLayout(context) {
        val requests = mutableListOf<Boolean>()
        override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
            requests += disallowIntercept
            super.requestDisallowInterceptTouchEvent(disallowIntercept)
        }
    }

    private val fixture = """
        <!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>html,body{margin:0;height:220px}#panel{position:absolute;top:36px;left:18px;right:18px;height:121px;overflow-y:auto}
        button{display:block;box-sizing:border-box;width:100%;height:56px;padding:0;border:0;background:#ddd}</style>
        <div id="panel"><button>Quality</button><button>Speed</button><button>Audio</button>
        <button id="last" onclick="this.dataset.selected='true'">Subtitles</button></div>
    """.trimIndent()
}
