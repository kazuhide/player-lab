package com.playerlab.android

import android.graphics.Bitmap
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.text.AnnotatedString
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.PlayerView
import com.bitmovin.player.api.source.SourceType
import com.bitmovin.player.api.source.TimelineReferencePoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Licenseless checks of actual GUI application, SDK configuration and view/player ownership. */
@RunWith(AndroidJUnit4::class)
class PlayerConfigurationInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test
    fun extensionDraftsValidateApplyAndResetWithoutChangingOwnershipRules() {
        val controller = ui.activity.controller
        workspaceTheme(ui, "Sports")
        click("allow-dvr")
        openConfiguration()
        val original = controller.player
        val originalSource = controller.configuredSource
        field("source-audio-languages", "de,,en")
        field("source-subtitle-label", "External captions")
        click("apply-source")
        ui.runOnIdle {
            assertTrue(original === controller.player)
            assertTrue("Invalid extensions must not reload", originalSource === controller.configuredSource)
        }
        field("source-audio-languages", " en, de, EN ")
        field("source-subtitle-url", "https://example.com/captions.vtt")
        field("source-subtitle-language", "en")
        click("source-subtitle-default")
        click("apply-source")
        val appliedSource = controller.sourceSettings
        ui.runOnIdle {
            assertTrue("Source extensions reload the same player", original === controller.player)
            val config = requireNotNull(controller.configuredSource).config
            assertEquals(listOf("en", "de"), config.preferredAudioLanguages)
            val subtitle = config.subtitleTracks.single()
            assertEquals("External captions", subtitle.label)
            assertEquals("en", subtitle.language)
            assertEquals("text/vtt", subtitle.mimeType)
            assertTrue(subtitle.isDefault)
        }
        field("config-audio-languages", "de,en")
        field("config-http-retries", "NaN")
        click("apply-player")
        ui.runOnIdle { assertTrue("Invalid retry must not recreate", original === controller.player) }
        field("config-http-retries", "0,0.25")
        click("apply-player")
        val replacement = controller.player
        ui.runOnIdle {
            assertTrue(original !== replacement)
            assertEquals(appliedSource, controller.sourceSettings)
            assertEquals(listOf("de", "en"), replacement.config.playbackConfig.preferredAudioLanguages)
            val retry = replacement.config.networkConfig.retryHttpRequestConfig as com.bitmovin.player.api.network.RetryHttpRequestConfig.Retry
            assertEquals(listOf(0.0, 0.25), retry.retryTimeouts)
            assertEquals(listOf("en", "de"), controller.configuredSource?.config?.preferredAudioLanguages)
            assertFalse(controller.timeShiftEnabled)
        }
        click("reset-player")
        workspaceConfigurationNode(ui, "config-audio-languages").assert(editable("de, en"))
        workspaceConfigurationNode(ui, "config-http-retries").assert(editable("0.0, 0.25"))
        field("source-audio-languages", "fr")
        field("source-subtitle-label", "Unapplied")
        click("reset-source")
        workspaceConfigurationNode(ui, "source-audio-languages").assert(editable("en, de"))
        workspaceConfigurationNode(ui, "source-subtitle-label").assert(editable("External captions"))
        ui.runOnIdle { assertTrue("Reset only changes drafts", replacement === controller.player) }
        scrollToTop()
        ui.onNodeWithTag("theme-selector").assertTextContains("Sports", substring = true).assertIsEnabled()
        workspaceSource(ui, "Live DASH + DVR")
        for (tag in listOf("source-audio-languages", "source-subtitle-url", "source-subtitle-label", "source-subtitle-language")) {
            workspaceConfigurationNode(ui, tag).assert(editable(""))
        }
        workspaceConfigurationNode(ui, "source-subtitle-default").assertIsOff()
    }

    @Test
    fun liveTargetLatencyDraftValidatesReloadsRetainsAndClearsWithoutChangingDefaults() {
        val controller = ui.activity.controller
        val original = controller.player
        val originalSource = controller.configuredSource
        openConfiguration()
        field("source-live-target", "NaN")
        click("apply-source")
        ui.runOnUiThread {
            assertTrue(original === controller.player)
            assertTrue("Invalid latency must not reload", originalSource === controller.configuredSource)
            assertNull(controller.sourceSettings.liveTargetLatency)
        }
        field("source-live-target", "30")
        click("apply-source")
        ui.runOnUiThread {
            assertTrue("Source policy must retain player", original === controller.player)
            assertEquals(30.0, requireNotNull(controller.configuredSource?.config?.liveConfig?.targetLatency), 0.0)
        }
        field("source-live-target", "45")
        val applied = controller.configuredSource
        click("reset-source")
        workspaceConfigurationNode(ui, "source-live-target").assert(editable("30.0"))
        ui.runOnUiThread {
            assertTrue("Reset is draft-only", applied === controller.configuredSource)
            controller.applyPlayerSettings(controller.playerSettings.copy(muted = true))
            assertTrue(original !== controller.player)
            assertEquals(30.0, requireNotNull(controller.configuredSource?.config?.liveConfig?.targetLatency), 0.0)
        }
        val replacement = controller.player
        field("source-live-target", "")
        click("apply-source")
        ui.runOnUiThread {
            assertTrue(replacement === controller.player)
            assertNull("Blank must preserve SDK defaults", controller.configuredSource?.config?.liveConfig)
        }
        scrollToTop()
        workspaceSource(ui, "Live DASH + DVR")
        workspaceConfigurationNode(ui, "source-live-target").assert(editable(""))
    }

    @Test
    fun sourceApplyValidatesReloadsAndSamePresetClearsDraft() {
        val controller = ui.activity.controller
        val original = controller.player
        val originalSource = controller.configuredSource
        openConfiguration()
        field("source-url", "file:///invalid.mpd")
        field("source-title", "Unapplied title")
        click("apply-source")
        ui.runOnUiThread {
            assertTrue("Invalid source must retain player", original === controller.player)
            assertTrue("Invalid source must not reload", originalSource === controller.configuredSource)
        }
        field("source-url", Sources.all.first { it.id == "vod-hls" }.url)
        click("source-type-Hls")
        workspaceConfigurationNode(ui, "source-type-Hls").assertTextContains("Hls").assertIsEnabled()
        field("source-title", "GUI source")
        field("source-poster", "https://example.com/poster.jpg")
        click("source-poster-persistent")
        field("source-offset", "-12.5")
        click("source-reference-End")
        click("apply-source")
        ui.runOnUiThread {
            assertTrue("Source Apply retains player", original === controller.player)
            val config = requireNotNull(controller.configuredSource).config
            assertEquals(SourceType.Hls, config.type)
            assertEquals("GUI source", config.title)
            assertEquals("https://example.com/poster.jpg", config.posterSource)
            assertTrue(config.isPosterPersistent)
            assertEquals(-12.5, requireNotNull(config.options.startOffset), 0.0)
            assertEquals(TimelineReferencePoint.End, config.options.startOffsetTimelineReference)
        }
        workspaceConfigurationNode(ui, "source-title").performScrollTo()
        screenshot("android-source-configuration.png")
        field("source-title", "Discard this draft")
        val applied = controller.configuredSource
        click("reset-source")
        workspaceConfigurationNode(ui, "source-title").assert(editable("GUI source"))
        ui.runOnUiThread { assertTrue("Reset is draft-only", applied === controller.configuredSource) }
        scrollToTop()
        workspaceSource(ui, "Live DASH + DVR")
        field("source-title", "Stale same-preset draft")
        scrollToTop()
        workspaceSource(ui, "Live DASH + DVR")
        workspaceConfigurationNode(ui, "source-title").assert(editable(""))
        workspaceConfigurationNode(ui, "source-offset").assert(editable(""))
        workspaceConfigurationNode(ui, "source-poster").assert(editable(""))
    }

    @Test
    fun playerApplyRetainsSourceUiAndDvrAndRetiresDetachedPlayers() {
        val controller = ui.activity.controller
        workspaceTheme(ui, "Cinema")
        click("allow-dvr")
        openConfiguration()
        field("source-title", "Retained source")
        field("source-offset", "-4.5")
        click("source-reference-End")
        click("apply-source")
        val original = controller.player
        val retained = controller.sourceSettings
        var originalViews = emptyList<PlayerView>()
        ui.runOnUiThread {
            originalViews = playerViews().filter { it.player === original }
            assertTrue("Original PlayerView must be attached", originalViews.isNotEmpty())
        }
        click("config-autoplay")
        click("config-muted")
        click("config-timeshift")
        click("config-preload")
        click("config-rebuffering")
        field("config-forward", "20")
        field("config-startup", "NaN")
        field("config-restart", "2")
        field("config-max-bitrate", "1500000")
        field("config-balance", "0.8")
        var destroyedBeforeInvalidDraft = false
        ui.runOnUiThread { destroyedBeforeInvalidDraft = original.isDestroyed }
        click("apply-player")
        ui.runOnUiThread {
            assertTrue("Invalid player draft must retain player", original === controller.player)
            // A rejected dummy license can already have invalidated the SDK instance.
            assertEquals("Invalid draft must preserve SDK state", destroyedBeforeInvalidDraft, original.isDestroyed)
        }
        field("config-startup", "1")
        click("apply-player")
        ui.runOnUiThread {
            assertTrue("Valid player Apply must recreate; status: ${controller.configurationStatus}", original !== controller.player)
        }
        ui.runOnUiThread {
            assertTrue("Player settings require recreation", original !== controller.player)
            assertTrue("Retired SDK player must be invalidated", original.isDestroyed)
            assertTrue("Retired views must detach", originalViews.all { it.player == null })
            assertEquals(retained, controller.sourceSettings)
            val config = controller.player.config
            assertTrue(config.playbackConfig.isAutoplayEnabled)
            assertTrue(config.playbackConfig.isMuted)
            assertFalse(config.playbackConfig.isTimeShiftEnabled)
            assertEquals(1.0, config.bufferConfig.startupThreshold, 0.0)
            assertEquals(2.0, config.bufferConfig.restartThreshold, 0.0)
            assertEquals(20.0, config.bufferConfig.audioAndVideo.forwardDuration, 0.0)
            assertEquals(1_500_000, config.adaptationConfig.maxSelectableVideoBitrate)
            assertFalse(config.adaptationConfig.preload)
            assertFalse(config.adaptationConfig.isRebufferingAllowed)
            assertEquals(0.8f, config.adaptationConfig.qualityStabilityBalance)
            val source = requireNotNull(controller.configuredSource).config
            assertEquals("Retained source", source.title)
            assertEquals(-4.5, requireNotNull(source.options.startOffset), 0.0)
            assertEquals(TimelineReferencePoint.End, source.options.startOffsetTimelineReference)
            assertFalse(controller.timeShiftEnabled)
            assertFalse(controller.dvr.dvrAvailable)
        }
        workspaceConfigurationNode(ui, "config-startup").performScrollTo()
        screenshot("android-player-configuration.png")
        ui.onNodeWithTag("theme-selector").assertTextContains("Cinema", substring = true).assertIsEnabled()
        val active = controller.player
        scrollToTop()
        workspaceTheme(ui, "Sports")
        ui.runOnUiThread { assertTrue("UI change must retain player", active === controller.player) }
        click("reset-player")
        workspaceConfigurationNode(ui, "config-autoplay").assertIsOn()
        workspaceConfigurationNode(ui, "config-timeshift").assertIsOff()
        ui.runOnUiThread { assertTrue("Reset must not recreate", active === controller.player) }

        // Two immediate restarts exercise the interval before Compose can release the prior view.
        ui.runOnUiThread {
            controller.applyPlayerSettings(controller.playerSettings.copy(muted = false))
            val intermediate = controller.player
            controller.applyPlayerSettings(controller.playerSettings.copy(muted = true))
            val final = controller.player
            controller.release()
            controller.release()
            assertTrue("Release detaches every live view", playerViews().all { it.player == null })
            assertTrue("Every retired SDK player must be invalidated", active.isDestroyed && intermediate.isDestroyed && final.isDestroyed)
        }
    }

    @Test
    fun remoteDirectionAndCenterReachAndTogglePlayerSettings() {
        openConfiguration()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        // A real D-pad key exits Android touch mode; RequestFocus alone does not do that.
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN)
        ui.waitForIdle()
        workspaceSetting(ui, "config-muted")
        ui.onNodeWithTag("config-muted").assertIsDisplayed()
            .performSemanticsAction(SemanticsActions.RequestFocus) { assertTrue("Remote-mode focus request", it()) }
        ui.onNodeWithTag("config-muted").assertIsFocused().assertIsOff()
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER)
        ui.onNodeWithTag("config-muted").assertIsOn()
        screenshot("android-dpad-configuration.png")
        ui.runOnUiThread { assertFalse("Remote edits remain draft-only", ui.activity.controller.player.config.playbackConfig.isMuted) }
    }

    private fun openConfiguration() = click("configuration-toggle")
    private fun click(tag: String) {
        try { workspaceClick(ui, tag) } catch (failure: AssertionError) {
            screenshot("android-offscreen-control.png")
            throw failure
        }
    }
    private fun field(tag: String, value: String) {
        workspaceField(ui, tag, value)
        closeSoftKeyboard()
    }
    private fun editable(value: String) = SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString(value))
    private fun scrollToTop() {
        ui.onNodeWithTag("player-preview").assertIsDisplayed()
    }
    private fun playerViews(): List<PlayerView> = descendants(ui.activity.window.decorView).filterIsInstance<PlayerView>()
    private fun descendants(view: View): List<View> = if (view is ViewGroup) {
        (0 until view.childCount).flatMap { index -> val child = view.getChildAt(index); listOf(child) + descendants(child) }
    } else emptyList()
    private fun screenshot(name: String) {
        ui.waitForIdle()
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        requireNotNull(bitmap).let {
            File(ui.activity.getExternalFilesDir(null), name).outputStream().use { output ->
                assertTrue("Screenshot must be saved", it.compress(Bitmap.CompressFormat.PNG, 100, output))
            }
            it.recycle()
        }
    }
}
