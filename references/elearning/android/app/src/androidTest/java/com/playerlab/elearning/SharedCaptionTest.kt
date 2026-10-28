package com.playerlab.elearning

import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.Button
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.api.event.PlayerEvent
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class SharedCaptionTest {
    @Test fun englishPausedCaptionSurvivesBothModesAndRecreation() { checkCaption("en") }
    @Test fun japanesePausedCaptionSurvivesBothModesAndRecreation() { checkCaption("ja") }

    private fun checkCaption(language: String) {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertTrue(context.getSharedPreferences("learning-progress", Context.MODE_PRIVATE).edit().clear().commit())
        GuideLocaleOverride.setForTest(language)
        val expected = if (language == "ja") "数字を読みます。" else "Read the numbers."
        var intendedCue = false
        val entered: (PlayerEvent.CueEnter) -> Unit = { if (it.cue.styledText?.contains(expected) == true) intendedCue = true }
        try {
            val intent = Intent(context, MainActivity::class.java).apply {
                InstrumentationRegistry.getArguments().getString("mediaBaseUrl")?.let { putExtra("mediaBaseUrl", it) }
            }
            ActivityScenario.launch<MainActivity>(intent).use { scenario ->
                try {
                    scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
                    await(scenario, "Portrait configuration unavailable") { it.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_PORTRAIT }
                    await(scenario, "Catalog unavailable") { it.sessionForTest().let { s -> s.catalog != null && !s.progressLoading } }
                    scenario.onActivity { activity -> activity.sessionForTest().apply {
                        player.on(PlayerEvent.CueEnter::class, entered)
                        setFormat(if (InstrumentationRegistry.getArguments().getString("streamFormat") == "dash") StreamFormat.DASH else StreamFormat.HLS)
                        startLesson("EDU-FX-01", play = false)
                    } }
                    await(scenario, "Player or captions not ready") { it.sessionForTest().let { s -> s.playbackReady && s.player.source?.availableSubtitleTracks?.size == 2 } }
                    scenario.onActivity { it.sessionForTest().apply { setSubtitle(SubtitlePreference(true, language)); seek(10_500); player.play() } }
                    await(scenario, "Intended current cue was not drawn") { intendedCue && it.sessionForTest().positionMs in 10_000..12_500 && nativeCaptionPixels(it) > 0 }
                    scenario.onActivity { it.sessionForTest().player.pause() }
                    await(scenario, "Pause did not retain the current cue") { !it.sessionForTest().player.isPlaying && nativeCaptionPixels(it) > 0 }
                    awaitSdkHtmlControls(scenario)
                    assertFalse("The HTML caption layer must be suppressed", sdkHtmlState(scenario).getBoolean("htmlCaptionVisible"))
                    // Inject real window input through the native caption layer to the SDK controls.
                    tapHtmlPlay(scenario)
                    await(scenario, "The SDK Play control did not receive touch") { it.sessionForTest().player.isPlaying }
                    tapHtmlPlay(scenario)
                    await(scenario, "The SDK Pause control did not receive touch") { !it.sessionForTest().player.isPlaying }
                    var before: PlaybackSnapshot? = null
                    scenario.onActivity { before = it.snapshot() }
                    repeat(2) {
                        clickMode(scenario, R.string.learning_ui)
                        await(scenario, "Learning lost the current caption") { nativeCaptionPixels(it) > 0 && it.snapshot().subtitleViews == 1 }
                        scenario.recreate()
                        await(scenario, "Learning recreation lost the current caption") { nativeCaptionPixels(it) > 0 && it.snapshot().subtitleViews == 1 }
                        clickMode(scenario, R.string.default_ui)
                        await(scenario, "Standard lost the current caption") { nativeCaptionPixels(it) > 0 && it.snapshot().subtitleViews == 1 }
                        awaitSdkHtmlControls(scenario)
                        assertFalse(sdkHtmlState(scenario).getBoolean("htmlCaptionVisible"))
                        scenario.recreate()
                        await(scenario, "Standard recreation lost the current caption") { nativeCaptionPixels(it) > 0 && it.snapshot().subtitleViews == 1 }
                    }
                    scenario.onActivity { activity ->
                        val original = requireNotNull(before)
                        val current = activity.snapshot()
                        assertEquals(original.playerIdentity, current.playerIdentity)
                        assertEquals(original.sourceIdentity, current.sourceIdentity)
                        assertEquals(original.impressionId, current.impressionId)
                        assertEquals(original.loads, current.loads)
                        assertEquals(original.seeks, current.seeks)
                        assertEquals(original.time, current.time, 0.2)
                        assertEquals(original.speed, current.speed, 0f)
                        assertEquals(original.subtitleId, current.subtitleId)
                        assertEquals(1, current.playerViews)
                        assertEquals(1, current.subtitleViews)
                        assertFalse(current.playing)
                    }
                } finally { scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED; it.sessionForTest().player.off(PlayerEvent.CueEnter::class, entered) } }
            }
        } finally { GuideLocaleOverride.setForTest(null) }
    }

    private fun clickMode(scenario: ActivityScenario<MainActivity>, id: Int) { scenario.onActivity { activity ->
        val button = descendants(activity.window.decorView).filterIsInstance<Button>().single { it.isShown && it.text.toString() == activity.getString(id) }
        assertTrue(button.performClick())
    } }

    private fun await(scenario: ActivityScenario<MainActivity>, message: String, predicate: (MainActivity) -> Boolean) {
        val deadline = System.nanoTime() + 35_000_000_000L
        do {
            var ready = false
            scenario.onActivity { assertNull(it.sessionForTest().errorCode); ready = predicate(it) }
            if (ready) return
            Thread.sleep(80)
        } while (System.nanoTime() < deadline)
        var state = ""
        scenario.onActivity { activity -> activity.sessionForTest().apply {
            state = "time=$positionMs ready=$playbackReady cues=$activeCueCount selected=${player.source?.selectedSubtitleTrack?.language} " +
                "renderer=${subtitleRenderer.width}x${subtitleRenderer.height} shown=${subtitleRenderer.isShown} padding=${subtitleRenderer.paddingBottom} pixels=${nativeCaptionPixels(activity)}"
        } }
        fail("$message; $state")
    }

    private fun tapHtmlPlay(scenario: ActivityScenario<MainActivity>) {
        awaitSdkHtmlControls(scenario)
        val state = sdkHtmlState(scenario)
        val now = SystemClock.uptimeMillis()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP).forEach { action ->
            val event = MotionEvent.obtain(now, SystemClock.uptimeMillis(), action, state.getDouble("playX").toFloat(), state.getDouble("playY").toFloat(), 0)
            event.source = InputDevice.SOURCE_TOUCHSCREEN
            instrumentation.sendPointerSync(event)
            event.recycle()
        }
    }


}

internal fun awaitSdkHtmlControls(scenario: ActivityScenario<MainActivity>) {
    val deadline = System.nanoTime() + 15_000_000_000L
    do {
        val state = sdkHtmlState(scenario)
        if (state.optBoolean("ready") && state.optBoolean("overlaySuppressed") && state.has("playX")) return
        Thread.sleep(80)
    } while (System.nanoTime() < deadline)
    fail("The real SDK HTML controls and supplemental CSS did not become ready")
}


internal fun sdkHtmlState(scenario: ActivityScenario<MainActivity>): JSONObject {
    val done = CountDownLatch(1)
    var state = JSONObject()
    scenario.onActivity { activity ->
        val web = descendants(activity.window.decorView).filterIsInstance<WebView>().singleOrNull { it.isShown && it.width > 0 }
        if (web == null) done.countDown() else {
            val location = IntArray(2).also(web::getLocationOnScreen)
            @Suppress("DEPRECATION") val scale = web.scale.toDouble()
            val script = """(()=>{const e=document.querySelector('.bmpui-ui-subtitle-overlay');const buttons=[...document.querySelectorAll('.bmpui-ui-playbacktogglebutton')];const b=buttons.find(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0;});const r=b?.getBoundingClientRect();return JSON.stringify({ready:document.readyState==='complete',overlaySuppressed:!!e&&getComputedStyle(e).display==='none',htmlCaptionVisible:!!e&&getComputedStyle(e).display!=='none',...(r?{playX:r.x+r.width/2,playY:r.y+r.height/2}:{})});})()"""
            web.evaluateJavascript(script) { value ->
                runCatching {
                    state = JSONObject(JSONTokener(value).nextValue() as String)
                    if (state.has("playX")) state.put("playX", location[0] + state.getDouble("playX") * scale).put("playY", location[1] + state.getDouble("playY") * scale)
                }
                done.countDown()
            }
        }
    }
    assertTrue("Read-only SDK UI observation timed out", done.await(5, TimeUnit.SECONDS))
    return state
}

internal fun descendants(view: View): List<View> = listOf(view) + if (view is ViewGroup) (0 until view.childCount).flatMap { descendants(view.getChildAt(it)) } else emptyList()

internal fun nativeCaptionPixels(activity: MainActivity): Int {
    val view = activity.sessionForTest().subtitleRenderer
    if (!view.isShown || view.width <= 0 || view.height <= 0) return 0
    val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
    view.draw(Canvas(bitmap))
    val pixels = IntArray(view.width * view.height)
    bitmap.getPixels(pixels, 0, view.width, 0, 0, view.width, view.height)
    bitmap.recycle()
    return pixels.count { it ushr 24 != 0 }
}
