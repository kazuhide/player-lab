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
        click("api-runtime-toggle")
        field("api-runtime-search", "Create SSAI test ad")
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
        fail(label)
    }
}
