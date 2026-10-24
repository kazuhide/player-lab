package com.playerlab.android

import android.view.KeyEvent
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.AnnotatedString
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Uses the normal Activity and the actual system keyboard without replacing app content. */
@RunWith(AndroidJUnit4::class)
class PlayerNormalInputInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun keyboardDoneAndDialogBackKeepTheDraftAndCurrentPlayer() {
        val controller = ui.activity.controller
        val player = controller.player
        val source = controller.configuredSource
        val appliedTitle = controller.sourceSettings.title
        workspaceSetting(ui, "source-title")
        ui.onNodeWithTag("source-title").performClick()
        ui.waitUntil(10_000) { keyboardVisible() }
        ui.onNodeWithTag("source-title").performTextReplacement("Default")
        ui.onNodeWithTag("source-title").assertIsDisplayed()
        ui.onNodeWithTag("workspace-done").assertIsDisplayed()
        ui.onNodeWithTag("apply-source").assertIsDisplayed()
        ui.onNodeWithTag("workspace-done").performClick()
        ui.waitUntil(10_000) { !keyboardVisible() }

        ui.onNodeWithTag("configuration-setting").assertIsDisplayed().performClick()
        ui.onNodeWithTag("configuration-setting-options").assertIsDisplayed()
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        ui.waitUntil(5_000) { ui.onAllNodesWithTag("configuration-setting-options").fetchSemanticsNodes().isEmpty() }
        ui.onNodeWithTag("source-title").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("Default")))
        ui.onNodeWithTag("apply-source").assertIsDisplayed()
        ui.runOnUiThread {
            assertSame(player, controller.player)
            assertSame(source, controller.configuredSource)
            assertEquals(appliedTitle, controller.sourceSettings.title)
        }
    }

    private fun keyboardVisible() = ViewCompat.getRootWindowInsets(ui.activity.window.decorView)
        ?.isVisible(WindowInsetsCompat.Type.ime()) == true
}
