package com.playerlab.android

import android.os.SystemClock
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bitmovin.player.api.analytics.AnalyticsApi.Companion.analytics
import com.bitmovin.player.api.analytics.SourceAnalyticsApi.Companion.analytics
import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Tests local collector API behavior. Dashboard ingestion is a separate check. */
@RunWith(AndroidJUnit4::class)
class PlayerAnalyticsInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun guiAppliesSourceMetadataAndRunsCollectorApisWithoutReloadingTheSource() {
        val controller = ui.activity.controller
        ui.runOnUiThread {
            controller.applySource(SourceSettings("https://kazuhide.github.io/player-lab/web/media/vod-baseline/manifest.mpd", SourceType.Dash))
            controller.applyPlayerSettings(PlayerSettings(autoplay = true, muted = true))
        }
        await("Licensed sample playback") { controller.player.isPlaying && controller.player.currentTime > 0.5 }
        click("analytics-toggle")
        click("analytics-random-user")
        click("analytics-source-toggle")
        stage("analytics-source", "videoId", "player-lab-android-gui-test")
        click("analytics-source-toggle")
        val previous = controller.player
        click("analytics-apply")
        await("Playback and a local Analytics impression after Apply") {
            controller.player !== previous && controller.player.isPlaying && !controller.player.analytics?.impressionId.isNullOrEmpty()
        }
        ui.runOnUiThread {
            assertEquals("player-lab-android-gui-test", controller.player.source!!.analytics!!.metadata.videoId)
            assertTrue(controller.apiAnalyticsSettings.randomizeUserId)
            assertTrue(controller.player.analytics!!.userId.isNotBlank())
        }
        click("analytics-custom-toggle")
        stage("analytics-custom", "customData100", "persistent-test-marker")
        click("analytics-custom-toggle")
        click("analytics-source-custom")
        ui.runOnUiThread { assertEquals("persistent-test-marker", controller.player.source!!.analytics!!.customData.customData100) }
        click("analytics-custom-toggle")
        stage("analytics-custom", "customData100", "event-only-test-marker")
        click("analytics-custom-toggle")
        click("analytics-custom-event")
        ui.runOnUiThread { assertEquals("A custom event must not persist its payload", "persistent-test-marker", controller.player.source!!.analytics!!.customData.customData100) }
        click("analytics-source-toggle")
        stage("analytics-source", "videoId", "player-lab-android-program-test")
        click("analytics-source-toggle")
        val source = controller.player.source
        val impression = controller.player.analytics!!.impressionId
        click("analytics-program-change")
        await("Program change creates a new local impression on the same media source") {
            val current = controller.player.analytics?.impressionId
            controller.player.source === source && !current.isNullOrEmpty() && current != impression && controller.player.isPlaying
        }
        click("analytics-state")
        ui.onNodeWithTag("analytics-result").assertTextContains("impressionId:", substring = true)
        ui.runOnUiThread { assertNull(controller.lastErrorCode) }
    }

    private fun stage(tag: String, key: String, value: String) {
        field("$tag-search", key)
        click("$tag-select-$key")
        field("$tag-value", value)
        click("$tag-stage")
    }
    private fun click(tag: String) = ui.onNodeWithTag(tag).performScrollTo().performClick()
    private fun field(tag: String, value: String) {
        ui.onNodeWithTag(tag).performScrollTo().performTextReplacement(value)
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
