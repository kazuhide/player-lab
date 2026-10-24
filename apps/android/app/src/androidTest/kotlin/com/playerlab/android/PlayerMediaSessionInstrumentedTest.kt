package com.playerlab.android

import android.content.Context
import android.media.session.MediaSessionManager
import android.os.SystemClock
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlayerMediaSessionInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    @Test fun editedMetadataAndTransportControlsReachTheAndroidMediaSession() {
        val c = ui.activity.controller
        ui.runOnUiThread {
            c.applySource(SourceSettings("https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8", SourceType.Hls))
            c.applyPlayerSettings(PlayerSettings(autoplay = true, muted = true))
        }
        await("VOD baseline") { c.player.isPlaying && c.player.currentTime > 0.5 }
        click("api-settings-toggle")
        field("api-settings-search", "MediaSessionSourceConfig.Enabled.mediaMetadata")
        click("api-select-android:com.bitmovin.player.api.media.session.MediaSessionSourceConfig.Enabled.mediaMetadata")
        field("api-setting-value", "displayTitle=Lab metadata sample\nsubtitle=API integration\nartist=Sample artist\nmediaType=Movie\nduration=60000")
        click("api-setting-stage")
        click("api-settings-apply")
        click("api-settings-toggle")
        click("api-runtime-toggle")
        field("api-runtime-search", "Enable Android media session")
        click("api-command-app:media-session-enable")
        click("api-command-run")
        await("SDK media session owns live player") { c.apiMediaSession != null && c.apiMediaSession?.isReleased == false && c.apiMediaSession?.player === c.player }
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        automation.adoptShellPermissionIdentity("android.permission.MEDIA_CONTENT_CONTROL")
        try {
            val manager = ui.activity.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
            var native: android.media.session.MediaController? = null
            await("Metadata is published through Android") {
                native = manager.getActiveSessions(null).firstOrNull { it.packageName == "com.playerlab.android" }
                native?.metadata?.description?.title?.toString() == "Lab metadata sample"
            }
            assertEquals("API integration", requireNotNull(native!!.metadata).description.subtitle.toString())
            ApiGuideScreenshot.capture("android-media-session", ui.activity)
            native!!.transportControls.pause()
            await("Android transport pause reaches Player") { c.player.isPaused }
            native!!.transportControls.play()
            await("Android transport play reaches Player") { c.player.isPlaying }
            val session = c.apiMediaSession!!
            field("api-argument-enabled", "false")
            click("api-command-run")
            await("Session released") { session.isReleased && c.apiMediaSession == null }
        } finally { automation.dropShellPermissionIdentity() }
    }
    private fun click(tag: String) = workspaceClick(ui, tag)
    private fun field(tag: String, value: String) { workspaceField(ui, tag, value); closeSoftKeyboard() }
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
