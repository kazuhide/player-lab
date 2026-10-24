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

@RunWith(AndroidJUnit4::class)
class PlayerApiGuideInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    @Test fun captureAppliedConfigurationAndActualOperationsStateAndEvents() {
        val c = ui.activity.controller
        ui.runOnUiThread {
            c.applySource(SourceSettings("https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8", SourceType.Hls))
            c.applyPlayerSettings(PlayerSettings(autoplay = true, muted = true))
        }
        await { c.player.isPlaying && c.player.currentTime > 0.5 }
        click("api-settings-toggle")
        field("api-settings-search", "LabelingConfig.videoQualityLabeler")
        click("api-select-android:com.bitmovin.player.api.media.LabelingConfig.videoQualityLabeler")
        field("api-setting-value", "return input.height + 'p (' + Math.round(input.bitrate / 1000) + ' kbps)';")
        click("api-setting-stage")
        ui.onNodeWithTag("api-settings-error").assertDoesNotExist()
        click("api-settings-apply")
        ui.onNodeWithTag("api-settings-error").assertDoesNotExist()
        ui.runOnUiThread { assertTrue("Applied callback override", "android:com.bitmovin.player.api.media.LabelingConfig.videoQualityLabeler" in c.apiOverrides.values) }
        await { c.player.isPlaying && c.player.currentTime > 0.5 }
        ui.onNodeWithTag("api-setting-value").performScrollTo()
        ApiGuideScreenshot.capture("android-api-callback", ui.activity)
        click("api-settings-toggle")
        click("api-runtime-toggle")
        field("api-runtime-search", "Player.seek")
        click("api-command-android:com.bitmovin.player.api.Player.seek()")
        field("api-argument-time", "5")
        click("api-command-run")
        await { c.player.currentTime >= 5 }
        ui.onNodeWithTag("api-command-run").assertIsDisplayed()
        ApiGuideScreenshot.capture("android-api-operation", ui.activity)
        click("api-section-State")
        field("api-runtime-search", "Player.currentTime")
        click("api-state-refresh")
        workspaceState(ui, "android:com.bitmovin.player.api.Player.currentTime").assertExists().performScrollTo()
        ApiGuideScreenshot.capture("android-api-state", ui.activity)
        click("api-section-Events")
        workspaceEvent(ui, "PlayerEvent.Playing").assertIsDisplayed()
        ui.runOnUiThread { assertTrue("The selected playback event was received", (c.apiEvents["PlayerEvent.Playing"] ?: 0) > 0) }
        ui.onNodeWithTag("api-events-clear").assertIsDisplayed()
        ApiGuideScreenshot.capture("android-api-events", ui.activity)
    }
    private fun click(tag: String) = workspaceClick(ui, tag)
    private fun field(tag: String, value: String) { workspaceField(ui, tag, value); closeSoftKeyboard() }
    private fun await(condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 45_000
        while (SystemClock.uptimeMillis() < deadline) {
            ui.waitForIdle()
            var ready = false
            ui.runOnUiThread { ready = condition() }
            if (ready) return
            SystemClock.sleep(100)
        }
        fail("Actual playback state did not arrive")
    }
}
