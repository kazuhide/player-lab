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
class PlayerApiScriptInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private fun id(member: String) = "android:com.bitmovin.player.api.$member"

    @Test fun editedBodiesReachNetworkDecoderAndSourceLabelsDuringRealPlayback() {
        val c = ui.activity.controller
        ui.runOnUiThread {
            c.applySource(SourceSettings("https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8", SourceType.Hls))
            c.applyPlayerSettings(PlayerSettings(autoplay = true, muted = true))
        }
        await("Baseline playback") { c.player.isPlaying && c.player.currentTime > 0.5 }
        click("api-settings-toggle")
        stage("network.NetworkConfig.preprocessHttpRequestCallback", "if (input.request.url.indexOf('/vod-baseline/') >= 0) { input.request.headers = input.request.headers || {}; input.request.headers['X-Player-Lab'] = 'callback'; return input.request; } return null;")
        stage("decoder.DecoderConfig.decoderPriorityProvider", "return input.decoders.map(function(d) { return d.index; });")
        stage("media.LabelingConfig.videoQualityLabeler", "return 'Lab ' + input.height + 'p';")
        val previous = c.player
        click("api-settings-apply")
        await("Playback after callback Apply") { previous.isDestroyed && c.player !== previous && c.player.isPlaying && c.player.currentTime > 0.5 }
        await("Actual SDK labeler and decoder callbacks") {
            c.player.source?.availableVideoQualities?.any { it.label?.startsWith("Lab ") == true } == true &&
                (c.apiCallbacks.snapshot()[id("decoder.DecoderConfig.decoderPriorityProvider")]?.first ?: 0) > 0
        }
        ui.runOnUiThread {
            assertEquals(60.0, c.player.duration, 0.01)
            assertTrue((c.apiCallbacks.snapshot()[id("network.NetworkConfig.preprocessHttpRequestCallback")]?.first ?: 0) > 0)
            assertTrue(c.apiCallbacks.snapshot().values.all { it.second == 0 })
            assertTrue(c.apiSourceCallbacks.snapshot().values.all { it.second == 0 })
            assertNull(c.lastErrorCode)
        }
        click("api-callback-refresh")
        ui.onNodeWithTag("api-callback-${id("network.NetworkConfig.preprocessHttpRequestCallback")}").performScrollTo().assertTextContains("fallback after invalid result=0", substring = true)
        ui.onNodeWithTag("api-settings-code").assertTextContains("<YOUR_CALLBACK_BODY>", substring = true)
        ui.onNodeWithTag("api-settings-code").assertTextContains("ApiScriptSettings", substring = true)
    }
    private fun stage(member: String, body: String) {
        field("api-settings-search", member)
        click("api-select-${id(member)}")
        field("api-setting-value", body)
        click("api-setting-stage")
    }
    private fun click(tag: String) = ui.onNodeWithTag(tag).performScrollTo().performClick()
    private fun field(tag: String, value: String) {
        ui.onNodeWithTag(tag).performScrollTo().performTextReplacement(value)
        closeSoftKeyboard()
    }
    private fun await(label: String, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 45_000
        while (SystemClock.uptimeMillis() < deadline) {
            ui.waitForIdle()
            var ready = false
            ui.runOnUiThread { ready = condition() }
            if (ready) return
            SystemClock.sleep(100)
        }
        fail(label)
    }
}
