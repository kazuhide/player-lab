package com.playerlab.android

import android.os.SystemClock
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Real GUI -> SDK configuration, controls, playback and visible event/state routes. */
@RunWith(AndroidJUnit4::class)
class PlayerApiInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun sdkEditorsAndCommandsRetainPlaybackAndExposeNativeState() {
        val controller = ui.activity.controller
        ui.runOnUiThread {
            controller.applySource(SourceSettings(Sources.all.first { it.id == "vod-hls" }.url, SourceType.Hls))
            controller.applyPlayerSettings(PlayerSettings(autoplay = true, muted = true))
        }
        await("Initial VOD playback") { controller.player.isPlaying && controller.player.currentTime > 0.5 }
        val original = controller.player
        click("api-settings-toggle")
        field("api-settings-search", "TweaksConfig.timeChangedInterval")
        click("api-select-android:com.bitmovin.player.api.TweaksConfig.timeChangedInterval")
        field("api-setting-value", "0.5")
        click("api-setting-stage")
        click("api-settings-apply")
        ui.runOnUiThread {
            assertNotSame(original, controller.player)
            assertTrue(original.isDestroyed)
            assertEquals(0.5, controller.player.config.tweaksConfig.timeChangedInterval, 0.0)
        }
        await("VOD resumes after typed settings Apply") { controller.player.isPlaying && controller.player.currentTime > 0.5 }
        workspaceAppliedCode(ui, overrides = true).assertTextContains("timeChangedInterval = 0.5", substring = true)
        click("api-settings-toggle")
        click("api-runtime-toggle")
        choose("api.Player.volume")
        field("api-argument-volume", "25")
        click("api-command-run")
        ui.runOnUiThread { assertEquals(25, controller.player.volume) }
        choose("api.Player.pause()")
        click("api-command-run")
        await("GUI pause reaches SDK") { controller.player.isPaused }
        choose("api.Player.play()")
        click("api-command-run")
        await("GUI play reaches SDK") { controller.player.isPlaying }
        click("api-section-State")
        field("api-runtime-search", "api.Player.isPlaying")
        click("api-state-refresh")
        workspaceState(ui, "android:com.bitmovin.player.api.Player.isPlaying").assertTextEquals("true")
        click("api-section-Events")
        field("api-runtime-search", "PlayerEvent.Playing")
        ui.runOnUiThread { assertTrue((controller.apiEvents["PlayerEvent.Playing"] ?: 0) > 0) }
        workspaceEvent(ui, "PlayerEvent.Playing").performScrollTo().assertIsDisplayed()
        ui.runOnUiThread { assertNull("No SDK playback error", controller.lastErrorCode) }
    }

    @Test fun ssaiTestObjectsAreEditableAndInspectedWithoutClaimingAdPlayback() {
        val controller = ui.activity.controller
        await("A source is loaded before manual SSAI metadata is created") {
            controller.player.source?.loadingState == com.bitmovin.player.api.source.LoadingState.Loaded
        }
        click("api-runtime-toggle")
        workspaceChoose(ui, "api-command-category", "Advertising")
        ui.onNodeWithTag("api-manual-ssai").performClick()
        field("api-runtime-search", "Create SSAI ad metadata")
        click("api-command-app:ssai-ad")
        field("api-argument-id", "example-ad")
        field("api-argument-duration", "12.5")
        field("api-argument-skippableAfter", "3")
        click("api-command-run")
        ui.runOnUiThread {
            assertEquals(12.5, controller.apiSsaiAds["example-ad"]!!.duration, 0.0)
            assertEquals(3.0, controller.apiSsaiAds["example-ad"]!!.skippableAfter!!, 0.0)
            assertEquals("example-ad", controller.apiSelectedSsaiAd)
        }
        click("api-section-State")
        field("api-runtime-search", "api.ssai.SsaiAd.duration")
        click("api-state-refresh")
        workspaceState(ui, "android:com.bitmovin.player.api.ssai.SsaiAd.duration").assertTextEquals("12.5")
    }

    @Test fun ordinaryStreamsDisableManualSsaiAndAdOperationsUntilTheirPrerequisitesHold() {
        val controller = ui.activity.controller
        ui.runOnUiThread {
            controller.apiEventRecording = false
            controller.applySource(SourceSettings(Sources.all.first { it.id == "vod-hls" }.url, SourceType.Hls))
        }
        await("The current source is loaded") {
            controller.player.source === controller.configuredSource &&
                controller.player.source?.loadingState == com.bitmovin.player.api.source.LoadingState.Loaded
        }
        click("api-runtime-toggle")
        workspaceChoose(ui, "api-command-category", "Advertising")
        ui.onNodeWithTag("api-command-selector").performClick()
        ui.onNodeWithTag("api-command-selector-options").performScrollToNode(hasTestTag("api-command-selector-option-app:ssai-ad"))
        ui.onNodeWithTag("api-command-selector-option-app:ssai-ad").assertIsNotEnabled()
        ApiGuideScreenshot.capture("android-api-ssai-metadata-disabled", ui.activity)
        ui.onNodeWithTag("api-command-selector-options").performScrollToNode(hasTestTag("api-command-selector-option-android:com.bitmovin.player.api.advertising.AdvertisingApi.skip()"))
        ui.onNodeWithTag("api-command-selector-option-android:com.bitmovin.player.api.advertising.AdvertisingApi.skip()").performScrollTo().assertIsNotEnabled()
        ui.onNodeWithText(workspaceLocalizedLabel(ui, "Close")).performClick()
        ui.onNodeWithTag("api-manual-ssai").performClick()
        workspaceCommand(ui, "app:ssai-ad")
        click("api-command-run")
        ui.runOnUiThread {
            assertNotNull(controller.apiSsaiAds["test-ad"])
            assertNull("Metadata creation does not start an ad", controller.player.ads.activeLinearAd)
        }
        workspaceCommand(ui, "android:com.bitmovin.player.api.ssai.SsaiApi.registerAdBreak()")
        click("api-command-run")
        workspaceCommand(ui, "android:com.bitmovin.player.api.ssai.SsaiApi.startAdBreak()")
        click("api-command-run")
        await("Manual SSAI integration exposes the active break") { controller.player.ads.activeAdBreak is com.bitmovin.player.api.ssai.SsaiAdBreak }
        workspaceCommand(ui, "android:com.bitmovin.player.api.ssai.SsaiApi.startAd()")
        click("api-command-run")
        await("Manual SSAI integration exposes the active ad") { controller.player.ads.activeLinearAd is com.bitmovin.player.api.ssai.SsaiAd }
        workspaceCommand(ui, "android:com.bitmovin.player.api.ssai.SsaiApi.finishAd()")
        click("api-command-run")
        await("The ad finishes independently of optional event recording") { controller.player.ads.activeLinearAd == null }
        ui.waitUntil(5_000) { androidx.compose.ui.semantics.SemanticsProperties.Disabled in ui.onNodeWithTag("api-command-run").fetchSemanticsNode().config }
        ui.onNodeWithTag("api-command-run").assertIsNotEnabled()
        workspaceCommand(ui, "android:com.bitmovin.player.api.ssai.SsaiApi.removeAdBreak()")
        click("api-command-run")
        ui.runOnUiThread {
            assertFalse("Removed breaks must not remain available as registered objects", controller.apiSsaiBreaks.containsKey("test-break"))
            assertNull(controller.apiSelectedSsaiBreak)
            assertNull(controller.player.ads.activeAdBreak)
        }
        ui.onNodeWithTag("api-command-run").assertIsNotEnabled()
        ui.runOnUiThread { controller.applySource(controller.sourceSettings) }
        ui.onNodeWithTag("api-manual-ssai").assertIsOff()
        ui.onNodeWithTag("api-command-run").assertIsNotEnabled()
    }

    @Test fun detachedPlayerViewCanReattachWhilePausedAndUnavailableIntegrationsStayDisabled() {
        val controller = ui.activity.controller
        ui.runOnUiThread {
            controller.apiEventRecording = false
            controller.applySource(SourceSettings(Sources.all.first { it.id == "vod-hls" }.url, SourceType.Hls))
            controller.applyPlayerSettings(controller.playerSettings.copy(autoplay = true, muted = true))
        }
        // Let the Compose test clock replace the view before waiting on its SDK ownership.
        ui.waitForIdle()
        await("The source is playing before testing paused-view recovery") {
            controller.player.source?.loadingState == com.bitmovin.player.api.source.LoadingState.Loaded &&
                controller.player.isPlaying && controller.player.currentTime > 0.5 && controller.currentView() != null
        }
        workspaceCommand(ui, "android:com.bitmovin.player.api.Player.pause()")
        click("api-command-run")
        await("The GUI pauses the source before detaching its view") { controller.player.isPaused }
        val player = controller.player
        val source = controller.configuredSource
        var originalView: com.bitmovin.player.PlayerView? = null
        ui.runOnUiThread { originalView = controller.currentView() }
        workspaceCommand(ui, "android:com.bitmovin.player.PlayerView.player")
        field("api-argument-attachCurrentPlayer", "false")
        click("api-command-run")
        ui.runOnUiThread {
            assertNull(controller.currentView())
            assertTrue(controller.apiHasRecoverableView)
            assertFalse(controller.apiHasCustomMessageHandler)
        }
        ui.onNodeWithTag("api-command-run").assertIsEnabled()
        field("api-argument-attachCurrentPlayer", "true")
        click("api-command-run")
        ui.runOnUiThread {
            assertSame(originalView, controller.currentView())
            assertSame(player, controller.player)
            assertSame(source, controller.configuredSource)
        }
        assertUnavailableChoice("app:custom-message-send")
        assertUnavailableChoice("android:com.bitmovin.player.api.Player.preloadDrmLicense()")
        workspaceCommand(ui, "android:com.bitmovin.player.PlayerView.setCustomMessageHandler()")
        click("api-command-run")
        ui.runOnUiThread { assertTrue(controller.apiHasCustomMessageHandler) }
        workspaceCommand(ui, "app:custom-message-send")
        ui.onNodeWithTag("api-command-run").assertIsEnabled()
        workspaceCommand(ui, "android:com.bitmovin.player.PlayerView.setCustomMessageHandler()")
        field("api-argument-enabled", "false")
        click("api-command-run")
        ui.runOnUiThread { assertFalse(controller.apiHasCustomMessageHandler) }
        assertUnavailableChoice("app:custom-message-send")
    }

    private fun assertUnavailableChoice(id: String) {
        workspaceChoose(ui, "api-command-category", apiPurpose(id))
        ui.onNodeWithTag("api-command-selector").performClick()
        ui.onNodeWithTag("api-command-selector-search").performTextReplacement(id)
        ui.onNodeWithTag("api-command-selector-option-$id").assertIsNotEnabled()
        ui.onNodeWithText(workspaceLocalizedLabel(ui, "Close")).performClick()
    }

    private fun choose(member: String) {
        field("api-runtime-search", member)
        click("api-command-android:com.bitmovin.player.$member")
    }
    private fun click(tag: String) = workspaceClick(ui, tag)
    private fun field(tag: String, value: String) {
        workspaceField(ui, tag, value)
        closeSoftKeyboard()
    }
    private fun await(label: String, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 45_000
        while (SystemClock.uptimeMillis() < deadline) {
            var ready = false
            ui.runOnUiThread { ready = condition() }
            if (ready) return
            SystemClock.sleep(100)
        }
        var details = ""
        ui.runOnUiThread {
            val c = ui.activity.controller
            details = "sourceState=${c.player.source?.loadingState}; currentSource=${c.player.source === c.configuredSource}; " +
                "playing=${c.player.isPlaying}; paused=${c.player.isPaused}; view=${c.currentView() != null}; errorCode=${c.lastErrorCode}"
        }
        fail("$label; $details")
    }
}
