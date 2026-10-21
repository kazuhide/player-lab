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

/** Uses Shaka Player's public Widevine sample; no private DRM endpoint or key is embedded. */
@RunWith(AndroidJUnit4::class)
class PlayerApiDrmInstrumentedTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private fun id(member: String) = "android:com.bitmovin.player.api.drm.$member"
    @Test fun editedWidevineBodiesRunDuringRealLicenseAcquisition() {
        val c = ui.activity.controller
        ui.runOnUiThread {
            c.applySource(SourceSettings("https://storage.googleapis.com/shaka-demo-assets/angel-one-widevine/dash.mpd", SourceType.Dash))
            c.applyPlayerSettings(PlayerSettings(autoplay = true, muted = true))
        }
        click("api-settings-toggle")
        stage("DrmConfig.licenseUrl", "https://proxy.uat.widevine.com/proxy")
        stage("WidevineConfig.prepareMessageCallback", "return input.bytes;")
        stage("WidevineConfig.prepareLicenseCallback", "return input.bytes;")
        click("api-settings-apply")
        ui.onNodeWithTag("api-settings-error").assertDoesNotExist()
        ui.runOnUiThread {
            assertTrue("Message callback override applied", id("WidevineConfig.prepareMessageCallback") in c.apiOverrides.values)
            assertTrue("License callback override applied", id("WidevineConfig.prepareLicenseCallback") in c.apiOverrides.values)
        }
        val deadline = SystemClock.uptimeMillis() + 45_000
        var played = false
        while (SystemClock.uptimeMillis() < deadline) {
            ui.waitForIdle()
            ui.runOnUiThread { played = c.player.isPlaying && c.player.currentTime > 0.5 }
            if (played) break
            SystemClock.sleep(100)
        }
        ui.runOnUiThread {
            assertTrue("Widevine playback; SDK error=${c.lastErrorCode}", played)
            for (member in listOf("prepareMessageCallback", "prepareLicenseCallback")) {
                val stats = c.apiSourceCallbacks.snapshot()[id("WidevineConfig.$member")]
                assertNotNull("Actual license callback invoked: $member", stats)
                assertTrue(stats!!.first > 0)
                val timing = c.apiSourceCallbacks.performanceSnapshot()[id("WidevineConfig.$member")]
                assertNotNull("Pure callback timing is available", timing)
                println("DRM callback $member: wall=${timing!!.wallMillis}ms; cpu=${timing.cpuMillis}ms; phases=${timing.phasesMillis}; bytes=${c.apiSourceCallbacks.byteInputSizes()[id("WidevineConfig.$member")]}")
                assertEquals("No fallback for $member; calls=${stats.first}; reason=${c.apiSourceCallbacks.fallbackReasons()[id("WidevineConfig.$member")]}; bytes=${c.apiSourceCallbacks.byteInputSizes()[id("WidevineConfig.$member")]}", 0, stats.second)
            }
            assertNull(c.lastErrorCode)
        }
    }
    private fun stage(member: String, body: String) {
        field("api-settings-search", member)
        click("api-select-${id(member)}")
        field("api-setting-value", body)
        click("api-setting-stage")
        ui.onNodeWithTag("api-settings-error").assertDoesNotExist()
    }
    private fun click(tag: String) = ui.onNodeWithTag(tag).performScrollTo().performClick()
    private fun field(tag: String, value: String) { ui.onNodeWithTag(tag).performScrollTo().performTextReplacement(value); closeSoftKeyboard() }
}
