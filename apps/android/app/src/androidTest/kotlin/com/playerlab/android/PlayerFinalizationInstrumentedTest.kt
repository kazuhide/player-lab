package com.playerlab.android

import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bitmovin.player.PlayerView
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import com.bitmovin.player.api.source.Source
import com.playerlab.android.playback.PlaybackMode
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs

/** Requires the local runtime fixture, adb reverse and an authorized Player license. */
@RunWith(AndroidJUnit4::class)
class PlayerFinalizationInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val errors = CopyOnWriteArrayList<Int>()

    @Test fun hlsEndlistKeepsSourceOwnershipAndSwitchesFromDvrToVodControls() = finalizedSource("Hls", "master.m3u8")
    @Test fun dashStaticManifestKeepsSourceOwnershipAndSwitchesFromDvrToVodControls() = finalizedSource("Dash", "manifest.mpd")

    private fun finalizedSource(type: String, manifest: String) {
        val controller = ui.activity.controller
        val player = controller.player
        val loaded = AtomicBoolean()
        val finished = AtomicInteger()
        val shifted = AtomicInteger()
        val sought = AtomicInteger()
        var source: Source? = null
        ui.runOnUiThread {
            player.on(PlayerEvent.Error::class) { errors += it.code.value }
            player.on(SourceEvent.Error::class) { errors += it.code.value }
            player.on(PlayerEvent.TimeShifted::class) { if (player.source === source) shifted.incrementAndGet() }
            player.on(PlayerEvent.Seeked::class) { if (player.source === source) sought.incrementAndGet() }
            player.on(PlayerEvent.PlaybackFinished::class) {
                if (player.source === source) {
                    finished.incrementAndGet()
                    println("FINALIZATION_SAFE phase=finished type=$type nativeLive=${player.isLive} playerDuration=${player.duration} sourceDuration=${source?.duration} rangeStart=${source?.seekableRange?.start} rangeEnd=${source?.seekableRange?.end} position=${player.currentTime} relative=${player.currentTime + player.playbackTimeOffsetToRelativeTime} appMode=${controller.dvr.mode.raw} appDvr=${controller.dvr.dvrAvailable}")
                }
            }
        }
        workspaceTheme(ui, "Sports")
        click("configuration-toggle")
        field("source-url", "http://localhost:5272/$manifest")
        click("source-type-$type")
        field("source-live-target", "20")
        field("source-title", "Finalization fixture")
        // The finite live fixture must not age while its GUI draft is edited.
        // Leave room before its end for the real rewind and end-of-event checks.
        control("reset")
        ui.onNodeWithTag("apply-source").assertIsDisplayed()
            .performSemanticsAction(SemanticsActions.OnClick) { action ->
                assertTrue(action())
                source = requireNotNull(controller.configuredSource)
                assertEquals(20.0, requireNotNull(source!!.config.liveConfig?.targetLatency), 0.0)
                source!!.on(SourceEvent.Loaded::class) { loaded.set(true) }
            }
        click("configuration-toggle")
        await("fresh live fixture supplies a rewind window") { loaded.get() && player.source === source && player.isLive && controller.dvr.dvrAvailable }
        ui.waitForIdle()
        var web: WebView? = null
        await("current source WebView attaches") {
            val view = descendants(ui.activity.window.decorView).filterIsInstance<PlayerView>().singleOrNull { it.player === player }
            web = view?.let { descendants(it).filterIsInstance<WebView>().firstOrNull() }
            web != null
        }
        val view = requireNotNull(web)
        clickWeb(view, ".bmpui-ui-playbacktogglebutton")
        var clock = 0.0
        ui.runOnUiThread { clock = player.currentTime }
        await("live fixture advances") { player.isPlaying && player.currentTime > clock + 1 }
        var target = 0.0
        ui.runOnUiThread { target = player.currentTime - player.timeShift - 10 }
        workspaceMore(ui, "Live controls")
        ui.onNodeWithText("-10s").performScrollTo().performClick()
        await("rewind finishes at the captured media reference") { shifted.get() > 0 && player.timeShift < 0 && abs(player.currentTime - target) <= 3 }
        awaitWeb(view, """(() => { $visibleScript
          const label=visible('.bmpui-ui-label-behindlive');
          return !!label && label.textContent.trim().endsWith(' behind'); })()""", "visible behind-live state")
        control("finalize")
        await("same source finishes at its finite media end") {
            finished.get() > 0 && abs(player.currentTime + player.playbackTimeOffsetToRelativeTime - 60) <= 1
        }
        ui.runOnUiThread {
            assertTrue("Finalization must retain player and source", player === controller.player && source === player.source)
            assertEquals("Completed source must derive VOD state", PlaybackMode.VOD, controller.dvr.mode)
            assertTrue("Completed source must disable DVR", !controller.dvr.dvrAvailable)
        }
        workspaceMore(ui, "Live controls")
        ui.onNodeWithText("-10s").assertDoesNotExist()
        ui.onNodeWithText("Live edge").assertDoesNotExist()
        awaitWeb(view, """(() => { $visibleScript
          return !visible('.bmpui-ui-livebutton') && !visible('.bmpui-ui-label-behindlive') &&
            !!visible('.bmpui-ui-hugereplaybutton'); })()""", "completed source hides live controls and shows Replay")
        clickWeb(view, ".bmpui-ui-hugereplaybutton")
        await("same-source Replay advances from the start") { player.isPlaying && player.currentTime > 1 && player.currentTime < 10 }
        awaitWeb(view, """(() => { $visibleScript
          return !visible('.bmpui-ui-livebutton') && !visible('.bmpui-ui-label-behindlive'); })()""", "Replay keeps the completed source out of live mode")
        val beforeSeek = sought.get()
        awaitWeb(view, """(() => { $visibleScript
          const bar=visible('.bmpui-ui-seekbar .bmpui-seekbar'); if(!bar)return false;
          const r=bar.getBoundingClientRect(), input={bubbles:true,clientX:r.left+r.width*0.25,clientY:r.top+r.height/2,button:0};
          bar.dispatchEvent(new MouseEvent('mousedown',input));document.dispatchEvent(new MouseEvent('mouseup',input));return true;
        })()""", "visible VOD seek bar")
        await("completed source supports a fresh native VOD seek") { sought.get() > beforeSeek && player.currentTime in 14.0..18.0 }
        val state = control("state")
        assertTrue("Final manifest and actual media must be requested", state.getInt("finalManifests") > 0 && state.getInt("mediaRequests") > 0)
        control("reset")
        fieldAfterOpen("source-title", "New live generation")
        click("apply-source")
        click("configuration-toggle")
        await("new load resets the completed-source state") { controller.configuredSource !== source && player.isLive && controller.dvr.dvrAvailable }
        workspaceMore(ui, "Live controls")
        ui.onNodeWithText("Live edge").assertIsEnabled()
        awaitWeb(view, """(() => { $visibleScript
          return !!visible('.bmpui-ui-livebutton') && !!visible('.bmpui-ui-label-behindlive'); })()""", "new live load restores visible live controls")
        workspaceSource(ui, "VOD HLS")
        await("explicit VOD source switch remains available") { !player.isLive && controller.dvr.mode == PlaybackMode.VOD }
        println("FINALIZATION_SAFE phase=passed type=$type loaded=${loaded.get()} shifted=${shifted.get()} finished=${finished.get()} sought=${sought.get()} ownerRetained=true")
    }

    private fun control(operation: String): JSONObject {
        val connection = URL("http://localhost:5273/$operation").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = if (operation == "state") "GET" else "POST"
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            assertEquals("Fixture control response", 200, connection.responseCode)
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }
    private fun click(tag: String) = workspaceClick(ui, tag)
    private fun field(tag: String, value: String) {
        workspaceField(ui, tag, value)
        closeSoftKeyboard()
    }
    private fun fieldAfterOpen(tag: String, value: String) { click("configuration-toggle"); field(tag, value) }
    private fun await(label: String, condition: () -> Boolean) {
        ui.waitUntil(40_000) {
            var ready=false
            ui.runOnUiThread { ready=condition() }
            ready || errors.isNotEmpty() || ui.activity.controller.lastErrorCode != null
        }
        assertTrue("$label; error codes: $errors", errors.isEmpty())
        assertEquals("$label; startup code", null, ui.activity.controller.lastErrorCode)
    }
    private fun javascript(view: WebView, script: String): String? {
        val done=CountDownLatch(1)
        var result: String?=null
        ui.runOnUiThread { view.evaluateJavascript(script) { result=it; done.countDown() } }
        assertTrue(done.await(5,TimeUnit.SECONDS))
        return result
    }
    private fun clickWeb(view: WebView, selector: String) = awaitWeb(view, """(() => { $visibleScript
        const element=visible('${selector}');if(!element)return false;element.click();return true;})()""", "visible $selector")
    private fun awaitWeb(view: WebView, script: String, label: String) {
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(40)
        var lastTouchReveal=0L
        while(System.nanoTime()<deadline && errors.isEmpty() && ui.activity.controller.lastErrorCode==null) {
            ui.runOnUiThread {
                val now=android.os.SystemClock.uptimeMillis()
                val event=MotionEvent.obtain(now,now,MotionEvent.ACTION_HOVER_MOVE,view.width*0.4f,view.height/3f,0)
                event.source=InputDevice.SOURCE_MOUSE
                try { view.dispatchGenericMotionEvent(event) } finally { event.recycle() }
            }
            if(javascript(view,script)=="true")return
            if(android.os.SystemClock.uptimeMillis()-lastTouchReveal>=1000 && javascript(view,"""(() => { $visibleScript
                return !!document.elementFromPoint(innerWidth*.15,innerHeight*.25)?.matches('.bmpui-ui-touch-control-overlay') &&
                    !visible('.bmpui-ui-controlbar') && !visible('.bmpui-ui-settings-panel'); })()""")=="true") {
                workspaceTapVisiblePlayer(ui,view)
                lastTouchReveal=android.os.SystemClock.uptimeMillis()
            }
            Thread.sleep(100)
        }
        assertTrue("$label; native error codes: $errors",false)
    }
    private val visibleScript="""
      const visible=selector=>[...document.querySelectorAll(selector)].find(element=>{
        const r=element.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;
        for(let n=element;n;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)<=0)return false;}
        return true;
      });
    """.trimIndent()
    private fun descendants(view: View): List<View> = if(view is ViewGroup) (0 until view.childCount).flatMap {
        val child=view.getChildAt(it);listOf(child)+descendants(child)
    } else emptyList()
}
