package com.playerlab.android

import android.content.res.Configuration
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inspector.WindowInspector
import android.webkit.WebView
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Actual TV configuration and SDK rendering; full remote reachability is checked separately. */
@RunWith(AndroidJUnit4::class)
class PlayerTelevisionGuideInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun actualTvRendersTvControlsAndKeepsTheSharedWorkspaceAndPlayer() {
        assertEquals(Configuration.UI_MODE_TYPE_TELEVISION,
            ui.activity.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK)
        assertTrue(ui.activity.packageManager.hasSystemFeature("android.software.leanback"))
        val controller = ui.activity.controller
        val player = controller.player
        workspaceSource(ui, "VOD HLS")
        workspaceCommand(ui, "android:com.bitmovin.player.api.Player.play()")
        workspaceClick(ui, "api-command-run")
        await { player.isPlaying && player.currentTime > 0.5 }
        ui.waitUntil(20_000) { actualWebUiUsesTelevisionLayout() }
        val source = controller.configuredSource
        workspaceCommand(ui, "android:com.bitmovin.player.api.Player.seek()")
        workspaceField(ui, "api-argument-time", "30")
        workspaceClick(ui, "api-command-run")
        await { player.isPlaying && player.currentTime >= 31 }

        workspaceSetting(ui, "config-autoplay")
        ui.onNodeWithTag("config-autoplay").assertIsDisplayed().assertIsOff()
        ui.onNodeWithTag("apply-player").assertIsDisplayed()
        assertInsideSafeArea("source-selector")
        assertInsideSafeArea("configuration-setting")
        assertInsideSafeArea("apply-player")
        stableCapture("android-tv-workspace")

        ui.onNodeWithTag("configuration-setting").performClick()
        ui.onNodeWithTag("configuration-setting-options").assertIsDisplayed()
        closeSoftKeyboard()
        ui.waitUntil(10_000) { WindowInspector.getGlobalWindowViews().none {
            ViewCompat.getRootWindowInsets(it)?.isVisible(WindowInsetsCompat.Type.ime()) == true
        } }
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        ui.waitUntil(5_000) { ui.onAllNodesWithTag("configuration-setting-options").fetchSemanticsNodes().isEmpty() }
        ui.onNodeWithTag("config-autoplay").assertIsDisplayed().assertIsOff()

        workspaceCommand(ui, "android:com.bitmovin.player.api.Player.pause()")
        workspaceClick(ui, "api-command-run")
        await { player.isPaused }
        ui.onNodeWithTag("api-command-result").assertIsDisplayed()
        ui.onNodeWithTag("api-related-state").assertTextContains("isPaused=true", substring = true)
            .performScrollTo().assertIsDisplayed()
        assertInsideSafeArea("api-command-run")
        stableCapture("android-tv-api")

        workspaceAppliedCode(ui).assertTextContains("variant = UiConfig.WebUi.Variant.TvUi", substring = true)
            .assertTextContains("focusUiOnInitialization = true", substring = true)
        ui.runOnUiThread {
            assertSame(player, controller.player)
            assertSame(source, controller.configuredSource)
            assertFalse(player.isDestroyed)
        }
    }

    private fun actualWebUiUsesTelevisionLayout(): Boolean {
        val latch = CountDownLatch(1)
        var television = false
        ui.runOnUiThread {
            val web = descendants(ui.activity.window.decorView).filterIsInstance<WebView>().firstOrNull()
            if (web == null) latch.countDown()
            else web.evaluateJavascript("Boolean(document.querySelector('.bmpui-ui-tv'))") {
                television = it == "true"
                latch.countDown()
            }
        }
        assertTrue("The actual SDK WebView must answer the DOM observation", latch.await(10, TimeUnit.SECONDS))
        return television
    }

    private fun assertInsideSafeArea(tag: String) {
        val bounds = ui.onNodeWithTag(tag).assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        val metrics = ui.activity.resources.displayMetrics
        assertTrue("$tag left margin", bounds.left >= 48 * metrics.density - 1)
        assertTrue("$tag right margin", bounds.right <= metrics.widthPixels - 48 * metrics.density + 1)
        assertTrue("$tag top margin", bounds.top >= 27 * metrics.density - 1)
        assertTrue("$tag bottom margin", bounds.bottom <= metrics.heightPixels - 27 * metrics.density + 1)
    }

    private fun stableCapture(name: String) {
        ui.waitForIdle()
        InstrumentationRegistry.getInstrumentation().uiAutomation.waitForIdle(500, 5_000)
        ApiGuideScreenshot.capture(name, ui.activity)
    }

    private fun await(condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 45_000
        while (SystemClock.uptimeMillis() < deadline) {
            var ready = false
            ui.runOnUiThread { ready = condition() }
            if (ready) return
            SystemClock.sleep(100)
        }
        fail("Actual television playback state did not arrive")
    }

    private fun descendants(view: View): List<View> = if (view is ViewGroup) {
        (0 until view.childCount).flatMap { index -> view.getChildAt(index).let { listOf(it) + descendants(it) } }
    } else emptyList()
}
