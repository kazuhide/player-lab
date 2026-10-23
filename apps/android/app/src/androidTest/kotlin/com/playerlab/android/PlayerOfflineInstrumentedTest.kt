package com.playerlab.android

import android.Manifest
import android.content.Context
import android.net.ConnectivityManager
import android.os.Build
import android.os.SystemClock
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bitmovin.player.api.offline.OfflineContentManager
import com.bitmovin.player.api.offline.OfflineSourceConfig
import com.bitmovin.player.api.offline.options.OfflineOptionEntryState
import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.FileInputStream

/** Licensed device test. Temporarily disables radios and always restores their original settings. */
@RunWith(AndroidJUnit4::class)
class PlayerOfflineInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun guiDownloadsSelectedTracksThenPlaysTheSdkOfflineSourceWithoutNetwork() {
        val controller = ui.activity.controller
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val wifi = shell("settings get global wifi_on") == "1"
        val data = shell("settings get global mobile_data") == "1"
        val network = ui.activity.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        if (Build.VERSION.SDK_INT >= 33) instrumentation.uiAutomation.grantRuntimePermission(ui.activity.packageName, Manifest.permission.POST_NOTIFICATIONS)
        try {
            ui.runOnUiThread {
                controller.applySource(SourceSettings("https://kazuhide.github.io/player-lab/web/media/vod-baseline/manifest.mpd", SourceType.Dash))
                controller.applyPlayerSettings(PlayerSettings(autoplay = true, muted = true))
            }
            await("Online source and license are ready") { controller.player.isPlaying && controller.player.currentTime > 0.5 }
            click("offline-toggle")
            field("offline-content-id", "gui-test-${SystemClock.uptimeMillis()}")
            click("offline-create")
            field("offline-config-downloads", "2")
            field("offline-config-segments", "2")
            click("offline-config-apply")
            ui.runOnUiThread {
                assertEquals(2, OfflineContentManager.offlineConfig.maxSimultaneousDownloads)
                assertEquals(2, OfflineContentManager.offlineConfig.maxSimultaneousSegmentDownloads)
            }
            workspaceOfflineCode(ui).assertTextContains("maxSimultaneousSegmentDownloads = 2", substring = true)
            click("offline-options")
            await("SDK download options arrive") { controller.apiOffline.options?.let { it.videoOptions.isNotEmpty() && it.audioOptions.isNotEmpty() } == true }
            var videoKey = ""
            var audioKey = ""
            ui.runOnUiThread {
                videoKey = controller.apiOffline.entries().filter { it.first.startsWith("video-") }.minBy { it.second.bitrate }.first
                audioKey = controller.apiOffline.entries().first { it.first.startsWith("audio-") }.first
            }
            field("offline-options-search", videoKey)
            click("offline-action-$videoKey-Download")
            field("offline-options-search", audioKey)
            click("offline-action-$audioKey-Download")
            click("offline-process")
            await("Selected audio and video finish downloading", 120_000) {
                val selected = controller.apiOffline.entries().filter { it.first == videoKey || it.first == audioKey }
                controller.apiOffline.completed && selected.size == 2 && selected.all { it.second.state == OfflineOptionEntryState.Downloaded }
            }
            ui.onNodeWithTag("offline-option-$audioKey").performScrollTo()
            ApiGuideScreenshot.capture("android-offline-tracks")
            ui.runOnUiThread {
                assertTrue(controller.apiOffline.requireManager().usedStorage > 0)
                assertNotNull(controller.apiOffline.requireManager().offlineSourceConfig)
                controller.player.unload()
            }
            shell("svc wifi disable")
            shell("svc data disable")
            await("Device has no active network", 20_000) { network.activeNetwork == null }
            click("offline-play")
            await("Offline SDK source actually plays") { controller.player.isPlaying && controller.player.currentTime > 1.0 }
            ui.runOnUiThread {
                assertTrue(controller.configuredSource!!.config is OfflineSourceConfig)
                assertEquals(60.0, controller.player.duration, 0.1)
                assertNull("Offline playback must not emit a player or source error", controller.lastErrorCode)
                // Recreating the player must retain the SDK offline source, including its cache metadata.
                controller.applyPlayerSettings(controller.playerSettings.copy(muted = false))
            }
            await("Offline source survives player recreation") { controller.player.isPlaying && controller.player.currentTime > 0.5 }
            ui.runOnUiThread { assertTrue(controller.configuredSource!!.config is OfflineSourceConfig) }
        } finally {
            shell("svc wifi ${if (wifi) "enable" else "disable"}")
            shell("svc data ${if (data) "enable" else "disable"}")
            ui.runOnUiThread {
                controller.player.unload()
                controller.apiOffline.manager?.deleteAll()
            }
        }
    }

    private fun click(tag: String) = workspaceClick(ui, tag)
    private fun field(tag: String, value: String) {
        workspaceField(ui, tag, value)
        closeSoftKeyboard()
    }
    private fun shell(command: String): String = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command).use {
        FileInputStream(it.fileDescriptor).bufferedReader().use { reader -> reader.readText().trim() }
    }
    private fun await(label: String, timeout: Long = 45_000, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + timeout
        while (SystemClock.uptimeMillis() < deadline) {
            var ready = false
            ui.runOnUiThread { ready = condition() }
            if (ready) return
            SystemClock.sleep(100)
        }
        fail(label)
    }
}
