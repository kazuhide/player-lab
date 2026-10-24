package com.playerlab.android

import android.content.res.Configuration
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inspector.WindowInspector
import android.webkit.WebView
import androidx.compose.ui.semantics.SemanticsActions
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

/** Exercises the normal TV host with real Android key events, without substituting its UI or owners. */
@RunWith(AndroidJUnit4::class)
class PlayerTelevisionInputInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun backClosesTheSdkMenuAndReturnsToSourceWithoutLosingDraftsOrOwners() {
        requireTelevision()
        workspaceSource(ui, "VOD HLS")
        val controller = ui.activity.controller
        val player = controller.player
        await { player.source?.loadingState == com.bitmovin.player.api.source.LoadingState.Loaded }
        val source = controller.configuredSource
        val appliedTitle = controller.sourceSettings.title
        workspaceSetting(ui, "source-title")
        ui.onNodeWithTag("source-title").performTextReplacement("Unapplied TV title")
        settleKeyboard()
        ui.waitUntil(10_000) { webBoolean("Boolean(document.querySelector('.bmpui-ui-tv'))") }
        // Seed the visible native view for this Back regression. Full remote entry is checked separately.
        ui.runOnUiThread {
            assertTrue(descendants(ui.activity.window.decorView).filterIsInstance<WebView>().first().requestFocus())
        }
        await("The actual SDK WebView did not receive focus") { controller.currentView()?.hasFocus() == true }
        repeat(2) { press(KeyEvent.KEYCODE_DPAD_UP) }
        press(KeyEvent.KEYCODE_DPAD_DOWN)
        press(KeyEvent.KEYCODE_DPAD_DOWN)
        repeat(3) { press(KeyEvent.KEYCODE_DPAD_RIGHT) }
        press(KeyEvent.KEYCODE_DPAD_CENTER)
        ui.waitUntil(10_000) { settingsMenuVisible() }

        press(KeyEvent.KEYCODE_BACK)
        assertFalse("TV Back must keep the current Activity", ui.activity.isFinishing || ui.activity.isDestroyed)
        ui.waitUntil(10_000) { !settingsMenuVisible() }
        ui.onNodeWithTag("source-selector").assertIsFocused()
        ui.onNodeWithTag("source-title").assertTextContains("Unapplied TV title")
        ui.runOnUiThread {
            assertSame(player, controller.player)
            assertSame(source, controller.configuredSource)
            assertEquals(appliedTitle, controller.sourceSettings.title)
            assertFalse(player.isDestroyed)
        }
        ui.onNodeWithTag("source-selector").performClick()
        ui.onNodeWithTag("source-selector-options").assertIsDisplayed()
        press(KeyEvent.KEYCODE_BACK)
        ui.waitUntil(5_000) { ui.onAllNodesWithTag("source-selector-options").fetchSemanticsNodes().isEmpty() }
        ui.onNodeWithTag("source-title").assertTextContains("Unapplied TV title")
    }

    @Test fun dedicatedMediaKeyTogglesOnceWithoutAMediaSession() = mediaKeyTogglesOnce(false)

    @Test fun dedicatedMediaKeyTogglesOnceWithTheCurrentMediaSession() = mediaKeyTogglesOnce(true)

    @Test fun keyboardBackReturnsToTheSettingSelectorAndKeepsTheDraft() = nativeEditorReturnsFocus(false)

    @Test fun keyboardDoneReturnsToSourceAndKeepsTheDraft() = nativeEditorReturnsFocus(true)

    @Test fun searchKeyboardBackAllowsRemoteCandidateSelection() = searchReturnsToCandidates(false)

    @Test fun searchKeyboardDoneAllowsRemoteCandidateSelection() = searchReturnsToCandidates(true)

    @Test fun changingWorkspaceWhileClosingTheKeyboardKeepsTheNewFocusAndOldDraft() {
        requireTelevision()
        val controller = ui.activity.controller
        val player = controller.player
        val source = controller.configuredSource
        workspaceSetting(ui, "source-title")
        settleKeyboard()
        ui.onNodeWithTag("source-title").performClick()
        ui.waitUntil(10_000) { keyboardVisible() }
        ui.onNodeWithTag("source-title").performTextReplacement("Unapplied TV title")
        ui.onNodeWithTag("workspace-apis").performClick()
        ui.waitUntil(10_000) { !keyboardVisible() }
        ui.onNodeWithTag("api-command-selector").assertIsDisplayed()
            .performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        InstrumentationRegistry.getInstrumentation().uiAutomation.waitForIdle(100, 5_000)
        ui.onNodeWithTag("api-command-selector").assertIsFocused()
        ui.onNodeWithTag("workspace-apis").assertIsSelected()
        workspaceSetting(ui, "source-title")
        ui.onNodeWithTag("source-title").assertTextContains("Unapplied TV title")
        ui.runOnUiThread { assertSame(player, controller.player); assertSame(source, controller.configuredSource) }
    }

    private fun nativeEditorReturnsFocus(done: Boolean) {
        requireTelevision()
        val controller = ui.activity.controller
        val player = controller.player
        val source = controller.configuredSource
        val appliedTitle = controller.sourceSettings.title
        workspaceSetting(ui, "source-title")
        settleKeyboard()
        ui.onNodeWithTag("source-title").performClick()
        ui.waitUntil(10_000) { keyboardVisible() }
        ui.onNodeWithTag("source-title").performTextReplacement("Unapplied TV title")
        if (done) {
            ui.waitUntil(10_000) { runCatching { ui.onNodeWithTag("workspace-done").assertIsDisplayed() }.isSuccess }
            ui.onNodeWithTag("workspace-done").performClick()
        }
        else press(KeyEvent.KEYCODE_BACK)
        ui.waitUntil(10_000) { !keyboardVisible() }
        val target = if (done) "source-selector" else "configuration-setting"
        ui.waitUntil(5_000) { runCatching { ui.onNodeWithTag(target).assertIsFocused() }.isSuccess }
        if (!done) {
            press(KeyEvent.KEYCODE_DPAD_CENTER)
            ui.onNodeWithTag("configuration-setting-options").assertIsDisplayed()
            press(KeyEvent.KEYCODE_BACK)
            settleKeyboard()
            if (ui.onAllNodesWithTag("configuration-setting-options").fetchSemanticsNodes().isNotEmpty()) press(KeyEvent.KEYCODE_BACK)
            ui.waitUntil(5_000) { ui.onAllNodesWithTag("configuration-setting-options").fetchSemanticsNodes().isEmpty() }
        }
        ui.onNodeWithTag("source-title").assertTextContains("Unapplied TV title")
        ui.runOnUiThread {
            assertSame(player, controller.player)
            assertSame(source, controller.configuredSource)
            assertEquals(appliedTitle, controller.sourceSettings.title)
        }
    }

    private fun searchReturnsToCandidates(done: Boolean) {
        requireTelevision()
        val controller = ui.activity.controller
        val player = controller.player
        val source = controller.configuredSource
        workspaceSetting(ui, "source-title")
        ui.onNodeWithTag("source-title").performTextReplacement("Unapplied TV title")
        settleKeyboard()
        workspaceCommand(ui, "android:com.bitmovin.player.api.Player.play()")
        ui.onNodeWithTag("api-command-selector").performClick()
        ui.onNodeWithTag("api-command-selector-search").performClick()
        ui.waitUntil(10_000) { keyboardVisible() }
        ui.onNodeWithTag("api-command-selector-search").performTextReplacement("pause")
        if (done) ui.onNodeWithTag("api-command-selector-search").performImeAction()
        else press(KeyEvent.KEYCODE_BACK)
        ui.waitUntil(10_000) { !keyboardVisible() }
        val first = "api-command-selector-option-android:com.bitmovin.player.api.Player.pause()"
        val next = "api-command-selector-option-android:com.bitmovin.player.api.Player.onPause()"
        ui.waitUntil(5_000) { runCatching { ui.onNodeWithTag(first).assertIsFocused() }.isSuccess }
        press(KeyEvent.KEYCODE_DPAD_DOWN)
        ui.onNodeWithTag(next).assertIsFocused()
        press(KeyEvent.KEYCODE_DPAD_CENTER)
        workspaceWaitForPickerDismissal(ui, "api-command-selector")
        ui.onNodeWithTag("api-run-target").assertTextContains("api.Player.onPause()", substring = true)
        workspaceSetting(ui, "source-title")
        ui.onNodeWithTag("source-title").assertTextContains("Unapplied TV title")
        ui.runOnUiThread { assertSame(player, controller.player); assertSame(source, controller.configuredSource) }
    }

    private fun mediaKeyTogglesOnce(session: Boolean) {
        requireTelevision()
        workspaceSource(ui, "VOD HLS")
        val controller = ui.activity.controller
        val player = controller.player
        await { player.source?.loadingState == com.bitmovin.player.api.source.LoadingState.Loaded }
        val source = controller.configuredSource
        if (session) {
            workspaceCommand(ui, "app:media-session-enable")
            workspaceClick(ui, "api-command-run")
            ui.runOnUiThread { assertSame(player, controller.apiMediaSession?.player) }
        } else ui.runOnUiThread { assertNull(controller.apiMediaSession) }
        press(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        await { player.isPlaying && player.currentTime > 0.5 }
        val now = SystemClock.uptimeMillis()
        InstrumentationRegistry.getInstrumentation().sendKeySync(
            KeyEvent(now, now, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, 1))
        InstrumentationRegistry.getInstrumentation().sendKeySync(
            KeyEvent(now, now + 1, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, 0))
        SystemClock.sleep(300)
        ui.runOnUiThread { assertTrue("A repeated key and key-up must not toggle playback again", player.isPlaying) }
        press(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        await { player.isPaused }
        ui.runOnUiThread {
            assertSame(player, controller.player)
            assertSame(source, controller.configuredSource)
            assertEquals(session, controller.apiMediaSession != null)
        }
    }

    private fun requireTelevision() {
        assertEquals(Configuration.UI_MODE_TYPE_TELEVISION,
            ui.activity.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK)
        assertTrue(ui.activity.packageManager.hasSystemFeature("android.software.leanback"))
    }

    private fun keyboardVisible() = WindowInspector.getGlobalWindowViews().any {
        ViewCompat.getRootWindowInsets(it)?.isVisible(WindowInsetsCompat.Type.ime()) == true
    }

    private fun settleKeyboard() {
        closeSoftKeyboard()
        ui.waitUntil(10_000) { !keyboardVisible() }
        InstrumentationRegistry.getInstrumentation().uiAutomation.waitForIdle(100, 5_000)
        ui.waitForIdle()
    }

    private fun press(code: Int) {
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(code)
        ui.waitForIdle()
        SystemClock.sleep(100)
    }

    private fun settingsMenuVisible() = webBoolean("Array.from(document.querySelectorAll('.bmpui-ui-settings-panel')).some(e => getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden')")

    private fun webBoolean(expression: String): Boolean {
        var visible = false
        val latch = CountDownLatch(1)
        ui.runOnUiThread {
            val web = descendants(ui.activity.window.decorView).filterIsInstance<WebView>().firstOrNull()
            if (web == null) latch.countDown()
            else web.evaluateJavascript(expression) {
                visible = it == "true"
                latch.countDown()
            }
        }
        assertTrue("The actual SDK WebView must answer the menu observation", latch.await(10, TimeUnit.SECONDS))
        return visible
    }

    private fun await(message: String = "The actual TV playback state did not arrive", condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 30_000
        while (SystemClock.uptimeMillis() < deadline) {
            var ready = false
            ui.runOnUiThread { ready = condition() }
            if (ready) return
            SystemClock.sleep(100)
        }
        fail(message)
    }

    private fun descendants(view: View): List<View> = if (view is ViewGroup) {
        (0 until view.childCount).flatMap { index -> view.getChildAt(index).let { listOf(it) + descendants(it) } }
    } else emptyList()
}
