package com.playerlab.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bitmovin.player.api.DebugConfig
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Run each method in a separate instrumentation process to verify the startup boundary. */
@RunWith(AndroidJUnit4::class)
class PlayerStartupSettingInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    @Test fun saveTrueForNextLaunch() {
        assertFalse(DebugConfig.isLoggingEnabled)
        workspaceMore(ui, "Startup and integrations")
        ui.onNodeWithTag("api-startup-logging").performScrollTo().assertIsOff().performClick()
        click("api-startup-save")
        assertTrue(ApiStartupSettings.read(ui.activity))
        assertFalse("Saving must not mutate startup-only SDK state in the running process", DebugConfig.isLoggingEnabled)
        ui.onNodeWithTag("api-startup-state").assertTextContains("Current process: false; saved for next launch: true", substring = true)
    }
    @Test fun verifyEnabledAndSaveFalse() {
        assertTrue("Application applies the saved value before any Player/Source/View", DebugConfig.isLoggingEnabled)
        workspaceMore(ui, "Startup and integrations")
        ui.onNodeWithTag("api-startup-logging").performScrollTo().assertIsOn().performClick()
        click("api-startup-save")
        assertFalse(ApiStartupSettings.read(ui.activity)); assertTrue(DebugConfig.isLoggingEnabled)
    }
    @Test fun verifyDisabledAfterRestart() {
        assertFalse(DebugConfig.isLoggingEnabled); assertFalse(ApiStartupSettings.read(ui.activity))
        workspaceMore(ui, "Startup and integrations")
        ui.onNodeWithTag("api-startup-state").performScrollTo().assertTextContains("Current process: false; saved for next launch: false", substring = true)
    }
    private fun click(tag: String) = workspaceClick(ui, tag)
}
