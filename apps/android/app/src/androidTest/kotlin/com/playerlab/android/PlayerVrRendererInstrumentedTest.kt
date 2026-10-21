package com.playerlab.android

import android.graphics.Bitmap
import android.os.Handler
import android.os.Bundle
import android.os.Looper
import android.os.SystemClock
import android.view.PixelCopy
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.api.source.SourceType
import com.bitmovin.player.api.vr.VrRenderer
import com.bitmovin.player.api.vr.orientation.ViewingDirection
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class PlayerVrRendererInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val prefix = "android:com.bitmovin.player.api."

    @Test fun guiRendererDrawsDecodedFramesChangesProjectionAndRetiresItsCallbacks() {
        val c = ui.activity.controller
        ui.runOnUiThread {
            c.applySource(SourceSettings("https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8", SourceType.Hls))
            c.applyPlayerSettings(PlayerSettings(autoplay = true, muted = true))
        }
        await("Initial playback") { c.player.isPlaying && c.player.currentTime > 1.5 }
        step("Baseline decoded")
        click("api-settings-toggle")
        field("api-settings-search", "vr.VrConfig.vrContentType")
        click("api-select-${prefix}vr.VrConfig.vrContentType")
        field("api-setting-value", "Single")
        click("api-setting-stage")
        click("api-settings-apply")
        await("VR source playback") { c.player.isPlaying && c.player.currentTime > 1.5 }
        step("VR source decoded")
        click("api-runtime-toggle")
        command("vr.VrApi.setVrRenderer()", mapOf("enabled" to "true"))
        await("Decoder frames on the host GL surface") {
            c.apiVrRenderer?.let { !it.hasFailed && it.decodedFrames > 5 && it.drawnFrames > 5 && it.width > 0 && it.height > 0 } == true
        }
        val renderer = requireNotNull(c.apiVrRenderer)
        step("Host GL frames decoded and drawn")
        val sourceUpdates = renderer.sourceUpdates
        command("vr.VrRenderer.setSourceConfig()", mapOf("source" to "Active"))
        assertTrue(renderer.sourceUpdates > sourceUpdates)
        command("vr.VrRenderer.addUpdateCallback()", mapOf("handle" to "vr-test", "everyFrames" to "1",
            "body" to "return {text: 'frame ' + input.delta.toFixed(3)};"))
        await("Edited GUI update callback") { c.apiVrCallbackStates["vr-test"]?.contains("result=frame ") == true }
        ui.runOnUiThread { assertTrue(c.apiVrCallbackStates.getValue("vr-test").contains("fallback=0")) }
        step("Edited callback invoked")

        val probeCalls = AtomicLong()
        val delta = AtomicReference<Double>()
        val probe = VrRenderer.UpdateCallback { value -> probeCalls.incrementAndGet(); delta.set(value) }
        ui.runOnUiThread { renderer.addUpdateCallback(probe); c.player.pause() }
        await("Paused video with active VR rendering") { c.player.isPaused && probeCalls.get() > 2 }
        assertTrue(delta.get().isFinite() && delta.get() >= 0.0)
        var stableFrames = renderer.decodedFrames
        var stableSince = SystemClock.uptimeMillis()
        await("The paused decoder frame stops changing") {
            if (renderer.decodedFrames != stableFrames) { stableFrames = renderer.decodedFrames; stableSince = SystemClock.uptimeMillis() }
            SystemClock.uptimeMillis() - stableSince > 300
        }
        val first = copySurface(renderer)
        try {
            val drawn = renderer.drawnFrames
            ui.runOnUiThread { c.player.vr.viewingDirection = ViewingDirection(pitch = 0.0, roll = 0.0, yaw = 45.0) }
            await("The changed viewport is drawn") { renderer.drawnFrames > drawn + 3 }
            assertEquals(stableFrames, renderer.decodedFrames)
            val rotated = copySurface(renderer)
            try {
                var changed = 0
                var colored = 0
                for (y in 0 until first.height step 8) for (x in 0 until first.width step 8) {
                    if (first.getPixel(x, y) != rotated.getPixel(x, y)) changed++
                    if ((first.getPixel(x, y) and 0x00ffffff) != 0) colored++
                }
                assertTrue("The decoder produces visible video", colored > 50)
                assertTrue("A VR direction change changes a frozen decoded image", changed > 50)
            } finally { rotated.recycle() }
        } finally { first.recycle() }
        step("Frozen decoded frame changes with viewing direction")

        val callbacks = renderer.callbackCount
        command("vr.VrRenderer.removeUpdateCallback()", mapOf("handle" to "vr-test"))
        assertEquals(callbacks - 1, renderer.callbackCount)
        ui.runOnUiThread { renderer.removeUpdateCallback(probe) }
        val stoppedProbe = probeCalls.get()
        val drawn = renderer.drawnFrames
        await("Rendering continues after observer removal") { renderer.drawnFrames > drawn + 3 }
        assertEquals(stoppedProbe, probeCalls.get())
        step("Removed observers stop while rendering continues")
        command("vr.VrApi.setVrRenderer()", mapOf("enabled" to "false"))
        await("The normal PlayerView is restored") { c.apiVrRenderer == null && c.currentView()?.player === c.player }
        assertEquals(0, renderer.callbackCount)
        val stopped = renderer.callbackCalls
        var previous = 0.0
        ui.runOnUiThread { previous = c.player.currentTime; c.player.play() }
        await("Playback continues after restoring the normal view") { c.player.isPlaying && c.player.currentTime > previous + 0.5 }
        assertEquals(stopped, renderer.callbackCalls)
        ui.runOnUiThread { assertNull(c.lastErrorCode) }
        step("Normal view restored and playback advances")
    }

    private fun copySurface(renderer: ApiVrRenderer): Bitmap {
        lateinit var bitmap: Bitmap
        var result = -1
        val copied = CountDownLatch(1)
        ui.runOnUiThread {
            bitmap = Bitmap.createBitmap(renderer.width, renderer.height, Bitmap.Config.ARGB_8888)
            PixelCopy.request(renderer, bitmap, { code -> result = code; copied.countDown() }, Handler(Looper.getMainLooper()))
        }
        check(copied.await(5, TimeUnit.SECONDS)) { "PixelCopy did not finish." }
        check(result == PixelCopy.SUCCESS) { "PixelCopy failed ($result)." }
        return bitmap
    }

    private fun command(member: String, inputs: Map<String, String>) {
        field("api-runtime-search", member)
        click("api-command-$prefix$member")
        for ((name, value) in inputs) field("api-argument-$name", value)
        click("api-command-run")
        ui.onNodeWithTag("api-command-result").assertTextContains("Command submitted", substring = true)
    }
    private fun click(tag: String) = ui.onNodeWithTag(tag).performScrollTo().performClick()
    private fun step(message: String) = InstrumentationRegistry.getInstrumentation().sendStatus(2,
        Bundle().apply { putString("stream", "VR qualification: $message\n") })
    private fun field(tag: String, value: String) {
        ui.onNodeWithTag(tag).performScrollTo().performTextReplacement(value)
        closeSoftKeyboard()
    }
    private fun await(label: String, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 45_000
        while (SystemClock.uptimeMillis() < deadline) {
            ui.waitForIdle()
            var ready = false
            ui.runOnUiThread { ready = condition() }
            if (ready) return
            SystemClock.sleep(50)
        }
        fail(label)
    }
}
