package com.playerlab.sportsstreaming

import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Handler
import android.os.Bundle
import android.os.Looper
import android.view.PixelCopy
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.playerlab.sportsstreaming.core.StreamProtocol
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class SportsScreenCaptureTest {
    @Test fun captureActualLocalizedContent() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        val locale = args.getString("locale", "en")
        require(locale in setOf("en", "ja"))
        val name = args.getString("captureName", "sports-$locale")
        require(Regex("[A-Za-z0-9_.-]{1,80}").matches(name))
        val orientation = args.getString("orientation", "portrait")
        require(orientation in setOf("portrait", "landscape"))
        val fontScale = args.getString("fontScale", "1.0").toFloat()
        require(fontScale in 0.85f..2f)
        val fullscreen = args.getString("captureFullscreen", "false").toBooleanStrict()
        require(!fullscreen || args.getString("uiMode", "standard") == "sports")
        var previousLocales = LocaleListCompat.getEmptyLocaleList()
        var previousLanguage: String? = null
        val previousFontScale = DebugAppearance.fontScale
        instrumentation.runOnMainSync {
            DebugAppearance.fontScale = fontScale
        }
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra("mediaBaseUrl", requireNotNull(args.getString("mediaBaseUrl")))
        try {
            ActivityScenario.launch<MainActivity>(intent).use { scenario ->
                scenario.onActivity {
                    // AppCompat requires an active Activity before applying or reading per-app locales.
                    // https://developer.android.com/reference/androidx/appcompat/app/AppCompatDelegate#setApplicationLocales(androidx.core.os.LocaleListCompat)
                    previousLocales = AppCompatDelegate.getApplicationLocales()
                    previousLanguage = it.resources.configuration.locales[0].language
                    AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(locale))
                }
                instrumentation.waitForIdleSync()
                try {
                    waitUntil(scenario) {
                        it.resources.configuration.locales[0].language == locale &&
                            !it.playbackForTest().state.value.loadingCatalog && it.playbackForTest().state.value.catalog != null
                    }
                    // Locale changes can recreate the Activity; orient the resulting instance before loading media.
                    scenario.onActivity {
                        it.requestedOrientation = if (orientation == "landscape") ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                    }
                    instrumentation.waitForIdleSync()
                    waitUntil(scenario) {
                        val expected = if (orientation == "landscape") Configuration.ORIENTATION_LANDSCAPE else Configuration.ORIENTATION_PORTRAIT
                        it.resources.configuration.locales[0].language == locale && it.resources.configuration.orientation == expected &&
                            !it.playbackForTest().state.value.loadingCatalog && it.playbackForTest().state.value.catalog != null
                    }
                    val asset = args.getString("assetId", "SP-CLIP-A")
                    val protocol = StreamProtocol.valueOf(args.getString("protocol", "HLS").uppercase())
                    scenario.onActivity {
                        it.playbackForTest().selectAsset(asset, protocol)
                        it.switchUiForTest(args.getString("uiMode", "standard") == "sports")
                    }
                    waitUntil(scenario) {
                        val configuration = it.resources.configuration
                        val expected = if (orientation == "landscape") Configuration.ORIENTATION_LANDSCAPE else Configuration.ORIENTATION_PORTRAIT
                        it.playbackForTest().player.isPlaying && it.playbackForTest().player.currentTime > 0.2 &&
                            configuration.orientation == expected && configuration.locales[0].language == locale
                    }
                    if (fullscreen) {
                        lateinit var before: OwnershipSnapshot
                        var enter = ""
                        var exit = ""
                        scenario.onActivity {
                            before = it.playbackForTest().snapshot()
                            assertNotNull("Fullscreen continuity requires a configured Analytics impression", before.impressionId)
                            enter = it.getString(R.string.fullscreen)
                            exit = it.getString(R.string.exit_fullscreen)
                        }
                        val device = UiDevice.getInstance(instrumentation)
                        val button = device.wait(Until.findObject(By.desc(enter)), 5_000)
                        assertNotNull("The native fullscreen action must be operable", button)
                        button.click()
                        assertTrue(device.wait(Until.hasObject(By.desc(exit)), 5_000))
                        waitUntil(scenario) {
                            val after = it.playbackForTest().snapshot()
                            after.player === before.player && after.source === before.source && after.impressionId == before.impressionId &&
                                after.loadCount == before.loadCount && !after.paused && after.positionSeconds > before.positionSeconds + 0.2
                        }
                    }
                    Thread.sleep(600)
                    var bounds = Rect()
                    val metadata = JSONObject()
                    scenario.onActivity {
                        val decor = it.window.decorView
                        val insets = ViewCompat.getRootWindowInsets(decor)?.getInsets(WindowInsetsCompat.Type.systemBars())
                        bounds = Rect(insets?.left ?: 0, insets?.top ?: 0,
                            decor.width - (insets?.right ?: 0), decor.height - (insets?.bottom ?: 0))
                        metadata.put("locale", it.resources.configuration.locales[0].language)
                            .put("fontScale", it.resources.configuration.fontScale)
                            .put("orientation", orientation).put("assetId", asset).put("protocol", protocol.name)
                            .put("fullscreen", fullscreen)
                            .put("contentRect", JSONArray(listOf(bounds.left, bounds.top, bounds.right, bounds.bottom)))
                    }
                    assertTrue(bounds.width() > 0 && bounds.height() > 0)
                    assertVisibleControls(scenario, bounds, args.getString("uiMode", "standard") == "sports", fullscreen)
                    val method = args.getString("captureMethod", "pixel-copy")
                    val bitmap = if (method == "display") {
                        val display = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
                        Bitmap.createBitmap(display, bounds.left, bounds.top, bounds.width(), bounds.height()).also {
                            if (it !== display) display.recycle()
                        }
                    } else {
                        require(method == "pixel-copy")
                        val copy = Bitmap.createBitmap(bounds.width(), bounds.height(), Bitmap.Config.ARGB_8888)
                        val latch = CountDownLatch(1)
                        var result = -1
                        scenario.onActivity {
                            PixelCopy.request(it.window, bounds, copy, { code -> result = code; latch.countDown() }, Handler(Looper.getMainLooper()))
                        }
                        assertTrue("Native capture did not complete", latch.await(5, TimeUnit.SECONDS))
                        assertEquals(PixelCopy.SUCCESS, result)
                        copy
                    }
                    metadata.put("captureMethod", method).put("width", bitmap.width).put("height", bitmap.height)
                    val directory = File(instrumentation.targetContext.filesDir, "captures").apply { mkdirs() }
                    File(directory, "$name.png").outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
                    bitmap.recycle()
                    File(directory, "$name.json").writeText(metadata.toString(2))
                } finally {
                    scenario.onActivity { AppCompatDelegate.setApplicationLocales(previousLocales) }
                    instrumentation.waitForIdleSync()
                    val restored = requireNotNull(previousLanguage)
                    waitUntil(scenario) { it.resources.configuration.locales[0].language == restored }
                }
            }
        } finally {
            instrumentation.runOnMainSync { DebugAppearance.fontScale = previousFontScale }
        }
    }
    private fun assertVisibleControls(scenario: ActivityScenario<MainActivity>, content: Rect, sports: Boolean, fullscreen: Boolean) {
        val controls = mutableListOf<BySelector>()
        var minimumTouchPixels = 0
        scenario.onActivity {
            minimumTouchPixels = (48 * it.resources.displayMetrics.density).toInt() - 1
            controls.add(By.text(it.getString(if (sports) R.string.standard_ui else R.string.sports_ui)))
            if (sports) {
                controls.add(By.desc(it.getString(R.string.back_15)))
                controls.add(By.desc(it.getString(R.string.forward_15)))
                controls.add(By.desc(it.getString(if (fullscreen) R.string.exit_fullscreen else R.string.fullscreen)))
                controls.add(By.text(it.getString(R.string.subtitles)))
                controls.add(By.text(it.getString(R.string.speed)))
                controls.add(By.desc(it.getString(R.string.pip)))
            }
        }
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        controls.forEach { selector ->
            val label = device.wait(Until.findObject(selector.pkg("com.playerlab.sportsstreaming")), 5_000)
            assertNotNull("A visible player control must exist in the actual viewport: $selector", label)
            val button = generateSequence(label) { it.parent }.take(8).firstOrNull { it.isClickable }
            assertNotNull("The visible control must have an actual button action", button)
            val visible = button!!.visibleBounds
            assertTrue("The control must retain its touch area inside the app viewport: $selector at $visible",
                visible.width() >= minimumTouchPixels && visible.height() >= minimumTouchPixels && content.contains(visible))
        }
    }
    private fun waitUntil(scenario: ActivityScenario<MainActivity>, predicate: (MainActivity) -> Boolean) {
        val deadline = System.nanoTime() + 45_000_000_000L
        while (System.nanoTime() < deadline) {
            var passed = false
            scenario.onActivity {
                assertNull("SDK error code ${it.playbackForTest().lastErrorCode}", it.playbackForTest().lastErrorCode)
                passed = predicate(it)
            }
            if (passed) return
            Thread.sleep(100)
        }
        scenario.onActivity { activity ->
            val session = activity.playbackForTest()
            InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply {
                putString("captureActualLocale", activity.resources.configuration.locales[0].language)
                putInt("captureActualOrientation", activity.resources.configuration.orientation)
                putInt("captureRequestedOrientation", activity.requestedOrientation)
                putInt("captureScreenWidthDp", activity.resources.configuration.screenWidthDp)
                putInt("captureScreenHeightDp", activity.resources.configuration.screenHeightDp)
                putBoolean("captureMultiWindow", activity.isInMultiWindowMode)
                putBoolean("capturePlaying", session.player.isPlaying)
                putDouble("capturePositionSeconds", session.player.currentTime)
                putBoolean("captureSourceLoading", session.state.value.loadingSource)
                putString("captureCastConnection", session.state.value.castConnection.name)
            })
        }
        fail("The actual localized viewport and playback were not ready")
    }
}
