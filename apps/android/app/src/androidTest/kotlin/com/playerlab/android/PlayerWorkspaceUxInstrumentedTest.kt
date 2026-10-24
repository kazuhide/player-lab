package com.playerlab.android

import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.AnnotatedString
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.rules.TestName
import java.io.File

/** Tests real workspace navigation and fixed actions; it does not require media or a license. */
@RunWith(AndroidJUnit4::class)
class PlayerWorkspaceUxInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    @get:Rule val testName = TestName()

    @After fun recordLastFrame() { capture("android-ux-last-${testName.methodName}") }

    @Test
    fun everyCommonSettingHasDirectEntryAndVisibleActionsWithoutFormScrolling() {
        for (item in configurationItems) {
            workspaceSetting(ui, item.id)
            assertFullyVisible(item.id, 48)
            ui.onNodeWithTag(if (item.group == "Source") "apply-source" else "apply-player").assertIsDisplayed()
            ui.onNodeWithTag(if (item.group == "Source") "reset-source" else "reset-player").assertIsDisplayed()
            ui.onNodeWithTag("player-preview").assertIsDisplayed()
            ui.onNodeWithTag("workspace-navigation").assertIsDisplayed()
            if (item.id == "source-url") capture("android-workspace-source")
            if (item.id == "config-autoplay") capture("android-workspace-player")
        }
        capture("android-workspace-settings")
    }

    @Test
    fun draftsSurviveNavigationAndValidationOpensTheInvalidSetting() {
        workspaceField(ui, "source-title", "Draft kept across tabs")
        workspaceField(ui, "source-offset", "NaN")
        ui.onNodeWithTag("workspace-code").performClick()
        ui.onNodeWithTag("configuration-code-text").assertTextContains("YOUR_PLAYER_KEY", substring = true)
        val exported = ui.onNodeWithTag("configuration-code-text").fetchSemanticsNode().config[SemanticsProperties.Text].joinToString { it.text }
        assertFalse("Unapplied draft must not leak into exported code", exported.contains("Draft kept across tabs"))
        ui.onNodeWithTag("workspace-more").performClick()
        ui.onNodeWithTag("workspace-settings").performClick()
        workspaceSetting(ui, "source-title")
        ui.onNodeWithTag("source-title").assert(editable("Draft kept across tabs"))
        ui.onNodeWithTag("apply-source").assertIsDisplayed().performClick()
        ui.onNodeWithTag("source-offset").assertIsDisplayed().assert(editable("NaN"))
        ui.onNodeWithTag("configuration-validation").assertTextContains("draft is retained", substring = true)
        workspaceSetting(ui, "source-title")
        ui.onNodeWithTag("source-title").assert(editable("Draft kept across tabs"))
    }

    @Test
    fun searchDoesNotChangeRunTargetAndRunReportsSeparateSdkObservation() {
        val pause = ApiRuntime.commands.first { it.id.endsWith("api.Player.pause()") }
        workspaceCommand(ui, pause.id)
        ui.onNodeWithTag("api-command-selector").performClick()
        ui.onNodeWithTag("api-command-selector-search").performTextReplacement("play")
        ui.onNodeWithText("Close").performClick()
        workspaceWaitForPickerDismissal(ui, "api-command-selector")
        ui.onNodeWithTag("api-run-target").assertTextContains(pause.label, substring = true)
        ui.onNodeWithTag("api-command-run").assertIsDisplayed().performClick()
        ui.onNodeWithTag("api-command-result").assertTextContains("Command submitted", substring = true)
        ui.onNodeWithTag("api-related-state").assertTextContains("isPaused=", substring = true)
        capture("android-workspace-api")
        workspaceState(ui, "android:com.bitmovin.player.api.Player.isPaused").assertIsDisplayed()
        capture("android-workspace-state")
        workspaceEvent(ui, "PlayerEvent.Paused").assertIsDisplayed()
        capture("android-workspace-events")
        workspaceAppliedCode(ui).assertIsDisplayed()
        capture("android-workspace-code")
        val previousView = ui.activity.controller.currentView()
        workspaceCommand(ui, "android:com.bitmovin.player.PlayerView.onDestroy()")
        ui.onNodeWithTag("api-command-run").assertIsDisplayed().performClick()
        ui.waitUntil(5_000) {
            var replaced = false
            ui.runOnUiThread { replaced = ui.activity.controller.currentView()?.let { it !== previousView } == true }
            replaced
        }
        ui.onNodeWithTag("api-command-result").assertTextContains("Command submitted", substring = true)
        ui.onNodeWithTag("api-related-state").assertTextContains("Refresh to read playback state.", substring = true)
        workspaceTheme(ui, "Cinema")
        ui.onNodeWithTag("api-command-result").assertDoesNotExist()
        ui.onNodeWithTag("api-related-state").assertTextContains("Refresh to read playback state.", substring = true)
    }

    @Test
    fun featureFiltersPreserveTheRunTargetUntilAnOperationIsExplicitlySelected() {
        val pause = ApiRuntime.commands.first { it.id.endsWith("api.Player.pause()") }
        val volume = ApiRuntime.commands.first { it.id.endsWith("api.Player.volume") }
        val controller = ui.activity.controller
        workspaceCommand(ui, pause.id)
        val player = controller.player
        val source = controller.configuredSource
        var originalVolume = 0
        ui.runOnUiThread { originalVolume = player.volume }
        workspaceChoose(ui, "api-command-category", "Casting")
        ui.onNodeWithTag("api-command-selector").assertTextContains(pause.label, substring = true)
        ui.onNodeWithTag("api-run-target").assertTextContains(pause.label, substring = true)
        ui.onNodeWithTag("api-command-run").assertIsNotEnabled()
        ui.onNodeWithTag("api-command-filter-status").assertTextContains("Choose an operation in Casting", substring = true)
        ui.onNodeWithTag("api-command-result").assertDoesNotExist()
        ui.runOnUiThread {
            assertSame(player, controller.player)
            assertSame(source, controller.configuredSource)
            assertEquals(originalVolume, player.volume)
            assertFalse(player.isCasting)
        }
        capture("android-workspace-api-feature-filter")
        workspaceChoose(ui, "api-command-category", "Playback")
        ui.onNodeWithTag("api-run-target").assertTextContains(pause.label, substring = true)
        workspaceChoose(ui, "api-command-selector", volume.id, volume.id)
        ui.onNodeWithTag("api-run-target").assertTextContains(volume.label, substring = true)
        ui.onNodeWithTag("api-command-filter-status").assertDoesNotExist()
        workspaceField(ui, "api-argument-volume", "42")
        androidx.test.espresso.Espresso.closeSoftKeyboard()
        ui.onNodeWithTag("api-command-run").assertIsEnabled().performClick()
        ui.onNodeWithTag("api-command-result").assertTextContains("Command submitted", substring = true)
        ui.runOnUiThread { assertEquals(42, player.volume) }
        capture("android-workspace-api-feature-selection")
    }

    @Test
    fun selectedSourceThemeAndValuesStayEnabledAndVodHasNoLiveActions() {
        workspaceTheme(ui, "Cinema")
        ui.onNodeWithTag("theme-selector").performClick()
        ui.onNodeWithTag("theme-selector-option-CINEMA").assertIsSelected().assertIsEnabled()
        ui.onNodeWithText("Close").performClick()
        workspaceChoose(ui, "source-selector", "vod-hls")
        workspaceSetting(ui, "source-type")
        ui.onNodeWithTag("source-type").assertIsDisplayed().performClick()
        ui.onNodeWithTag("source-type-option-Hls").assertIsSelected().assertIsEnabled()
        ui.onNodeWithText("Close").performClick()
        workspaceMore(ui, "Live controls")
        ui.onNodeWithTag("live-edge").assertDoesNotExist()
        ui.onNodeWithTag("allow-dvr").assertDoesNotExist()
    }

    @Test
    fun narrowLargeTextKeepsTheLastSubtitleSettingAndApplyVisible() {
        val controller = ui.activity.controller
        ui.activity.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 1.5f)) {
                PlayerLabTheme { Surface(Modifier.requiredSize(width = 360.dp, height = 740.dp)) { PlayerWorkspace(controller) } }
            }
        }
        workspaceSetting(ui, "source-title")
        ui.onNodeWithTag("source-title").performTextReplacement("A long user-entered source title that describes a sample stream for testing playback preferences. ".repeat(3))
        androidx.test.espresso.Espresso.closeSoftKeyboard()
        ui.onNodeWithTag("apply-source").performClick()
        workspaceSetting(ui, "source-subtitle-default")
        assertFullyVisible("source-subtitle-default", 48)
        ui.onNodeWithTag("apply-source").assertIsDisplayed()
        ui.onNodeWithTag("reset-source").assertIsDisplayed()
        ui.onNodeWithTag("workspace-navigation").assertIsDisplayed()
        capture("android-workspace-large-text")
        workspaceMore(ui, "Playback options")
        capture("android-workspace-playback-options")
        assertFullyVisible("allow-dvr", 48)
    }

    @Test
    fun sdkValueAndStageApplyAreVisibleBeforeLongHelp() {
        val script = ApiSettings.fields.first { it.kind == ApiValueKind.Script && it.choices.isEmpty() }
        workspaceSdkSetting(ui, script.id)
        assertFullyVisible("api-setting-value", 104)
        ui.onNodeWithTag("api-setting-stage").assertIsDisplayed()
        ui.onNodeWithTag("api-settings-apply").assertIsDisplayed()
        ui.onNodeWithTag("api-setting-help").assertIsDisplayed().performClick()
        ui.onNodeWithText("Close").assertIsDisplayed().performClick()
    }

    @Test
    fun softwareKeyboardKeepsTheFocusedFieldDoneAndApplyVisibleWithLargeText() {
        val controller = ui.activity.controller
        ui.activity.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 1.5f)) {
                PlayerLabTheme { Surface(Modifier.fillMaxSize()) { PlayerWorkspace(controller) } }
            }
        }
        workspaceSetting(ui, "source-subtitle-language")
        assertDockedKeyboardEditor("source-subtitle-language", "apply-source", "android-workspace-keyboard")
        ui.onNodeWithTag("configuration-setting").assertIsDisplayed()
        workspaceMore(ui, "Analytics")
        workspaceChoose(ui, "analytics-page", "Default metadata")
        assertDockedKeyboardEditor("analytics-default-value", "analytics-apply", "android-workspace-analytics-keyboard")
        workspaceMore(ui, "Offline")
        workspaceChoose(ui, "offline-page", "Download settings")
        assertDockedKeyboardEditor("offline-config-downloads", "offline-config-apply", "android-workspace-offline-keyboard")
    }

    @Test
    fun rotationKeepsTheActualPlayerViewAndDraft() {
        workspaceField(ui, "source-title", "Rotation draft")
        val controller = ui.activity.controller
        val view = controller.currentView()
        assertNotNull(view)
        ui.runOnUiThread { ui.activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        ui.waitUntil(10_000) { ui.activity.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE }
        ui.waitForIdle()
        ui.runOnUiThread { assertSame("Rotation only changes placement", view, controller.currentView()) }
        workspaceSetting(ui, "source-title")
        ui.onNodeWithTag("source-title").assertTextContains("Rotation draft")
        ui.onNodeWithTag("apply-source").assertIsDisplayed()
        capture("android-workspace-landscape")
        ui.runOnUiThread { ui.activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
        ui.waitUntil(10_000) { ui.activity.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_PORTRAIT }
    }

    @Test
    fun narrowLargeTextKeepsLongSdkInputStageAndApplyVisible() {
        largeTextWorkspace()
        val field = ApiSettings.fields.filter { !it.secret && it.kind !in listOf(ApiValueKind.Boolean, ApiValueKind.Records) && it.choices.isEmpty() }
            .maxBy { it.id.length }
        workspaceSdkSetting(ui, field.id)
        assertFullyVisible("api-setting-value", if (field.kind == ApiValueKind.Script) 104 else 48)
        ui.onNodeWithTag("api-setting-stage").assertIsDisplayed()
        ui.onNodeWithTag("api-settings-apply").assertIsDisplayed()
        capture("android-workspace-long-sdk-setting")
        val presetScript = ApiSettings.fields.first { it.kind == ApiValueKind.Script && it.choices.isNotEmpty() }
        workspaceSdkSetting(ui, presetScript.id)
        assertFullyVisible("api-setting-value", 104)
        ui.onNodeWithTag("api-setting-presets").assertIsDisplayed().performClick()
        ui.onNodeWithTag("api-setting-preset-0").assertIsDisplayed().performClick()
        ui.onNodeWithTag("api-setting-value").assert(editable(presetScript.choices.first()))
        ui.onNodeWithTag("api-setting-value").performTextReplacement("return input;")
        androidx.test.espresso.Espresso.closeSoftKeyboard()
        ui.onNodeWithTag("api-setting-value").assert(editable("return input;"))
        assertFullyVisible("api-setting-value", 104)
        ui.onNodeWithTag("api-setting-stage").assertIsDisplayed()
        ui.onNodeWithTag("api-settings-apply").assertIsDisplayed()
    }

    @Test
    fun narrowLargeTextKeepsLongOperationArgumentAndRunVisible() {
        largeTextWorkspace()
        val command = ApiRuntime.commands.filter { it.arguments.isNotEmpty() }.maxBy { it.label.length }
        workspaceCommand(ui, command.id)
        assertFullyVisible("api-argument-${command.arguments.first().name}", 48)
        ui.onNodeWithTag("api-run-target").assertTextContains(command.label, substring = true)
        ui.onNodeWithTag("api-command-run").assertIsDisplayed().assertTextContains("Run API")
        capture("android-workspace-long-operation")
    }

    @Test
    fun sdkEditorDistinguishesUnstagedStagedAndAppliedValues() {
        val field = ApiSettings.fields.first { it.id.endsWith("TweaksConfig.timeChangedInterval") }
        workspaceSdkSetting(ui, field.id)
        ui.onNodeWithTag("api-setting-value").performTextReplacement("0.5")
        androidx.test.espresso.Espresso.closeSoftKeyboard()
        ui.onNodeWithTag("api-setting-draft-status").assertTextContains("not staged", substring = true)
        ui.onNodeWithTag("api-setting-stage").performClick()
        ui.onNodeWithTag("api-setting-draft-status").assertTextContains("not applied", substring = true)
        ui.onNodeWithTag("api-settings-apply").performClick()
        ui.onNodeWithTag("api-setting-draft-status").assertTextContains("Applied override")
        ui.onNodeWithTag("api-setting-value").performTextReplacement("0.75")
        androidx.test.espresso.Espresso.closeSoftKeyboard()
        ui.onNodeWithTag("api-setting-draft-status").assertTextContains("not staged", substring = true)
        ui.onNodeWithTag("api-setting-stage-status").assertDoesNotExist()
    }

    private fun largeTextWorkspace() {
        val controller = ui.activity.controller
        ui.activity.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 1.5f)) {
                PlayerLabTheme { Surface(Modifier.requiredSize(width = 360.dp, height = 740.dp)) { PlayerWorkspace(controller) } }
            }
        }
    }

    private fun editable(value: String) = SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString(value))

    private fun assertFullyVisible(tag: String, minimumHeightDp: Int) {
        val node = ui.onNodeWithTag(tag).assertIsDisplayed()
        val visible = node.fetchSemanticsNode().boundsInRoot
        val complete = node.getUnclippedBoundsInRoot()
        with(ui.density) {
            assertTrue("$tag must expose the entire input rather than a clipped label: visible=$visible; complete=$complete",
                visible.height + 1f >= (complete.bottom - complete.top).toPx())
            assertTrue("$tag needs a usable visible input area", visible.height + 1f >= minimumHeightDp.dp.toPx())
        }
    }

    private fun assertDockedKeyboardEditor(fieldTag: String, applyTag: String, screenshot: String) {
        ui.onNodeWithTag(fieldTag).assertIsDisplayed().performClick()
        ui.runOnUiThread { WindowInsetsControllerCompat(ui.activity.window, ui.activity.window.decorView).show(WindowInsetsCompat.Type.ime()) }
        ui.waitUntil(10_000) {
            ViewCompat.getRootWindowInsets(ui.activity.window.decorView)?.isVisible(WindowInsetsCompat.Type.ime()) == true &&
                runCatching { ui.onNodeWithTag("workspace-done").assertIsDisplayed() }.isSuccess
        }
        assertFullyVisible(fieldTag, 48)
        ui.onNodeWithTag("workspace-done").assertIsDisplayed()
        ui.onNodeWithTag(applyTag).assertIsDisplayed()
        ui.onNodeWithTag("player-preview").assertIsDisplayed()
        capture(screenshot)
        ui.onNodeWithTag("workspace-done").performClick()
        ui.waitUntil(10_000) {
            ViewCompat.getRootWindowInsets(ui.activity.window.decorView)?.isVisible(WindowInsetsCompat.Type.ime()) == false &&
                runCatching { ui.onNodeWithTag("source-selector").assertIsDisplayed() }.isSuccess
        }
    }

    private fun capture(name: String) {
        ui.waitForIdle()
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        // Compose can be idle while the platform is still dismissing a dialog or the keyboard.
        automation.waitForIdle(500, 5_000)
        val bitmap = requireNotNull(automation.takeScreenshot())
        File(ui.activity.getExternalFilesDir(null), "$name.png").outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }
}
