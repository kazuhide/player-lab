package com.playerlab.android

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextReplacement
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Exercises the real code view and Android clipboard; media playback is not required. */
@RunWith(AndroidJUnit4::class)
class PlayerConfigurationCodeInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test
    fun codeAndClipboardUseAppliedSettingsAndCurrentUiWithoutDraftEdits() {
        val controller = ui.activity.controller
        ui.onNodeWithText("Sports").performScrollTo().performClick()
        click("configuration-toggle")
        click("configuration-code-toggle")
        val original = code()
        assertTrue(original.contains("YOUR_PLAYER_KEY"))
        assertTrue(original.contains("buildSportsUI"))
        assertFalse(original.contains("AnalyticsConfig("))

        field("source-title", "Applied code fixture")
        field("source-live-target", "30")
        field("source-audio-languages", "de,en")
        field("source-subtitle-url", "https://example.com/captions.vtt")
        field("source-subtitle-label", "Exported captions")
        field("source-subtitle-language", "en")
        click("source-subtitle-default")
        field("config-audio-languages", "en,de")
        field("config-http-retries", "0.25,1")
        click("config-autoplay")
        assertEquals("Draft edits must not be exported", original, code())
        copyAndCheck(original)

        val player = controller.player
        val source = controller.configuredSource
        click("apply-source")
        ui.runOnIdle {
            assertTrue("Source Apply keeps the current player", player === controller.player)
            assertTrue("Source Apply creates a new source", source !== controller.configuredSource)
            assertEquals(30.0, controller.configuredSource?.config?.liveConfig?.targetLatency)
        }
        val applied = code()
        assertTrue(applied.contains("title = \"Applied code fixture\""))
        assertTrue(applied.contains("liveConfig = SourceLiveConfig(targetLatency = 30.0)"))
        assertTrue(applied.contains("preferredAudioLanguages = listOf(\"de\", \"en\")"))
        assertTrue(applied.contains("label = \"Exported captions\""))
        assertTrue(applied.contains("isDefault = true, language = \"en\""))
        assertTrue("Unapplied retry draft stays excluded", applied.contains("RetryHttpRequestConfig.LinearIncreasingBackoffRetry"))
        assertTrue("Unapplied autoplay draft stays excluded", applied.contains("isAutoplayEnabled = false"))
        ui.onNodeWithTag("configuration-code-copy").assertTextContains("Copy code")
        copyAndCheck(applied)

        click("apply-player")
        val appliedPlayer = code()
        assertTrue(appliedPlayer.contains("preferredAudioLanguages = listOf(\"en\", \"de\")"))
        assertTrue(appliedPlayer.contains("RetryHttpRequestConfig.Retry(listOf(0.25, 1.0))"))
        copyAndCheck(appliedPlayer)

        field("source-title", "Unapplied replacement")
        click("reset-source")
        assertEquals("Reset draft keeps the applied export", appliedPlayer, code())
        // Bring the horizontal UI row back into the outer vertical viewport first.
        ui.onNodeWithTag("player-lab-scroll").performScrollToNode(hasText("Default"))
        ui.onNodeWithText("Default").performScrollTo().assertIsDisplayed().performClick()
        ui.onNodeWithText("Default").assertIsNotEnabled()
        val defaultUi = code()
        println("CONFIGURATION_CODE_SAFE phase=ui-selection defaultSelected=true exportedDefault=${defaultUi.contains("val playerViewConfig = PlayerViewConfig()")}")
        assertTrue(defaultUi.contains("val playerViewConfig = PlayerViewConfig()"))
        assertFalse(defaultUi.contains("buildSportsUI"))
        copyAndCheck(defaultUi)
        println("CONFIGURATION_CODE_SAFE draftExcluded=true sourceApplied=true livePolicyRetained=true currentUi=true clipboardMatches=true placeholderKey=true")
    }

    private fun copyAndCheck(expected: String) {
        click("configuration-code-copy")
        ui.onNodeWithTag("configuration-code-copy").assertTextContains("Copied")
        ui.runOnIdle {
            val clipboard = ui.activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            assertEquals("Copy writes the actual OS clipboard", expected, clipboard.primaryClip?.getItemAt(0)?.text?.toString())
        }
    }

    private fun code(): String {
        ui.waitForIdle()
        return ui.onNodeWithTag("configuration-code-text").fetchSemanticsNode()
            .config[SemanticsProperties.Text].joinToString("") { it.text }
    }

    private fun click(tag: String) = ui.onNodeWithTag(tag).performScrollTo().assertIsDisplayed().performClick()
    private fun field(tag: String, value: String) {
        ui.onNodeWithTag(tag).performScrollTo().performTextReplacement(value)
        closeSoftKeyboard()
    }
}
